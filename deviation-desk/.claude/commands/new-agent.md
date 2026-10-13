---
description: Add a new agent following the agent contract
argument-hint: <agent_id and one-sentence job>
---
Add the agent described here: $ARGUMENTS

Follow CLAUDE.md §7 and docs/AGENTS.md exactly:
1. Confirm it has one job. If it has two, propose splitting it and stop.
2. Add its row to docs/AGENTS.md (job, tier, wakes on, tools, output, seat, never).
3. Add its AgentConfig (registry or agent_configs table, depending on the current phase), with explicit limits.
4. Add or reuse tools; every tool filters by worldId from the context and never takes SQL from the model.
5. Wire its trigger event in src/workflows/.
6. Add at least one eval scenario in evals/scenarios/ that exercises it.
7. Run typecheck, tests, and evals.
