# Deployment guide — personal testing (GitHub Pages + Cloudflare Workers + Neon)

**Status:** preparation only (Phase 2.4). No cloud resource has been created, nothing is deployed, no migration has been run, and `IDENTITY_ADAPTER_CONFIGURED` is not enabled. Every step below is a manual step for you to run.

**Scope:** a single-person test environment. No company domains and no custom domains are used. A company/production deployment is a separate, later decision (see `docs/PHASE2-CLOUDFLARE-IMPLEMENTATION-PLAN.md` for the original, now superseded, plan).

## 1. Architecture

```text
MyGeotab (database: opex_trial)            Browser
   └── Add-In (later; see section 10)         └── https://heppyh.github.io/opex-vehicle-booking/
                                                      │   (GitHub Pages, static React app)
                                                      │ HTTPS, CORS allows only https://heppyh.github.io
                                                      ▼
                         https://opex-vbm-api.<account-subdomain>.workers.dev
                              Cloudflare Worker "opex-vbm-api" (Hono)
                              ├── identity: fail-closed (section 9)
                              ├── booking / approval / assignment domain
                              ├── MyGeotab API  → my.geotab.com (database opex_trial)
                              └── env.DB (Hyperdrive "opex-vbm-dev-hyperdrive")
                                        │ pooled connection
                                        ▼
                              Neon PostgreSQL
                              project opex-vbm-dev · database opex_vbm_dev · aws-ap-southeast-1
```

Hyperdrive is a connection pooler and path to your database. It is not a database. D1 is not used.

## 2. Names and URLs

| Item | Value | Where it is configured |
| --- | --- | --- |
| GitHub account / repo | `HeppyH` / `opex-vehicle-booking` | GitHub |
| Frontend URL | `https://heppyh.github.io/opex-vehicle-booking/` | Vite `base` in `apps/web/vite.config.ts` |
| CORS origin | `https://heppyh.github.io` (origin only: no path, no trailing slash, lowercase) | `ALLOWED_ORIGIN` in `apps/api/wrangler.toml` |
| Worker | `opex-vbm-api` | `name` in `apps/api/wrangler.toml` |
| API URL | `https://opex-vbm-api.<account-subdomain>.workers.dev` | GitHub Actions variable `VITE_API_BASE_URL` |
| Neon project / database | `opex-vbm-dev` / `opex_vbm_dev` | Neon console |
| Neon region | Singapore, `aws-ap-southeast-1` (cannot be changed after project creation) | Neon console |
| Hyperdrive config | `opex-vbm-dev-hyperdrive`, Worker binding `DB` | Wrangler / Cloudflare dashboard |
| MyGeotab database | `opex_trial` (unchanged) | `GEOTAB_DATABASE` in `wrangler.toml` |

`<account-subdomain>` is your Cloudflare account's workers.dev subdomain. It is shown in the Cloudflare dashboard under Workers & Pages once the subdomain has been registered. It is a placeholder until then; do not invent it.

## 3. Configuration files

| File | Purpose | Secrets? |
| --- | --- | --- |
| `apps/api/wrangler.toml` | Worker name, `workers_dev`, vars (`APP_ENV`, `ALLOWED_ORIGIN`, `GEOTAB_DATABASE`), commented Hyperdrive binding | None |
| `apps/api/.dev.vars.example` | Template for local `apps/api/.dev.vars` (git-ignored) | Placeholders only |
| `apps/web/.env.example` | Template for local frontend build settings | None (everything `VITE_*` is public) |
| `.github/workflows/deploy-pages.yml` | Builds and publishes the frontend; reads `vars.VITE_API_BASE_URL` | None |
| `geotab/opex-vbm-config.json` | Add-In configuration (see section 10) | None |

## 4. Environment and secrets

| Variable | Deployed Worker | Local (`.dev.vars`) | Secret? |
| --- | --- | --- | --- |
| `APP_ENV` | `personal-test` (hides internal error text) | `development` | No |
| `ALLOWED_ORIGIN` | `https://heppyh.github.io` | `http://localhost:5173` | No |
| `GEOTAB_DATABASE` | `opex_trial` | `opex_trial` | No |
| `DB` (Hyperdrive binding) | Provided by Cloudflare | Not used | Credentials live inside the Hyperdrive config, never in files |
| `DATABASE_URL` | **Never set** | Neon direct or local PostgreSQL URL | Yes |
| `IDENTITY_ADAPTER_CONFIGURED` | **Unset** (fail closed) | `false` | No, but must not be enabled yet |

Rules:

