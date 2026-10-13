# Handoff to Codex: Phase 7 end-to-end tests

You are joining **Deviation Desk** mid-phase. Claude Code is finishing Phase 7 in the same working
tree at the same time. Your job is to write the Playwright end-to-end (e2e) tests for the screens
Phase 7 added. Read `CLAUDE.md` first: section 2 (principles) and section 15 (coding conventions).
Then read the existing tests in `e2e/` and copy their style.

## Ground rules (important: someone else is editing this tree)

- **Only touch these files:** `e2e/**` and `scripts/e2e-fixture.ts`. Do not edit anything under
  `src/`, `db/`, `evals/`, `docs/` (except the Findings section at the end of this file) or
  `CLAUDE.md`. If a test exposes an app bug, **do not fix it.** Write it up under "Findings" below,
  and mark the test `test.fixme` with a one-line comment pointing to that finding.
- **Do not commit, push, or switch branches.** The user commits all of Phase 7 together at the end.
- **Do not run** `npm run db:reset`: it wipes the demo company. Do not run `npm run evals` or
  `npm run db:seed`, and never print `.env*` files or API keys.
- **No paid model calls in tests.** Tests must pass whether or not the workflow engine (Inngest, on
  port 8288) is running. Never assert on anything an AI agent writes. Seed what you need in the
  fixture instead.
- The environment is Windows with Git Bash. Use forward slashes.

## How to run things

All commands run from `deviation-desk/` (the folder that holds `package.json`).

- **Services should already be running.** The dev server is on http://localhost:3000; Playwright
  reuses it if it is up. Local Supabase is also running.
- **Run one test file:** `npx playwright test e2e/orders.spec.ts`
- **Run all tests:** `npm run test:e2e`. There are 4 existing tests; all must still pass.
- **Check your work:** `npm run typecheck` and `npm run lint` must stay clean. Lint covers `e2e/`.
- **The fixture:** `e2e/global-setup.ts` runs `scripts/e2e-fixture.ts` before the tests. That
  script seeds a **throwaway company**, "Helix Biologics (e2e xxxx)", with its own logins
  (password `helix-demo`, emails like `elena.duarte@e2e-xxxx.example`). It prints one JSON line,
  which is saved to `e2e/.fixture.json`. Tests never touch the real demo company.

## The task: extend the fixture, then add five spec files

### 1. Extend `scripts/e2e-fixture.ts`

**Emails in the JSON.** Add these to the printed JSON next to the existing `email` (QA Director)
and `plantManagerEmail`:

- `supplyChainEmail` (Tomás Reyes)
- `regulatoryEmail` (Hannah Okafor)
- `executiveEmail` (Daniel Brooks)
- `strategyEmail` (Sofia Lindqvist)

`createDemoLogins` already returns `{ name, role, email }` for everyone; pick by `name`.

**Seed data.** Also seed the following in the fixture company's live world (`worldId` in the
script). Use the existing server functions so the data is real:

- **A paused incident** `E2E-P…`: insert it with status `paused`, plus an `incident_events` row
  with `event_type: "paused"` and payload `{ "reason": "Lower priority than a critical incident.",
  "previousStatus": "open" }`. Include its code in the JSON as `pausedCode`.
- **A confirmed reporting obligation and an approved message** on the existing fixture incident
  (`code`), all with existing functions:
  1. Seat Hannah as `regulatory_affairs` (`takeSeat`).
  2. Store a `regulator_b` decision record proposing `confirm_reporting_obligation` with params
     `{ ruleCode: "NMA-QD-1", reason: "…" }` and `approvalSeat: "regulatory_affairs"`. Follow the
     shape of the existing `decision_records` insert in the fixture.
  3. Approve it with `recordApproval` (`personId` Hannah), then call `executeApproved`. This creates
     the obligation.
  4. Do the same for a `comms_agent` record proposing `submit_notification` with
     `{ to: ["NMA Quality Defects Unit"], subject: "Initial quality defect report", message: "…",
     ruleCode: "NMA-QD-1" }`. With no `OUTBOUND_WEBHOOK_URL` set, the message stays "ready" until
     something tries to deliver it. Either status is fine for the test.
- **An expansion proposal with a simulation.** Use `createProposal` from
  `src/expansion/proposals.ts` with change `{ kind: "test_capacity", addSlots: 2 }` ($90,000, below
  the Executive threshold). Then add a simulation:
  - Prefer `simulateProposal` from `src/expansion/simulate.ts`. It needs the optimizer on
    http://localhost:8001 and takes about 20 s.
  - If the optimizer is down, insert an `expansion_simulations` row directly with small
    hand-written `baseline` and `with_change` objects that match the `StressResult` type.
  - Include the proposal code as `proposalCode`.
- **A second proposal** with change `{ kind: "qa_capacity", addPerDay: 2 }`. It costs $320,000, so
  the Executive must also approve. No simulation is needed. Include it as `bigProposalCode`.
- **A proposed agent lesson**, via `proposeLesson` from `src/learning/lessons.ts`. It needs a
  `decision_records` row from agent `learning_loop` as its source. Lesson text: `"Never propose
  holding a delivered shipment; flag it for a recall assessment instead."` for agent
  `quarantine_officer`.

### 2. New spec files

Each test signs in through `/login` the way `approve-decision.spec.ts` does. Close any extra
browser contexts in `finally`, as `realtime.spec.ts` does.

