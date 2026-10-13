"""
Optimizer service (CLAUDE.md §2 principle 10). The language model frames problems;
this service solves them. Start: uvicorn main:app --reload --port 8001
"""
from fastapi import FastAPI
from pydantic import BaseModel
from ortools.linear_solver import pywraplp

app = FastAPI(title="Deviation Desk Optimizer")


class Source(BaseModel):
    location_id: str
    available: int
    cost_per_unit: float
    transit_hours: float


class Demand(BaseModel):
    order_id: str
    quantity: int
    due_in_hours: float


class AllocationRequest(BaseModel):
    sources: list[Source]
    demand: Demand


class Allocation(BaseModel):
    location_id: str
    quantity: int


class AllocationResponse(BaseModel):
    feasible: bool
    allocations: list[Allocation]
    total_cost: float
    note: str


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/allocate", response_model=AllocationResponse)
def allocate(req: AllocationRequest) -> AllocationResponse:
    """Meet one order from released stock at minimum cost, using only sources that arrive in time."""
    solver = pywraplp.Solver.CreateSolver("SCIP")
    usable = [s for s in req.sources if s.transit_hours <= req.demand.due_in_hours]
    if not usable:
        return AllocationResponse(feasible=False, allocations=[], total_cost=0.0,
                                  note="No source can deliver before the due time.")

    x = {s.location_id: solver.IntVar(0, s.available, s.location_id) for s in usable}
    solver.Add(sum(x.values()) == req.demand.quantity)
    solver.Minimize(sum(x[s.location_id] * s.cost_per_unit for s in usable))

    if solver.Solve() != pywraplp.Solver.OPTIMAL:
        return AllocationResponse(feasible=False, allocations=[], total_cost=0.0,
                                  note="Not enough on-time stock to cover the full quantity.")

    allocations = [Allocation(location_id=k, quantity=int(v.solution_value()))
                   for k, v in x.items() if v.solution_value() > 0]
    return AllocationResponse(feasible=True, allocations=allocations,
                              total_cost=solver.Objective().Value(), note="Optimal allocation found.")


# ─── Scheduling ──────────────────────────────────────────────────────
# A small job-shop with shared resources. Each job is a chain of tasks (e.g. fill → sterility test
# → QA review → dispatch); each task runs on one of its allowed resources; a resource runs at most
# `capacity` tasks at once. Times are whole hours from "now".

from ortools.sat.python import cp_model


class ScheduleResource(BaseModel):
    id: str
    capacity: int


class ScheduleTask(BaseModel):
    id: str
    duration_hours: int
    resources: list[str]                 # alternatives: exactly one is used
    earliest_start_hours: int = 0
    fixed_start_hours: int | None = None  # already running (a test in progress)


class ScheduleJob(BaseModel):
    id: str
    tasks: list[ScheduleTask]            # in order: each starts after the previous one ends
    due_hours: int | None = None
    weight: int = 1                      # how much lateness on this job matters


class ScheduleRequest(BaseModel):
    horizon_hours: int
    resources: list[ScheduleResource]
    jobs: list[ScheduleJob]
    time_limit_seconds: float = 5.0


class ScheduledTask(BaseModel):
    id: str
    resource: str
    start_hours: int
    end_hours: int


class ScheduledJob(BaseModel):
    id: str
    end_hours: int
    lateness_hours: int
    tasks: list[ScheduledTask]


class ScheduleResponse(BaseModel):
    feasible: bool
    optimal: bool
    jobs: list[ScheduledJob]
    note: str


@app.post("/schedule", response_model=ScheduleResponse)
def schedule(req: ScheduleRequest) -> ScheduleResponse:
    """Schedule every job's tasks on shared resources, minimizing weighted lateness, then finish times."""
    model = cp_model.CpModel()
    horizon = req.horizon_hours
    capacity = {r.id: r.capacity for r in req.resources}
    on_resource: dict[str, list] = {r.id: [] for r in req.resources}
    chosen: dict[tuple[str, str], list] = {}
    starts: dict[tuple[str, str], cp_model.IntVar] = {}
    ends: dict[str, cp_model.IntVar] = {}
    lateness = {}

    for job in req.jobs:
        prev_end = None
        for t in job.tasks:
            unknown = [r for r in t.resources if r not in capacity]
            if unknown or not t.resources:
                return ScheduleResponse(feasible=False, optimal=False, jobs=[],
                                        note=f"Task {job.id}/{t.id} uses unknown resources {unknown or t.resources}.")
            lo = t.fixed_start_hours if t.fixed_start_hours is not None else t.earliest_start_hours
            start = model.NewIntVar(lo, horizon, f"s_{job.id}_{t.id}")
            if t.fixed_start_hours is not None:
                model.Add(start == t.fixed_start_hours)
            end = model.NewIntVar(lo, horizon + t.duration_hours, f"e_{job.id}_{t.id}")
            model.Add(end == start + t.duration_hours)
            literals = []
            for r in t.resources:
                present = model.NewBoolVar(f"p_{job.id}_{t.id}_{r}")
                interval = model.NewOptionalIntervalVar(start, t.duration_hours, end, present, f"i_{job.id}_{t.id}_{r}")
                on_resource[r].append(interval)
                literals.append((r, present))
            model.AddExactlyOne(lit for _, lit in literals)
            chosen[(job.id, t.id)] = literals
            starts[(job.id, t.id)] = start
            if prev_end is not None:
                model.Add(start >= prev_end)
            prev_end = end
        if prev_end is None:
            return ScheduleResponse(feasible=False, optimal=False, jobs=[], note=f"Job {job.id} has no tasks.")
        ends[job.id] = prev_end
        late = model.NewIntVar(0, horizon * 2, f"late_{job.id}")
        if job.due_hours is not None:
            model.Add(late >= prev_end - job.due_hours)
        else:
            model.Add(late == 0)
        lateness[job.id] = (late, job.weight)

    for r, intervals in on_resource.items():
        if intervals:
            model.AddCumulative(intervals, [1] * len(intervals), capacity[r])

    # Lateness dominates; among equally late plans, finish everything as early as possible.
    model.Minimize(sum(late * w * 1000 for late, w in lateness.values()) + sum(ends.values()))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = req.time_limit_seconds
    solver.parameters.num_workers = 4
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return ScheduleResponse(feasible=False, optimal=False, jobs=[],
                                note="No schedule fits within the horizon and capacities.")

    jobs = []
    for job in req.jobs:
        tasks = []
        for t in job.tasks:
            resource = next(r for r, lit in chosen[(job.id, t.id)] if solver.Value(lit))
            start = solver.Value(starts[(job.id, t.id)])
            tasks.append(ScheduledTask(id=t.id, resource=resource, start_hours=start, end_hours=start + t.duration_hours))
        jobs.append(ScheduledJob(id=job.id, end_hours=solver.Value(ends[job.id]),
                                 lateness_hours=solver.Value(lateness[job.id][0]), tasks=tasks))
    optimal = status == cp_model.OPTIMAL
    return ScheduleResponse(feasible=True, optimal=optimal, jobs=jobs,
                            note="Optimal schedule found." if optimal else "Best schedule found within the time limit.")
