# Phase 2 — Cloudflare Implementation Plan
OPEX Vehicle Booking Management (VBM)

> **Superseded for personal testing (Phase 2.4).** This is the original planning record and is kept unchanged below. The `vbm.opexcg.com` / `api-vbm.opexcg.com` custom-domain targets in it are a possible future company deployment only, not the current configuration. For the active personal-testing setup (GitHub Pages + `workers.dev` + Neon + Hyperdrive) see [DEPLOYMENT.md](DEPLOYMENT.md).

**Status:** planning only. No Cloudflare resources created, no deployment performed.
**Target tenant:** `opex_trial`
**Cloudflare account:** access to be verified manually

---

## 1. Target architecture

```
MyGeotab Portal (tenant: opex_trial)
  └── Custom Page Add-In (React/Vite)
        └── https://heppyh.github.io/opex-vehicle-booking/  (GitHub Pages)
              └── HTTPS API calls
                    └── https://opex-vbm-api.<account-subdomain>.workers.dev  (Cloudflare Worker)
                          ├── Hono API (opex-vbm-api)
                          ├── Verified identity adapter (to be implemented)
                          ├── Booking / approval / assignment domain
                          ├── MyGeotab adapter (scaffold; to be tenant-validated)
                          └── PostgreSQL via Cloudflare Hyperdrive
```

- **Frontend URL:** `https://heppyh.github.io/opex-vehicle-booking/` — GitHub Pages.
- **API URL pattern:** `https://opex-vbm-api.<account-subdomain>.workers.dev` — Cloudflare Worker on `workers.dev`.
- **Database:** PostgreSQL, provisioned separately under a personal account (recommended: Neon). Hyperdrive is the connection path/pooler, **not** the database. D1 is **not** a substitute without explicit approval.
- **Integration:** MyGeotab API against `opex_trial`; real Device/User/Trip/LogRecord data only, no fabricated records.

---

## 2. Cloudflare resources to verify (manual — requires dashboard access)

Before any creation, inspect the dashboard and confirm:

| Resource | What to verify | Notes |
|---|---|---|
| Account access / permissions | Can the authenticated session read Workers, Pages, DNS, Hyperdrive? | Do not assume permissions until verified. |
| Existing Workers | Is `opex-vbm-api` or any same-named Worker already present? | Do not create duplicates. |
| Existing Pages projects | Is there a Pages project for this frontend? | Reuse if present; do not duplicate. |
| Hyperdrive configurations | Any existing Hyperdrive configs? Connection target? | One Hyperdrive config can bind to one PostgreSQL. |
| PostgreSQL / database provider | Is a managed PostgreSQL already provisioned and approved? | Hyperdrive requires an external PostgreSQL host. |
| Secrets / environment config | Existing Worker secrets and Pages env vars? | Never expose tokens/credentials in this doc. |

If any of these already exist, reuse them. Create only what is missing and only after approval.

---

## 3. Existing implementation review