- The Neon connection string and password exist in only three places: the Neon console, the Hyperdrive configuration (Cloudflare), and your own shell session or git-ignored `.dev.vars` when you run migrations.
- Never paste the connection string, a MyGeotab password or a session ID into chat, commits, issues, logs or screenshots.
- `.gitignore` already excludes `.dev.vars`, `.env` and `.env.*` (except `.env.example`).
- The frontend bundle is public. It must never contain a database URL, password, token or MyGeotab credential.
- If a credential is ever exposed, rotate it in Neon (reset the role password) and update the Hyperdrive configuration, then re-test.

## 5. Neon PostgreSQL (manual)

Free-tier limits and pricing change, so check Neon's current plan page when you sign up.

1. Create a Neon account and a project named `opex-vbm-dev`, region **AWS Asia Pacific (Singapore)** (`aws-ap-southeast-1`). The region cannot be changed afterwards.
2. Create (or rename the default) database `opex_vbm_dev`.
3. Use a dedicated role for the app. Do not use an owner or admin role that you also use elsewhere.
4. In Connection Details choose the **direct** connection string, with **connection pooling switched off** (the host has no `-pooler` in it). Cloudflare's Hyperdrive guide for Neon specifies this, because Hyperdrive does its own pooling.
5. Keep the string exactly as Neon gives it, including its TLS parameter. Store it only in your password manager for the next steps.

## 6. Migrations (manual)

Migrations `0001_initial.sql`, `0002_reservation_slots.sql` and `0003_booking_workflow.sql` are applied in filename order by `scripts/migrate.mjs`, which records each file in `schema_migrations` and runs each file in its own transaction. Re-running skips files already applied. The migration files are unchanged by this phase.

```bash
# from the repository root, in a shell you will close afterwards
export DATABASE_URL='<Neon DIRECT connection string>'   # never commit; never put in a file in the repo
npm install
npm run db:migrate
unset DATABASE_URL
```

Expected output: `applied 0001_initial.sql`, `applied 0002_reservation_slots.sql`, `applied 0003_booking_workflow.sql`.

Notes:

- `0001` runs `CREATE EXTENSION pgcrypto` and `btree_gist`. `btree_gist` is required by the no-double-booking exclusion constraint. If Neon refuses either extension for your role, the migration fails inside its transaction and nothing is half-applied. Fix the extension permission, then re-run.
- Migrations are forward-only. There is no automated down-migration. For a throwaway test database the simplest reset is to delete and recreate the Neon database (or use a Neon branch) and re-run.
- To check the result without changing anything: `psql "$DATABASE_URL" -c '\dt'` and `select filename from schema_migrations order by filename;`.

### 6.1 Bootstrap data (manual, nothing is seeded automatically)

The current API has no endpoint that creates users, roles, identity mappings or vehicles. Until those are built, the first records must be inserted by you with SQL, using real values only:

- an `app_users` row for yourself;
- a `role_assignments` row giving that user the roles you want to test (for example `ADMIN`);
- an `identity_mappings` row linking your MyGeotab login to that user for database `opex_trial` (see the column note in section 9);
- the real vehicles, imported from validated company records (plates, Geotab device IDs and capacities are not invented anywhere in this repository).

This is a blocker for any end-to-end booking test (section 12).

## 7. Cloudflare Hyperdrive and Worker (manual)

Prerequisites: a Cloudflare account, Node.js 22, and `npx wrangler login` (an interactive browser login on your own machine).

1. Create the Hyperdrive configuration. This is the only step that handles the connection string, so run it locally:
   ```bash
   npx wrangler hyperdrive create opex-vbm-dev-hyperdrive --connection-string="<Neon DIRECT connection string>"
   ```
   Wrangler verifies the credentials and prints a configuration ID. The ID is an identifier, not a secret.
2. In `apps/api/wrangler.toml`, uncomment the `[[hyperdrive]]` block, keep `binding = "DB"`, and replace `REPLACE_WITH_HYPERDRIVE_CONFIG_ID` with that ID. Commit only that change.
3. Confirm no secrets are set on the Worker and the identity flag is absent: `npx wrangler secret list` should not list a database URL, and `IDENTITY_ADAPTER_CONFIGURED` must not appear in `[vars]`.
4. Deploy from `apps/api`:
    ```bash
    cd apps/api
    npx wrangler deploy
    ```
