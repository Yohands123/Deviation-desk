# Handoff to Codex: deployment pieces

Deviation Desk is moving from local-only to hosted:

- **App:** Vercel
- **Database, auth and realtime:** a Supabase project
- **Workflow engine:** Inngest Cloud
- **Optimizer:** the Python service in `services/optimizer`, on Render

Claude Code is changing the app itself (`src/`, `db/`, `scripts/seed.ts`, `CLAUDE.md`,
`docs/DEPLOY.md`) in the same working tree. You build two separate pieces. Read `CLAUDE.md` section
2 (principles) and section 15 (conventions) first.

## Ground rules

- **Only create or edit:**
  - `services/optimizer/Dockerfile`
  - `services/optimizer/.dockerignore`
  - `render.yaml` (at the repo root, `C:\Users\yohan\deviation-desk`)
  - `scripts/invite-users.ts`
  - `scripts/invite-users.test.ts` (optional)
  - the Findings section at the end of this file
- **Do not commit, push, deploy, or create accounts.** Never print or write real keys; read secrets
  only from the environment.
- **Do not run anything against a hosted Supabase.** Test only against the local stack, which is
  already running.
- After your changes, `npm run typecheck` and `npm run lint` must stay clean (run from
  `deviation-desk/`).

## Task 1: host the optimizer on Render

The service is FastAPI with OR-Tools (`services/optimizer/main.py`, `requirements.txt`). It serves
`/health`, `/allocate` and `/schedule`. Locally it runs with
`python -m uvicorn main:app --port 8001`.

- **`services/optimizer/Dockerfile`:**
  - base image `python:3.12-slim`, with requirements installed without cache
  - run as a non-root user
  - start with `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}` (Render sets `PORT`)
- **`services/optimizer/.dockerignore`:** exclude `.venv`, `__pycache__` and the rest of the usual
  noise.
- **`render.yaml`** at the repo root, one web service:
  - `name: deviation-desk-optimizer`, `runtime: docker`
  - `rootDir: deviation-desk/services/optimizer`, `healthCheckPath: /health`, `plan: free`
  - region left for the user to choose; add a comment saying so
- **The service must not be open to the world.** Add optional shared-secret auth in `main.py`. This
  is the one edit to `main.py` you may make:
  - when the env var `OPTIMIZER_TOKEN` is set, every endpoint except `/health` requires the header
    `Authorization: Bearer <token>`, and answers 401 otherwise
  - when it is unset, behave exactly as now, so local development is unchanged
  - leave `src/lib/optimizer.ts` alone; Claude adds the header there
  - say in Findings exactly what header name and format you used
- **Verify:** if Docker is available, `docker build` the image and `curl` `/health` against a
  running container. If Docker is not available, say so in Findings. Either way, run the existing
  service locally with and without `OPTIMIZER_TOKEN` and show the 401 and 200 responses.

## Task 2: `scripts/invite-users.ts`

Demo logins (one shared password) are refused against a hosted Supabase on purpose
(`src/db/seed/demo-logins.ts`). On a hosted project, real people get email invites instead.

- **Run like this:**

  ```
  tsx --conditions=react-server --env-file-if-exists=.env.production.local scripts/invite-users.ts --company "Helix Biologics" --map invites.csv [--dry-run]
  ```

  - `invites.csv` has the header `person,email`: one row per person to invite, `person` being the
    exact `people.name` in the company's live world.
  - The script needs these env vars: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
    `SUPABASE_SECRET_KEY`, and `APP_URL` (the site URL, used for the invite redirect `${APP_URL}/login`).
- **For each row:**
  1. Find the person in the company's live world, failing clearly if the name is unknown.
  2. Invite the email with the Supabase admin API (`auth.admin.inviteUserByEmail`, with
     `redirectTo`). Copy how `demo-logins.ts` creates the admin client.
  3. Set `people.auth_user_id` to the new user's id.
- **Idempotent:** a person who already has an `auth_user_id` is skipped and reported, not
  re-invited.
- **`--dry-run`** prints what it would do and writes nothing.
- **Output:** a table of person, email and status, never secrets.
- **Refuse a local Supabase URL**, the opposite of demo-logins: the local stack keeps demo logins.
- **The CSV parser** is small and pure. Unit-test it in `scripts/invite-users.test.ts` if the vitest
  config picks that file up. If it does not, put the parser in the script and note it in Findings.
- **Verify:**
  - run `--dry-run` against the local DB with a fake hosted URL, e.g.
    `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`; it must make no network calls in dry run
  - show that a local URL is refused

## Done when

Both tasks are verified as described, typecheck and lint are clean, and Findings lists:

- the commands you ran and their results
- the optimizer auth header
- anything the deployer must know (e.g. Render free-tier cold starts)

## Findings (Codex writes here)

- (none yet)
