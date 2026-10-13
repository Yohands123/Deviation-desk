# Deviation Desk

Incident readiness and response for pharma, biotech, and medical device operations.
A digital twin of the company, a team of single-purpose AI agents, humans in charge of every
consequential decision, and drills that let teams practice before real incidents.

- **Start here:** `CLAUDE.md` (architecture, rules, build phases)
- **Agents:** `docs/AGENTS.md`
- **Data model and realism:** `docs/DOMAIN.md`
- **Design system and voxel world:** `docs/DESIGN.md`

## Quick start (after Phase 0)
```bash
cp .env.example .env.local   # fill in keys
npm install
npm run dev                  # app
npm run inngest              # workflow dev server
cd services/optimizer && pip install -r requirements.txt && uvicorn main:app --reload --port 8001
```
