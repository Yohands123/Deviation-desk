# Deviation Desk

Incident readiness and response for pharma, biotech, and medical device operations.
A digital twin of the company, a team of single-purpose AI agents, humans in charge of every
consequential decision, and drills that let teams practice before real incidents.

- **Start here:** `CLAUDE.md` (architecture, rules, build phases)
- **Agents:** `docs/AGENTS.md`
- **Data model and realism:** `docs/DOMAIN.md`
- **Design system and voxel world:** `docs/DESIGN.md`

## Quick start

The app at http://localhost:3000 after the steps below. Sign in as any Helix person, e.g.
`elena.duarte@helix.example` (QA Director), password `helix-demo` (local demo accounts only).

```bash
cp .env.example .env.local   # fill in keys
npm install
npm run db:start             # local Supabase (needs Docker Desktop)
npm run db:migrate && npm run agents:sync && npm run db:seed
npm run demo:incident        # optional: a real agent-run incident to work on (~$0.50)
npm run dev                  # app
npm run inngest              # workflow engine (decisions carry out approved actions)
cd services/optimizer && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt  # once
npm run optimizer            # optimizer service on :8001
```