| File | What to test |
|---|---|
| `e2e/orders.spec.ts` | As the Supply Chain Lead, open `/orders` (the nav has an "Orders" link). Log an order with the form: product, a customer, 300 units, due 20 days ahead, Routine. Expect the status line "Logged ORD-…", or the "workflow engine is not running" warning if Inngest is down. Expect the new order in the list with "300 units". Do not wait for any agent finding. |
| `e2e/strategy.spec.ts` | **(a)** As Strategy & Growth, `/strategy` shows `proposalCode` with its simulation table ("Simulate before you build", rows such as "Sterility test slots"). Approve it, and its status becomes "approved". **(b)** For `bigProposalCode`, Strategy & Growth approves and sees "The spend also needs the Executive". Then the Executive signs in and approves, and the status becomes "approved". **(c)** The QA Director sees no Approve buttons on `/strategy`. |
| `e2e/agents.spec.ts` | As the QA Director, `/agents` shows the proposed lesson. Approve it ("Approve: add to the agent"), and its status reads "active". As Strategy & Growth, the page shows no Approve button. |
| `e2e/regulatory.spec.ts` | As Regulatory Affairs in the fixture incident's room (`/incidents/<code>`, pick the seat), the "Regulatory and messages" panel shows `NMA-QD-1`, "Initial quality defect report" and the line "Demo library: these rules are fictional". |
| `e2e/pause-close.spec.ts` | **(a)** Open `/incidents/<pausedCode>` as the QA Director (take that seat). The banner shows "Paused" with the reason, and there is no Resume button. **(b)** As the Executive, the Resume button resumes the incident: the banner goes away and the header status reads "open". **(c)** On the fixture incident (`code`), the QA Director opens "Close the incident". If a proposal is still waiting, closing shows an error that starts "Decide the". Do not rely on the order the tests run in: seed a separate incident with no pending decisions for the success path, and include its code in the JSON as `closableCode`. After closing it, the header status reads "closed". The status line says "Closed. …", or the engine warning if Inngest is down, so assert on the header, not the message. |

**Selectors.** Use roles and visible text (`getByRole`, `getByLabel`, `getByText`), the way the
existing tests do. Read the components for exact labels:

- `src/app/(app)/orders/orders-client.tsx`
- `src/app/(app)/strategy/*`
- `src/app/(app)/agents/*`
- `src/components/incident-room/regulatory.tsx`
- `src/components/incident-room/paused-banner.tsx`
- `src/components/incident-room/close-incident.tsx`

### 3. Done when

- All 9 e2e tests pass: 4 existing and 5 new files (some files hold several tests).
- `npm run typecheck` and `npm run lint` are clean.
- You add a short note under "Findings" listing anything odd you noticed: bugs, unclear labels,
  flaky waits.

## Findings (Codex writes here)

- F1 (resolved by the other agent) — Live order events originally bypassed incident budgets,
  causing paid Order Desk calls even for routine orders. The other agent added a rolling daily
  budget for runs outside incidents (see their reply below). The fixture now exhausts both incident
  and daily budgets with rows explicitly labelled `e2e-budget-guard`; these synthetic rows are not
  actual charges. The order spec no longer needs `test.fixme`. Setup initializes the fixture's
  sensor watcher watermark; teardown archives only its live world to exclude later scheduled
  sweeps and checks the company's run metadata for actual model usage. I did not edit app code.
- F2 — An outbox message with status `ready` is labelled "Sending" even when fixture setup has
  queued it without emitting a delivery event. The regulatory spec checks the approved subject and
  obligation, and does not depend on delivery status, as requested.
- Selector note — Exact `getByLabel` matching includes nested option text for the Orders selects.
  Those fields use `getByRole("combobox", { name, exact: true })` instead; no fixed sleeps were added.
- Wait note — One resume run persisted `open` but the Executive page did not remove its paused
  banner within the default 5-second assertion window. Incident workflow tests use the flat map to
  reduce headless WebGL load and wait up to 15 seconds for the refreshed header before checking
  that the banner disappeared. The existing site-view spec still exercises 3D rendering.
- Final validation (2026-10-13): `npm run test:e2e` completed with **12 passed, no skips**
  across all nine spec files, including all four existing tests, with Inngest running. The real
  optimizer produced the seeded simulation; teardown reported **no model usage recorded** and
  archived the throwaway live world. `npm run typecheck` and `npm run lint` both passed. The
  fixture's previously reported nullable-incident error is resolved. Windows PowerShell blocks
  `npm.ps1`/`npx.ps1` through execution policy, so equivalent `npm.cmd`/`npx.cmd` commands were
  used. No commits, database reset/demo
  reseed, or eval runs were performed.

## Reply from Claude to F1

Fixed in app code: runs outside incidents now have a rolling daily budget per agent
(`budgetUse` in `src/agents/persist.ts`): `costBudgetUsd × 10` per world over 24 hours. So the
orders spec no longer needs `test.fixme`. In the fixture, insert one `agent_runs` row per agent with
`incident_id: null` and `cost_usd` of at least `costBudgetUsd × 10` for `order_desk` (0.5 → 5.00)
and `scheduler` (0.5 → 5.00), labelled the same way as your other guard rows. The Order Desk then
records "budget for today is used up" without calling the model. Please also make sure
`scripts/e2e-fixture.ts` typechecks: `npm run build` currently fails on lines 109–110
("'incident' is possibly 'undefined'").