5. Note the printed URL, `https://opex-vbm-api.<account-subdomain>.workers.dev`. If the account has no workers.dev subdomain yet, Cloudflare asks you to register one; it is part of the URL and cannot be guessed.
6. Verify:
   ```bash
   curl -s https://opex-vbm-api.<account-subdomain>.workers.dev/api/health
   ```
   Expected: `"ok":true`, `"tenantTarget":"opex_trial"`, `"authConfigured":false`. Protected routes must answer `503 AUTH_ADAPTER_NOT_CONFIGURED` while identity is off.

Local development: `npm run dev:api` (Wrangler, port 8787). `wrangler dev` connects straight to the database and bypasses Hyperdrive. For the Hyperdrive binding, Cloudflare documents the environment variable `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` (binding name `DB`) as the local override. Use a local or dev database, never a database you care about, and avoid `wrangler dev --remote`, which writes through the deployed configuration.

Free plan: Hyperdrive is available on the Workers Free plan with a documented limit of 100,000 queries per day (per Cloudflare's pricing page, last updated June 2026). A personal test will not approach it, but a polling frontend could.

## 8. Frontend on GitHub Pages (manual)

GitHub Pages must already be set to **Source: GitHub Actions** (see `docs/GITHUB_PAGES.md`).

1. After the Worker answers `/api/health`, add the repository **variable** (not a secret): Settings → Secrets and variables → Actions → Variables → `VITE_API_BASE_URL` = `https://opex-vbm-api.<account-subdomain>.workers.dev` (no trailing slash).
2. Re-run the workflow "Deploy web to GitHub Pages" (or push to `main`). The build embeds the value; with the variable unset the UI keeps showing "Backend not connected".
3. Open `https://heppyh.github.io/opex-vehicle-booking/`. Expect the status card to show the API as connected while vehicle and booking lists stay locked (identity is off).

## 9. CORS and secure MyGeotab session verification

### CORS

- The Worker allows exactly one browser origin: `ALLOWED_ORIGIN`. A request with any other `Origin` header gets `403 ORIGIN_NOT_ALLOWED`; preflight replies only for the allowed origin.
- `ALLOWED_ORIGIN` must be the browser's origin: `https://heppyh.github.io`. Browsers send the host in lowercase and without the repository path, so `https://heppyh.github.io/opex-vehicle-booking/` or `https://HeppyH.github.io` would never match.
- Allowed methods: `GET, POST, PATCH, OPTIONS`. Allowed request headers: `Content-Type, Authorization, Idempotency-Key, X-Geotab-Session-Id, X-Geotab-User-Name`.
- CORS protects browsers only. It is not authentication; the API's authorisation is the verified principal and role checks.
- For local testing, set `ALLOWED_ORIGIN=http://localhost:5173` in `.dev.vars`. Do not add `*`.
- **Not yet validated:** which `Origin` header the browser sends when the page runs as a MyGeotab Add-In. It may not be `https://heppyh.github.io`. Inspect a real request during the Add-In test (section 10). If it differs, the single-origin check in `src/index.ts` needs a small code change to accept an explicit list. That change is deliberately not made now.

### Verification design (implemented in `src/auth.ts`, kept fail-closed)

1. The Add-In receives an already-signed-in MyGeotab `api` object and sends the user's session ID and login name to the Worker (`X-Geotab-Session-Id` or `Authorization: Bearer`, plus `X-Geotab-User-Name`).
2. If `IDENTITY_ADAPTER_CONFIGURED` is not `"true"`, every protected route returns `503 AUTH_ADAPTER_NOT_CONFIGURED`.
3. The Worker verifies the session itself by calling the MyGeotab API with the user's session. The database is always `GEOTAB_DATABASE`; a database name from the client is never trusted.
4. The login is looked up in `identity_mappings` (`is_active = true`, `database_name = opex_trial`), then roles come from `role_assignments`. A user with no mapping or no role gets no access.
5. Roles are never read from the request.

### Validate against `opex_trial` before enabling (not changed in this phase)

| # | Open question or hardening item |
|---|---|
| 1 | Does `api.getSession` in this tenant return a session ID that the Add-In may pass on? Not confirmed from Geotab documentation read so far. |
| 2 | The session ID is a bearer credential. It travels to the Worker over HTTPS only and must never be logged, stored or echoed. Consider exchanging it once for a short-lived token issued by the Worker. |
| 3 | `TenantValidatedMyGeotabAdapter` defaults to `my.geotab.com`. A database may live on another Geotab server. Any server value must come from an allowlist of Geotab hosts, never from the client (SSRF). |
| 4 | `verifySession` treats a non-error response to `Get User` as valid and does not assert that the returned user matches the login. Geotab rejects mismatched credentials itself, but the check should be asserted in code. |
| 5 | `identity_mappings.geotab_user_id` is compared with the MyGeotab **login name**. Decide whether to store login name or the stable MyGeotab User ID, and keep the column's meaning consistent. |
| 6 | Verification calls Geotab on every request. Geotab rate limits apply per method, entity, user and database, so a short verification cache is needed. |
| 7 | The frontend does not yet read the session or send these headers. |
| 8 | A real Geotab login is needed to test any of this. Use a least-privilege test user, not an administrator, and never share its password. |

Do not set `IDENTITY_ADAPTER_CONFIGURED=true` until these are resolved and tested. If server-side verification cannot be made safe, the fallback is an approved OIDC login with explicit account linking to the MyGeotab user.

## 10. MyGeotab Add-In registration (later, optional for this phase)

The frontend can be tested standalone on GitHub Pages without MyGeotab. Registering it in `opex_trial` needs a tenant administrator and is a separate manual step.

**Blocking finding:** Geotab's Add-In documentation says an externally hosted Add-In's absolute URL must not contain a hyphen (`-`), `@` or `#` anywhere, and gives a hyphenated URL as an example that "will not be loaded correctly". The configured URL `https://heppyh.github.io/opex-vehicle-booking/` has hyphens in its path. Expect it to fail to load inside MyGeotab. Standalone use is unaffected. Options, none applied yet:

1. Serve the app from a hyphen-free path, for example a repository named without hyphens, which also changes the Vite `base` and the Add-In `url`.
2. Serve it from the root of a user site repository named `heppyh.github.io`.
3. Embed the built files in the Add-In configuration (`files`), which Geotab documents as an alternative to external hosting.

Before registering: replace `supportEmail` in `geotab/opex-vbm-config.json` (currently the placeholder `REPLACE_WITH_PERSONAL_SUPPORT_EMAIL`), confirm the URL rule above, and review the tenant's policy for unverified Add-Ins. Keep the target `opex_trial`.

## 11. Verification checklist (after you run the manual steps)

- [ ] Neon project is in `aws-ap-southeast-1`; database `opex_vbm_dev` exists.
- [ ] `schema_migrations` lists `0001`, `0002`, `0003`.
- [ ] Hyperdrive config `opex-vbm-dev-hyperdrive` exists; Worker binding is named `DB`.
- [ ] `GET /api/health` returns `ok: true`, `authConfigured: false`.
- [ ] A protected route returns `503 AUTH_ADAPTER_NOT_CONFIGURED`.
- [ ] A request with `Origin: https://example.com` returns `403 ORIGIN_NOT_ALLOWED`.
- [ ] The Pages site shows the backend as connected and no fabricated vehicle or booking data.
- [ ] No secret appears in `git diff`, the Pages bundle, Worker logs or Actions logs.

## 12. Remaining blockers

1. Neon, Hyperdrive and Worker do not exist yet (manual steps in sections 5 to 7).
2. Identity verification is unvalidated; protected endpoints stay disabled (section 9).
3. No bootstrap path for the first user, role, identity mapping or vehicles (section 6.1).
4. The Add-In URL contains hyphens and is expected to be rejected by MyGeotab (section 10).
5. The Add-In request `Origin` is unknown and may need a multi-origin CORS change (section 9).
6. Frontend session handling and booking screens are not built.

## 13. Rollback

- **Frontend:** re-run an earlier successful "Deploy web to GitHub Pages" workflow run, or revert the commit and push.
- **Worker:** `npx wrangler rollback` returns to the previous Worker version; `npx wrangler deployments list` shows versions. To take the API offline, delete the Worker from the dashboard.
- **Hyperdrive:** remove the `[[hyperdrive]]` block and redeploy; the API then returns database errors but exposes nothing. Delete the config in the dashboard if it is no longer needed.
- **Database:** migrations are forward-only. For a test database, recreate the Neon database (or restore a Neon branch) and re-run migrations. Do not hand-edit `schema_migrations`.
- **Identity:** keep `IDENTITY_ADAPTER_CONFIGURED` unset. That alone disables all protected endpoints.
- **Add-In:** remove the Add-In from `opex_trial` System Settings, or point its URL at the last known-good version.

## 14. Sources

- Cloudflare: [Hyperdrive with Neon](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/neon), [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development), [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing)
- Neon: [Regions](https://neon.com/docs/introduction/regions)
- Geotab: [Developing Add-Ins](https://developers.geotab.com/myGeotab/addIns/developingAddIns/), [Working with Rate Limits](https://developers.geotab.com/myGeotab/guides/rateLimits)
