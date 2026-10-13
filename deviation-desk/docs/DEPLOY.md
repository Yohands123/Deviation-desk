# Deploying Deviation Desk

The app runs on four services:

| Part | Service | What it needs |
|---|---|---|
| App and API (Next.js) | **Vercel**, project root `deviation-desk` | The environment variables below |
| Database, sign-in, realtime | **Supabase** (hosted project) | Migrations, agent configs and seed run from your machine |
| Workflow engine | **Inngest Cloud** | The app's `/api/inngest` endpoint, synced once |
| Optimizer (Python, OR-Tools) | **Render** (`render.yaml`) | `OPTIMIZER_TOKEN` shared with the app |

Never commit real values. Keep them in `.env.production.local` (git-ignored) on your machine and in
each service's dashboard.

## 1. Supabase

1. Create a project and pick a region near your users. Note:
   - the project URL
   - the publishable (anon) key
   - the secret (service role) key
   - the database password
2. Two connection strings, from Supabase's Connect dialog:
   - **Session pooler or direct** (port 5432): for running scripts from your machine.
   - **Transaction pooler** (port 6543): for Vercel. The app turns prepared statements off for it.
3. From `deviation-desk/`, with `.env.production.local` holding `DATABASE_URL` (the 5432 string),
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`:

   ```
   npx tsx --conditions=react-server --env-file=.env.production.local scripts/migrate.ts
   npx tsx --conditions=react-server --env-file=.env.production.local scripts/sync-agents.ts
   npx tsx --conditions=react-server --env-file=.env.production.local scripts/seed.ts
   ```

   On a hosted project the seed creates the demo company and the drill library, and **no demo
   logins**: a shared password is local-only by design.
4. Invite people (`scripts/invite-users.ts`, with a CSV of `person,email`). Each invite links a
   login to a person in the demo company.
5. Under Authentication → URL configuration, set the Site URL to the Vercel URL and add
   `https://<your-app>/**` to the redirect URLs.

## 2. Optimizer on Render

1. In Render, create a **Blueprint** from the GitHub repo. It reads `render.yaml`.
2. Set `OPTIMIZER_TOKEN` to a long random string. The app sends it as a bearer token.
3. Note the service URL. The free tier sleeps when idle, so the first call after a while is slow.

## 3. Inngest Cloud

1. Create an app and copy the **Event key** and **Signing key**.
2. After the Vercel deploy, sync `https://<your-app>/api/inngest` in Inngest. Vercel's Inngest
   integration does this on every deploy.

## 4. Vercel

1. Import the GitHub repo and set **Root Directory** to `deviation-desk`. The framework is
   detected as Next.js.
2. Environment variables (Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** string (port 6543) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | From Supabase |
| `SUPABASE_SECRET_KEY` | From Supabase (server only) |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | From Inngest. Do **not** set `INNGEST_DEV` |
| `OPTIMIZER_URL`, `OPTIMIZER_TOKEN` | The Render URL and the shared secret |
| `SCHEDULED_AGENTS` | `off` to start with (see Costs) |
| `OUTBOUND_WEBHOOK_URL`, `OUTBOUND_WEBHOOK_SECRET` | Optional. Leave empty and approved messages stay "not configured" |

3. Deploy. Then sync Inngest (step 3.2) and sign in with an invited account.

## Costs and safety switches

- **Paid model calls.** Every agent run calls the Claude API. Per-incident and daily budgets cap
  each agent (CLAUDE.md §12; Phase 7 notes).
- **`SCHEDULED_AGENTS=off`** stops the hourly Auditor and the weekly expansion and learning reviews.
  Watchers, approvals and people-triggered work still run.
- **Drills with "AI agents respond" off** cost nothing.
- **Messages never leave** without `OUTBOUND_WEBHOOK_URL`. Drill messages never leave at all.

## Gotchas met on the first deploy

- **Quoted values.** `.env` files may quote values (`KEY="…"`), but Vercel stores whatever you give
  it, quotes included. A quoted Claude key fails with `401 invalid x-api-key`. Paste values
  without quotes.
- **Sync Inngest after each deploy.** The Vercel–Inngest integration syncs on Git deploys. After a
  CLI deploy, run `curl -X PUT https://<your-app>/api/inngest`. It should answer "Successfully
  registered". Events sent before the sync are not picked up.
- **Deploy from the repo root.** The Vercel project's Root Directory is `deviation-desk`, so CLI
  deploys run from the repo root, which holds a `.vercelignore`.

## Checks after deploying

- `/login` loads and an invited person can sign in.
- `/incidents` lists incidents, and the room shows "Live updates on" (Realtime works).
- Reporting a problem opens an incident with agents running (Inngest is reached and keys are right).
- `/strategy` → "Simulate again" on a proposal finishes (the optimizer is reached and the token is
  right).
