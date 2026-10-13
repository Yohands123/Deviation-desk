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