### What is implemented
- `apps/api/src/index.ts` — Hono app with `/api/health`, `/api/me`, `/api/vehicles`, `/api/bookings` (list/create), `/api/bookings/:id/approve` (501 stub), `/api/bookings/:id/assign` (501 stub).
- CORS + origin allowlist middleware keyed on `ALLOWED_ORIGIN`.
- `apps/api/src/env.ts` — `APP_ENV`, `ALLOWED_ORIGIN`, `GEOTAB_DATABASE`, `DATABASE_URL` (local), `DB` (Hyperdrive binding), `IDENTITY_ADAPTER_CONFIGURED`.
- `apps/api/src/db.ts` — `postgres` client factory using `DB.connectionString` or `DATABASE_URL`.
- `apps/api/src/auth.ts` — `resolveVerifiedPrincipal` fails closed (returns null unless `IDENTITY_ADAPTER_CONFIGURED === "true"`), `requirePrincipal`, `requireRole`. Roles: `EMPLOYEE`, `APPROVER`, `GA`, `MANAGEMENT`, `ADMIN`.
- `apps/api/src/services/booking.ts` — `assignApprovedBooking`: transactional assignment with vehicle row lock, idempotency, `reservation_slots` overlap check, active-hold check, audit + outbox + idempotency records.
- `apps/api/src/domain/overlap.ts` — pure interval overlap / buffer helpers (unit-tested).
- `apps/api/src/integrations/mygeotab/{adapter.ts,types.ts}` — adapter interface + scaffold that throws `GEOTAB_ADAPTER_NOT_IMPLEMENTED`.
- `db/migrations/0001_initial.sql` — `app_users`, `role_assignments`, `vehicles`, `bookings`, `booking_approvals`, `vehicle_holds`, `assignments`, `handovers`, `booking_audit`, `notification_outbox`, `idempotency_records`; `pgcrypto` + `btree_gist` extensions.
- `db/migrations/0002_reservation_slots.sql` — GiST exclusion constraint on `(vehicle_id, tstzrange(...)) WHERE active = true`.
- `scripts/migrate.mjs` — local migration runner (requires `DATABASE_URL`).
- `apps/api/wrangler.toml` — Worker `opex-vbm-api`, vars `APP_ENV=development`, `ALLOWED_ORIGIN=https://heppyh.github.io`, `GEOTAB_DATABASE=opex_trial`; Hyperdrive binding commented out (no credentials in file).
- Frontend `apps/web/` — React/Vite Add-In shell, MyGeotab lifecycle (`initialize`/`focus`/`blur`), `VITE_GEOTAB_DATABASE=opex_trial`, `VITE_API_BASE_URL` optional, "Backend not connected" fail-safe, no dummy data.
- `geotab/opex-vbm-config.json` — Add-In JSON pointing at `https://HeppyH.github.io/opex-vehicle-booking/`.
- GitHub Pages workflow `.github/workflows/deploy-pages.yml` — builds frontend, creates `404.html` SPA fallback, deploys to Pages.

### What is incomplete / missing

**Authentication (incomplete):**
- `resolveVerifiedPrincipal` returns `null` until a verified identity proof is implemented. All protected endpoints return `503 AUTH_ADAPTER_NOT_CONFIGURED`.
- No token/session verification, no OIDC linking, no role lookup from DB.
- `IDENTITY_ADAPTER_CONFIGURED` must stay `false` until implemented and reviewed.

**MyGeotab adapter (incomplete):**
- `listDevices`, `listUsers`, `listTrips`, `latestLocations` all throw. Not tenant-validated against `opex_trial`.
- No authentication/session handling/session renewal for the MyGeotab API.

**Endpoints missing / stubbed:**
- `/api/bookings/:id/approve` → 501 `APPROVAL_ENGINE_NOT_IMPLEMENTED`.
- `/api/bookings/:id/assign` → 501 `ASSIGNMENT_TRANSACTION_NOT_IMPLEMENTED` (logic exists in `services/booking.ts` but is not wired to an endpoint).
- No availability-check endpoint.
- No dashboard statistics endpoint.
- No reporting endpoint.
- No audit-logs endpoint.
- No vehicle registration/import endpoint.
- No rejection/cancellation workflow endpoints.

**Database / migrations:**
- Migrations 0001/0002 are ready to apply against a live PostgreSQL (not yet applied anywhere; requires `DATABASE_URL`).
- `reservation_slots` table exists but is not populated by any service/endpoint.
- No seed data (and none should be fabricated).

**Configuration:**
- `wrangler.toml` Hyperdrive binding `DB` is commented out; no Hyperdrive config ID referenced.
- No production secrets configured (ALLOWED_ORIGIN is a var, fine; DB credentials must never be in wrangler.toml).

---

## 4. Booking workflow states (target)

Draft → Pending Approval → Approved → Assigned → Completed  
Alternatives: Rejected, Cancelled  
Roles: Employee, Manager, Fleet Admin, Administrator

Required controls:
- Prevent overlapping vehicle reservations (GiST exclusion constraint + transactional row-lock re-check).
- Prevent concurrent double booking (vehicle `SELECT FOR UPDATE`, idempotency key).
- Role-based authorization (`requireRole`).
- Approval history (`booking_approvals`).
- Audit trail (`booking_audit`).

---

## 5. Deployment sequence (do not execute without approval)

