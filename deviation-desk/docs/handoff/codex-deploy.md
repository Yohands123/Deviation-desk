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

- Completed 2026-10-13. Edits are limited to the listed files and Task 1's explicitly permitted
  auth-only change to `services/optimizer/main.py`. No commits, pushes, deployments, account
  creation, real invitations, or hosted-project requests. `.env.production.local` was not loaded.

- **Optimizer container:** `docker build --tag deviation-desk-optimizer:codex-check
  services/optimizer` passed with Python 3.12 and the existing pinned requirements. Ran
  `docker run --detach --rm --name deviation-desk-optimizer-codex-check --publish
  127.0.0.1:18801:8001 deviation-desk-optimizer:codex-check`; `curl.exe --fail --silent --show-error
  http://127.0.0.1:18801/health` returned `{"ok":true}`. `docker exec ... id -u` returned `10001`.
  Inline Python/urllib probes also confirmed unauthenticated `/allocate` and `/schedule` return 200
  when the token is unset. A second temporary container used `--publish 127.0.0.1:18802:18803
  --env PORT=18803 --env OPTIMIZER_TOKEN`: health remained 200, missing/wrong credentials returned
  401, and valid credentials returned 200 with feasible allocation/scheduling results. Both test
  containers were stopped and automatically removed. Docker's engine/build access required sandbox
  approval. An initial startup probe hit a transient connection close; readiness polling then passed.

- **Auth header:** `Authorization: Bearer <token>` (HTTP header names are case-insensitive).
  The middleware covers every HTTP path except exactly `/health`, including `/docs` and
  `/openapi.json`; unauthorized responses include `WWW-Authenticate: Bearer`. Local verification
  used `services/optimizer/.venv/Scripts/python.exe -B -` with an inline harness that launched
  temporary Uvicorn processes on loopback: token unset produced 200; token set produced 401 without
  a correct bearer and 200 with it. An explicitly empty token denies protected requests instead of
  disabling auth. Test tokens existed only in process environment/memory and were not printed.

- **Render preparation:** repo-root `render.yaml` defines exactly one free Docker web service.
  Local PyYAML parsing verified its service fields and Docker paths; paths are relative to
  `rootDir`, per [Render's monorepo documentation](https://render.com/docs/monorepo-support).
  Choose/add a region before creation; omission defaults to Oregon. Supply a non-empty
  `OPTIMIZER_TOKEN` during the Blueprint's `sync: false` prompt and give the app the same value.
  For an existing service or preview, set it manually: `sync: false` prompts only at initial
  Blueprint creation and is omitted from previews. See
  [Render's secret-variable documentation](https://render.com/docs/blueprint-spec#prompting-for-secret-values).
  Free services idle after 15 minutes and take about a minute to wake, which exceeds the current
  app's 3-second health, 15-second allocation and 30-second scheduling timeouts. Allow for this
  before relying on the free service. [Render free-service limits](https://render.com/docs/free#spinning-down-on-idle).

- **Invite verification:** an in-memory Node harness (`node --env-file-if-exists=.env.local` via
  stdin) first confirmed the database was local `127.0.0.1:54322`, then ran
  `node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/invite-users.ts --company
  "Helix Biologics" --map - --dry-run` with a fetch-blocking preload, piped CSV, fake hosted URL
  `https://example.supabase.co`, fake admin key, and `APP_URL=https://app.example.test`.
  Exit 0; all 14 already-linked people were reported as skipped; **0 fetch calls** and identical
  `people.auth_user_id` snapshots before/after. The local-URL refusal check used
  `http://127.0.0.1:54321` and an intentionally unreachable local database on port 1: exit 1 with
  "Local Supabase URLs are refused; the local stack keeps demo logins.", **0 fetch calls**, before
  any DB connection. `--map -` accepts stdin, so no verification CSV/helper file was created.

- **Invite behavior/deployer notes:** `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SECRET_KEY` and `APP_URL` are required. Use the database and admin key from the same
  intended Supabase project. Add `${APP_URL}/login` to its Auth redirect allowlist before sending
  invitations; see [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
  The entire CSV is validated and all names resolved before the first invitation; linked people
  are skipped, and pending people are locked/rechecked before inviting and linking. The script
  stops at the first error and exits 1. If an invite succeeds but its DB link fails, review Auth
  before retrying because an email cannot be rolled back. Actual invitation calls were mocked in
  unit tests, never run against a project.

- **Final checks:** `npm.cmd run test -- scripts/invite-users.test.ts` passed **47 tests**,
  covering CSV parsing, CLI validation, local URL refusal, unlinked dry runs with no Auth client or
  writes, idempotency, world-scoped links and error handling. `npm.cmd run typecheck` and
  `npm.cmd run lint` both passed. `git diff --check` passed. The `.cmd` launchers are equivalent
  to the requested npm commands and avoid the Windows PowerShell execution-policy block.
