# Deviation Desk

Incident readiness and response for pharma, biotech, and medical device operations.
A digital twin of the company, a team of single-purpose AI agents, humans in charge of every
consequential decision, and drills that let teams practice before real incidents.

- **Start here:** `CLAUDE.md` (architecture, rules, build phases)
- **Agents:** `docs/AGENTS.md`
- **Data model and realism:** `docs/DOMAIN.md`
- **Design system and voxel world:** `docs/DESIGN.md`

## Quick start
```bash
cp .env.example .env.local   # fill in keys
npm install
npm run db:start             # local Supabase (needs Docker Desktop)
npm run db:migrate && npm run agents:sync && npm run db:seed
npm run dev                  # app
npm run inngest              # workflow dev server
cd services/optimizer && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt  # once
npm run optimizer            # optimizer service on :8001
```