1. **Verify Cloudflare access and permissions** (dashboard read). Confirm account, no existing duplicate `opex-vbm-api` Worker or Pages project.
2. **Provision PostgreSQL separately** (personal managed provider, e.g. Neon). Create dedicated database + least-privilege app role. Enable TLS, backups, PITR. Record connection string (never commit).
3. **Create Hyperdrive config** pointing at the PostgreSQL. Record Hyperdrive config ID.
4. **Configure Worker** `opex-vbm-api`:
   - Bind Hyperdrive as `DB` using the config ID.
   - Set vars: `APP_ENV=production`, `ALLOWED_ORIGIN=https://heppyh.github.io`, `GEOTAB_DATABASE=opex_trial`.
   - Set `IDENTITY_ADAPTER_CONFIGURED=false` (flip to `true` only after verified identity is implemented and reviewed).
   - Uncomment `[[hyperdrive]] binding = "DB"` in `wrangler.toml` with the real config ID.
5. **Deploy Worker** (`cd apps/api && npx wrangler deploy`). Verify `GET /api/health`.
6. **Deploy frontend to GitHub Pages** from `apps/web`, build output `apps/web/dist`.
7. **Set Pages env var** `VITE_API_BASE_URL=https://opex-vbm-api.<account-subdomain>.workers.dev` and `VITE_GEOTAB_DATABASE=opex_trial`; redeploy.
8. **Register Add-In** in `opex_trial` (admin), validate menu placement, view clearance, and DevTools console/network.
9. **Apply migrations** to PostgreSQL via `npm run db:migrate` (with `DATABASE_URL`).

---

## 6. Security boundaries

- Never commit `.env`, `DATABASE_URL`, tokens, or credentials.
- `wrangler.toml` must not contain PostgreSQL URLs or passwords.
- Protected endpoints fail closed (`503 AUTH_ADAPTER_NOT_CONFIGURED`) until identity is verified.
- Do not trust browser-supplied `userId`/role/email.
- CORS exact allowlist (`ALLOWED_ORIGIN`); CSP and security headers to be reviewed before production.
- MyGeotab least-privilege API identity; never use human admin password in Worker secrets.
- No dummy vehicle or booking data; no fabrication.

---

## 7. Estimated effort (planning figures)

| Workstream | Estimate | Dependency |
|---|---|---|
| Cloudflare access verification | 0.5 day | Dashboard access |
| PostgreSQL provisioning + Hyperdrive config | 1–2 days | Provider access |
| Worker + binding + secrets + deploy | 0.5 day | Hyperdrive config ID |
| Pages deploy + env vars | 0.5 day | GitHub Pages setup |
| Verified identity adapter implementation | 2–3 days | Identity/OIDC decision |
| MyGeotab adapter + session handling | 2–3 days | Tenant API access, least-privilege identity |
| Approve/assign endpoints wired to service | 1–2 days | Auth implemented |
| Availability + conflict prevention endpoints | 1–2 days | Database applied |
| Stats / reporting / audit endpoints | 2–3 days | Database applied |
| Add-In registration + tenant validation | 1 day | Tenant admin, deployed frontend |
| UAT + security review + penetration test | 2–5 days | All of above |
| **Total (approx.)** | **~12–20 days** | subject to approvals/access |

---

## 8. Blockers and open questions

1. **Cloudflare access not verified.** Dashboard inspection requires an authenticated session; cannot be completed from this session without credentials.
2. **PostgreSQL not provisioned.** Hyperdrive cannot connect without an external PostgreSQL host. Must be provisioned separately and approved; do not substitute D1.
3. **Identity adapter not implemented.** No decision yet on token verification / OIDC linking. Protected endpoints remain disabled until resolved.
4. **MyGeotab tenant access unconfirmed.** `opex_trial` Device/User/Trip/LogRecord access not yet tested; least-privilege API identity not yet created.
5. **Phase 1.4 files missing.** `docs/PHASE1.4-FRONTEND-VALIDATION.md` and `docs/screenshots-phase1.4/` referenced in Phase 1.4 do not exist in the repository (working tree clean). Nothing to preserve; noted for reconciliation.
6. **No client-side router.** Frontend navigation is tab-based local state; SPA deep-route fallback (`404.html`) is a safety net only. Live GitHub Pages deep-route verification pending.
7. **Playwright not installed.** Desktop/tablet layout testing cannot run without browser dependencies.

---

## 9. Recommended next action (awaiting approval)

Do **not** create Cloudflare infrastructure or deploy backend services yet.

Immediate next step: verify Cloudflare dashboard access and permissions (account, existing Workers/Pages/Hyperdrive), then confirm PostgreSQL provisioning path. Return here with the outcome before any resource creation.
