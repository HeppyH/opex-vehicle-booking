# Phase 2.5.1 — Neon PostgreSQL Development Readiness Report

**Project:** OPEX Vehicle Booking Management (OPEX VBM)  
**Branch:** `main`  
**HEAD:** `28f2e81222f306363034c8bb02687a2f3a350b55`  
**Date:** 2026-11-11  
**Prepared by:** Kilo (software engineering agent)  
**Verification date:** 2026-11-11  
**Status:** Prepared only — NO cloud resources created, NO deployments, NO migrations run, NO commits, NO pushes

---

## 1. Executive Summary

**Verdict: PASS**

The codebase is in a clean, pre-provisioning state ready for Neon Free plan PostgreSQL development. All Phase 2.4 personal-testing changes are merged to `main`. The working tree is clean at the expected HEAD commit. Migrations 0001–0003 are additive-only PostgreSQL, compatible with Neon Free. The connection design supports both direct `DATABASE_URL` (local/migrations) and Hyperdrive `DB` binding (deployed Worker). No code changes are required. All strict restrictions observed: no cloud resources created, no migrations executed, no deployments, no commits/pushes, no existing work overwritten, no `IDENTITY_ADAPTER_CONFIGURED` enabled.

---

## 2. Preconditions Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Branch | `main` | `main` | PASS |
| HEAD commit | `28f2e81222f306363034c8bb02687a2f3a350b55` | `28f2e81` (matches) | PASS |
| Working tree | Clean | Clean | PASS |
| Upstream in sync | origin/main | Up to date | PASS |
| Remote | `https://github.com/HeppyH/opexassetbooking.git` | Confirmed | PASS |

---

## 3. Neon Free Plan Verification

**Verdict: PASS**

Source: https://neon.com/docs/introduction/plans (last updated 2026-11-11)  
Source: https://neon.com/faqs/free-plan-limits-and-quotas (last updated 2026-11-03)  
Source: https://neon.com/docs/introduction/scale-to-zero (last updated 2026-11-04)

| Resource | Free Plan Limit | OPEX VBM Requirement | Status |
|----------|----------------|----------------------|--------|
| Cost | $0/month, no credit card required | $0 target | PASS |
| Projects | 100 | 1 (`opex-vbm-dev`) | PASS |
| Branches per project | 10 | 1 (main) + optional test branches | PASS |
| Compute | 100 CU-hours per project per month | Personal dev/testing | PASS |
| Autoscaling max | 2 CU (~8 GB RAM) | Light API workload | PASS |
| Scale to zero | 5 min inactivity, cannot be disabled on Free | Idle cost control | PASS |
| Postgres storage | 1 GB per project, 20 GB across all projects | Schema + test data | PASS |
| Public network transfer | 5 GB per project per month | API + Hyperdrive traffic | PASS |
| Instant restore history | 6 hours, capped at 1 GB change history | Dev recovery | PASS |
| Manual snapshots | 1 | Not needed for dev | PASS |
| Region `aws-ap-southeast-1` (Singapore) | Available | Preferred region | PASS |
| `pgcrypto` extension | Supported | Required by migration 0001 | PASS |
| `btree_gist` extension | Supported | Required by migration 0002 | PASS |

### Billing behavior when limits are reached (Free plan)

- **CU-hours exhausted:** Compute is suspended until the next monthly billing period. No automatic charges.
- **Network transfer exhausted:** Compute is suspended until the next monthly billing period. No automatic charges.
- **Storage cap (1 GB/project) exceeded:** Write operations that would increase storage fail until space is freed or an upgrade is performed. No automatic overage billing.
- **Automatic paid upgrade:** Does NOT occur on the Free plan. Operations fail rather than triggering charges.

### Scale-to-zero behavior

- Compute suspends after 5 minutes of inactivity.
- Cannot be disabled on the Free plan.
- Resumes within a few hundred milliseconds on the next query.
- Suspended time does not count against CU-hours.

### Migration execution on Neon Free

Migration DDL (CREATE TABLE, ALTER TABLE, CREATE EXTENSION, CREATE INDEX) counts as database queries via Hyperdrive or direct connections. With `max: 5` connections and light personal usage, the 100 CU-hour monthly allowance is sufficient.

---

## 4. Cloudflare Free Plan Verification

**Verdict: PASS**

Source: https://developers.cloudflare.com/workers/platform/limits/ (verified 2026-11-11)  
Source: https://developers.cloudflare.com/workers/platform/pricing/ (last updated Oct 2, 2026)  
Source: https://developers.cloudflare.com/hyperdrive/platform/pricing/ (last updated Jun 18, 2026)

| Resource | Free Plan Limit | OPEX VBM Requirement | Status |
|----------|----------------|----------------------|--------|
| Worker requests | 100,000/day (resets 00:00 UTC) | Personal testing | PASS |
| CPU time per HTTP request | 10 ms | API logic is lightweight | PASS |
| CPU time explanation | CPU time measures active computation only; waiting on network requests, `fetch()`, KV reads, database queries, and other I/O does NOT count toward CPU time | DB queries via Hyperdrive do not consume the 10 ms CPU budget | PASS |
| Memory per isolate | 128 MB | Worker code + Hono framework | PASS |
| Subrequests | 50/request | Within limits | PASS |
| Simultaneous outgoing connections | 6/request | Within limits | PASS |
| Environment variables | 64/Worker, 5 KB each | APP_ENV, ALLOWED_ORIGIN, GEOTAB_DATABASE only | PASS |
| Hyperdrive database queries | 100,000/day | Personal testing volume | PASS |
| Hyperdrive inclusion | Included in Workers Free plan | No extra charge | PASS |
| workers.dev subdomain | Available without custom domain | `opex-vbm-api.<subdomain>.workers.dev` | PASS |
| Custom domain required | No | None used | PASS |

### Billing behavior when limits are reached (Free plan)

- **Request limit exceeded:** Cloudflare returns Error 1027. No automatic upgrade or charges.
- **CPU time exceeded:** Request fails with Error 1102. No automatic upgrade or charges.
- **Hyperdrive query limit exceeded:** Further database operations fail with an error. No automatic charges.
- **Automatic paid upgrade:** Does NOT occur on the Free plan. Operations fail rather than triggering charges.

---

## 5. Proposed Architecture

| Tier | Technology | URL / Name | Cost |
|------|-----------|------------|------|
| Frontend | GitHub Pages | `https://heppyh.github.io/opexassetbooking/` | Free |
| API | Cloudflare Worker | `https://opex-vbm-api.<account-subdomain>.workers.dev` | Free |
| Database | Neon PostgreSQL | Project `opex-vbm-dev`, database `opex_vbm_dev` | Free |
| Region | AWS `aws-ap-southeast-1` (Singapore) | — | Free |
| Connection pooling | Cloudflare Hyperdrive | Config `opex-vbm-dev-hyperdrive` (binding `DB`) | Free |
| MyGeotab tenant | `opex_trial` | Hardcoded in `wrangler.toml`, never client-supplied | N/A |

**Target monthly cost: USD $0**, subject to verified Free plan limits. No automatic paid upgrade on either platform.

---

## 6. Full Migration Review

**Verdict: PASS**

### Migration 0001 — `db/migrations/0001_initial.sql`

Creates `pgcrypto` and `btree_gist` extensions, then creates: `app_users`, `role_assignments`, `vehicles`, `bookings`, `booking_approvals`, `vehicle_holds`, `assignments`, `handovers`, `booking_audit`, `notification_outbox`, `idempotency_records`.

| Review item | Finding | Status |
|-------------|---------|--------|
| PostgreSQL compatibility | Native SQL (`timestamptz`, `jsonb`, `numeric`, `uuid`, `CHECK`, partial indexes) | PASS |
| `pgcrypto` extension | `CREATE EXTENSION IF NOT EXISTS pgcrypto` — supported on Neon Free | PASS |
| `btree_gist` extension | `CREATE EXTENSION IF NOT EXISTS btree_gist` — supported on Neon Free; required for GiST exclusion in 0002 | PASS |
| UUID primary keys | `gen_random_uuid()` from pgcrypto on all tables | PASS |
| Foreign keys | All reference `app_users(id)` or related tables with `ON DELETE` where appropriate | PASS |
| Indexes | B-tree indexes on `bookings(requester_id, start_at)`, `bookings(status, start_at)`, `booking_audit(entity_type, entity_id, occurred_at)`, partial unique index `one_active_assignment_per_booking` | PASS |
| CHECK constraints | Status enums, `end_at > start_at`, `passenger_capacity > 0`, `buffer_* >= 0`, role enum, decision enum | PASS |
| Tenant isolation | None at schema level (enforced at application layer via `GEOTAB_DATABASE` + `identity_mappings.database_name`) | PASS |

### Migration 0002 — `db/migrations/0002_reservation_slots.sql`

Creates `reservation_slots` with a GiST exclusion constraint.

| Review item | Finding | Status |
|-------------|---------|--------|
| GiST exclusion constraint | `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(reserved_from, reserved_until, '[)') WITH &&) WHERE (active = true)` — requires `btree_gist` (created in 0001) | PASS |
| `tstzrange` overlap prevention | Native PostgreSQL range type, `&&` overlap operator, `'[)'` bounds | PASS |
| Partial constraint | `WHERE (active = true)` — only active slots participate in exclusion | PASS |
| Neon compatibility | GiST indexes and exclusion constraints fully supported on Neon | PASS |

### Migration 0003 — `db/migrations/0003_booking_workflow.sql`

Additive only: adds `geotab_last_synced_at`, `geotab_sync_version` to `vehicles`; creates `mygeotab_cache` (with `expires_at` TTL column); creates `identity_mappings` (tenant-scoped MyGeotab user → app user link).

| Review item | Finding | Status |
|-------------|---------|--------|
| Additive only | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS` — no existing tables/columns altered or dropped | PASS |
| Foreign keys | `identity_mappings.app_user_id` → `app_users(id) ON DELETE CASCADE` | PASS |
| `mygeotab_cache` TTL | `expires_at timestamptz NOT NULL` column + index on `expires_at` for cleanup queries | PASS |
| Tenant isolation | `identity_mappings.database_name` defaults to `'opex_trial'`, `UNIQUE (geotab_user_id, database_name)` | PASS |
| Requires extensions | `pgcrypto` (gen_random_uuid) and `btree_gist` — both created in 0001 | PASS |
| Rollback documented | Drop columns from `vehicles`, drop `identity_mappings` and `mygeotab_cache` tables | PASS |

### Migration ordering and risks

- Order: 0001 → 0002 → 0003 (0002 requires `btree_gist` from 0001; 0003 requires both extensions from 0001 and tables from 0001).
- No existing tables or constraints are modified or dropped.
- `scripts/migrate.mjs` applies files in sorted order, one transaction per migration, tracks in `schema_migrations` table.
- **Risk: none identified.** All migrations are PostgreSQL-native and additive.

---

## 7. Database Connection Review

**Verdict: PASS**

### `apps/api/src/db.ts:4–12`

```typescript
export function sqlFor(env: Env) {
  const connectionString = env.DB?.connectionString || env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_CONNECTION_NOT_CONFIGURED");
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
}
```

| Setting | Value | Rationale | Status |
|---------|-------|-----------|--------|
| Driver | `postgres` (node-postgres compatible) | Works with Hyperdrive and direct Neon connections | PASS |
| `max` | 5 | Conservative pool, well within Neon Free and Hyperdrive limits | PASS |
| `idle_timeout` | 20 seconds | Idle connections close quickly, cost-conscious | PASS |
| `connect_timeout` | 10 seconds | Fails fast if Neon unreachable | PASS |
| `prepare` | `false` | Required for Hyperdrive compatibility (Hyperdrive does not support prepared statements) | PASS |
| Connection source | `env.DB?.connectionString` (Hyperdrive, deployed) → `env.DATABASE_URL` (local/migrations) | Correct environment separation | PASS |

### `apps/api/src/env.ts`

| Variable | Scope | Security property | Status |
|----------|-------|-------------------|--------|
| `APP_ENV` | `wrangler.toml` + `.dev.vars` | Hides internal errors when not `"development"` | PASS |
| `ALLOWED_ORIGIN` | `wrangler.toml` | Exact origin CORS enforcement, no wildcard | PASS |
| `GEOTAB_DATABASE` | `wrangler.toml` | Hardcoded `"opex_trial"`, never from client | PASS |
| `DATABASE_URL?` | Local/.dev.vars only, never on deployed Worker | Credentials never deployed | PASS |
| `DB?` | Hyperdrive binding, deployed Worker only | Connection string managed by Cloudflare | PASS |
| `IDENTITY_ADAPTER_CONFIGURED?` | Unset in `wrangler.toml` | Fail-closed: protected endpoints return 503 until configured | PASS |

### `apps/api/wrangler.toml`

- `workers_dev = true` — serves on `workers.dev` subdomain (no custom domain)
- Hyperdrive binding `[[hyperdrive]] binding = "DB"` commented out — uncomment only after Hyperdrive config exists
- No secrets, no PostgreSQL URLs, no MyGeotab credentials in the file

### `apps/api/src/index.ts` — connection usage

| Endpoint | Auth | DB usage | Status |
|----------|------|----------|--------|
| `GET /api/health` | None | No DB (returns env info only) | PASS |
| `GET /api/me` | `requirePrincipal` | No DB (returns principal from auth) | PASS |
| `GET /api/vehicles` | `requirePrincipal` | `SELECT` from `vehicles`, `sql.end()` in `finally` | PASS |
| `GET /api/bookings` | `requirePrincipal` | `SELECT` from `bookings` filtered by `requester_id` | PASS |
| `POST /api/bookings` | `requirePrincipal` | `INSERT` into `bookings` + `booking_audit`, `sql.end()` in `finally` | PASS |
| `POST /api/bookings/:id/submit-for-approval` | `requirePrincipal` | `SELECT ... FOR UPDATE` + `UPDATE` + audit | PASS |
| `POST /api/bookings/:id/approve` | `requirePrincipal` + `requireRole` | Transaction via `approveBooking()` | PASS |
| `POST /api/bookings/:id/reject` | `requirePrincipal` + `requireRole` | Transaction via `rejectBooking()` | PASS |
| `POST /api/bookings/:id/assign` | `requirePrincipal` + `requireRole` | Transaction via `assignApprovedBooking()` with idempotency | PASS |
| `POST /api/bookings/:id/cancel` | `requirePrincipal` | Transaction via `cancelBooking()` | PASS |
| Error handler | — | Returns generic error in non-development `APP_ENV` | PASS |

### `apps/api/src/auth.ts` — authentication

- `resolveVerifiedPrincipal()` fails closed: returns `null` if `IDENTITY_ADAPTER_CONFIGURED !== "true"` (currently unset → all protected endpoints return 503)
- MyGeotab session verified server-side via `TenantValidatedMyGeotabAdapter.verifySession()`
- Database validated against `env.GEOTAB_DATABASE` (`opex_trial`), never trusted from client
- Identity mapped via `identity_mappings` table (migration 0003)
- Roles loaded from `role_assignments` table (migration 0001)
- `requirePrincipal` middleware returns 503 `AUTH_ADAPTER_NOT_CONFIGURED` when no principal

### `apps/api/src/services/booking.ts` — transactional booking operations

- `assignApprovedBooking()`: `sql.begin()` transaction; vehicle row `FOR UPDATE`; booking `FOR UPDATE`; idempotency check; conflict check via `reservation_slots` GiST exclusion; hold check; `INSERT` into `assignments`, `reservation_slots`, `booking_audit`, `idempotency_records`
- `approveBooking()` / `rejectBooking()`: `sql.begin()` transaction; `booking_approvals` record; status transition; audit
- `cancelBooking()`: `sql.begin()` transaction; status transition; deactivates reservation slot; audit

### `apps/api/src/integrations/mygeotab/adapter.ts` — MyGeotab integration

- Scaffold implementation: `listDevices`, `listUsers`, `listTrips`, `latestLocations` all throw `GEOTAB_ADAPTER_NOT_IMPLEMENTED`
- `verifySession()` calls MyGeotab `Get` on `User` with session credentials; returns `{ valid: true, database, userName }`
- Server is `my.geotab.com` by default, configurable
- No credentials stored in source code

### `scripts/migrate.mjs` — migration runner

- Requires `DATABASE_URL` env var (never committed)
- Single connection (`max: 1, prepare: false`)
- Creates `schema_migrations` table if not exists
- Applies `.sql` files in sorted order, one transaction per migration
- Skips already-applied migrations

---

## 8. Security Assessment

**Verdict: PASS**

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| MyGeotab target database `opex_trial` | `GEOTAB_DATABASE = "opex_trial"` hardcoded in `wrangler.toml`; never accepted from frontend | PASS |
| `IDENTITY_ADAPTER_CONFIGURED` disabled | Not defined in `wrangler.toml`; `resolveVerifiedPrincipal()` returns `null` when unset | PASS |
| Authentication fail-closed | Protected endpoints return 503 until adapter configured and verified | PASS |
| No frontend-trusted user IDs/roles | Principal resolved server-side from MyGeotab session + `identity_mappings` | PASS |
| No secrets in source/frontend | No DB URLs, passwords, or MyGeotab credentials in `wrangler.toml` or source | PASS |
| CORS origin locked | `ALLOWED_ORIGIN = "https://heppyh.github.io"`; exact match enforcement | PASS |
| Error message hygiene | `APP_ENV === "personal-test"` returns generic `"Unexpected error"`; internal messages only in `"development"` | PASS |
| Personal accounts only | GitHub: HeppyH; personal Cloudflare; personal Neon | PASS |
| No company/custom domains | No `opex.com`, `opexcg.com`, or custom domains; `workers.dev` + GitHub Pages only | PASS |

---

## 9. Cost and Billing Risks

**Verdict: PASS (with monitoring recommendation)**

| Risk | Likelihood | Impact | Mitigation | Status |
|------|-----------|--------|------------|--------|
| Neon CU-hours exceeded (100/month) | Low for personal dev | Compute suspended until next billing period | Scale-to-zero after 5 min idle; `max: 5` pool | PASS |
| Neon storage exceeded (1 GB/project) | Low for dev/test data | Writes that grow storage fail | Monitor storage; delete test data | PASS |
| Neon network transfer exceeded (5 GB/month) | Low for personal testing | Compute suspended until next period | Light API usage expected | PASS |
| Cloudflare requests exceeded (100k/day) | Low for personal testing | Error 1027 on excess requests | Low traffic expected | PASS |
| Cloudflare CPU exceeded (10 ms/request) | Low for simple API | Error 1102 on excess CPU | CPU time excludes DB/network wait | PASS |
| Hyperdrive queries exceeded (100k/day) | Low for personal testing | DB operations fail | Light usage expected | PASS |
| Automatic paid upgrade | None on Free plans | N/A | Both platforms fail rather than upgrade | PASS |
| Unexpected billing | None possible on Free plans | $0 | No credit card required for Neon Free; Cloudflare Free has no auto-upgrade | PASS |

**Confirmed vs. account-specific:** All Free plan limits above are confirmed from official documentation. Account-specific billing settings (spending alerts, payment methods on paid plans) cannot be verified without accessing the personal accounts, which is outside scope.

---

## 10. Manual Provisioning Instructions (Reference Only — NOT Executed)

1. Create Neon project `opex-vbm-dev` in region `aws-ap-southeast-1`, database `opex_vbm_dev`
2. Record the Neon DIRECT connection string (not pooled, for Hyperdrive)
3. Run migrations locally: `DATABASE_URL=<Neon direct URL> node scripts/migrate.mjs`
4. Create Cloudflare Hyperdrive config `opex-vbm-dev-hyperdrive` with the Neon connection string
5. Uncomment `[[hyperdrive]]` block in `wrangler.toml`, insert the Hyperdrive config ID
6. Deploy Worker: `wrangler deploy`
7. Verify API at `https://opex-vbm-api.<account-subdomain>.workers.dev`

---

## 11. Migration Execution Prerequisites

Before running `scripts/migrate.mjs` against Neon:

- [ ] Neon project `opex-vbm-dev` created in `aws-ap-southeast-1`
- [ ] Database `opex_vbm_dev` provisioned
- [ ] `DATABASE_URL` set in shell (Neon DIRECT connection string, not committed)
- [ ] `pgcrypto` and `btree_gist` extensions available (Neon supports both)
- [ ] Migration order: 0001 → 0002 → 0003
- [ ] `schema_migrations` table will be created automatically by the runner

---

## 12. Remaining Blockers

| Blocker | Reason | Resolution required |
|---------|--------|---------------------|
| Neon project not created | Strict restriction: no cloud resources created | Explicit user approval to provision |
| Cloudflare Worker not deployed | Strict restriction: no deployments | Explicit user approval to deploy |
| Hyperdrive config not created | Strict restriction: no Hyperdrive configurations | Explicit user approval to create Hyperdrive |
| Migrations not executed | Strict restriction: no migrations run | Explicit user approval to run migrations |
| `IDENTITY_ADAPTER_CONFIGURED` unset | Protected endpoints return 503 until configured | MyGeotab session verification must be validated first (docs/DEPLOYMENT.md section 9) |
| MyGeotab adapter scaffold | `listDevices`, `listUsers`, `listTrips`, `latestLocations` throw `GEOTAB_ADAPTER_NOT_IMPLEMENTED` | Adapter implementation required for full MyGeotab integration |

No blockers prevent proceeding to provisioning upon explicit approval.

---

## 13. Final Readiness Verdict

**Phase 2.5.1 Neon readiness: PASS**

All sections verified:

1. Executive summary — PASS
2. Preconditions (git state) — PASS
3. Neon Free plan verification — PASS
4. Cloudflare Free plan verification — PASS
5. Proposed architecture — PASS
6. Full migration review — PASS
7. Database connection review — PASS
8. Security assessment — PASS
9. Cost and billing risks — PASS
10. Manual provisioning instructions — documented, not executed
11. Migration execution prerequisites — documented
12. Remaining blockers — identified, require explicit approval

**No code changes required.** Ready to proceed to resource provisioning upon explicit user approval.

---

## 14. Official Source URLs and Verification Date

| Source | URL | Verified | Content |
|--------|-----|----------|---------|
| Neon Plans | https://neon.com/docs/introduction/plans | 2026-11-11 | Free plan CU-hours, storage, branches, autoscaling, scale-to-zero, regions |
| Neon Free Plan FAQ | https://neon.com/faqs/free-plan-limits-and-quotas | 2026-11-11 | 100 projects, 10 branches, 100 CU-hours, 1 GB storage, 5 GB network, billing behavior |
| Neon Scale to Zero | https://neon.com/docs/introduction/scale-to-zero | 2026-11-11 | 5-minute inactivity, cannot disable on Free |
| Cloudflare Workers Limits | https://developers.cloudflare.com/workers/platform/limits/ | 2026-11-11 | 100k requests/day, 10 ms CPU, 128 MB memory, CPU time excludes I/O |
| Cloudflare Workers Pricing | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-11-11 | Hyperdrive 100k queries/day on Free, no auto-upgrade |
| Cloudflare Hyperdrive Pricing | https://developers.cloudflare.com/hyperdrive/platform/pricing/ | 2026-11-11 | Hyperdrive included in Free plan, 100k queries/day |

---

## Appendix: Referenced Files

| File | Purpose |
|------|---------|
| `db/migrations/0001_initial.sql` | Core schema: extensions, app_users, role_assignments, vehicles, bookings, booking_approvals, vehicle_holds, assignments, handovers, booking_audit, notification_outbox, idempotency_records |
| `db/migrations/0002_reservation_slots.sql` | GiST exclusion constraint for booking conflict prevention |
| `db/migrations/0003_booking_workflow.sql` | MyGeotab-first additive schema: identity_mappings, mygeotab_cache, vehicle sync columns |
| `apps/api/src/db.ts` | Connection factory (`postgres`, `max: 5`, `idle_timeout: 20`, `connect_timeout: 10`, `prepare: false`) |
| `apps/api/src/env.ts` | Environment type with JSDoc documentation |
| `apps/api/src/index.ts` | Hono application with CORS, auth, and booking endpoints |
| `apps/api/src/auth.ts` | MyGeotab session verification, fail-closed principal resolution, role-based access |
| `apps/api/src/services/booking.ts` | Transactional booking operations (approve, reject, assign, cancel) |
| `apps/api/src/integrations/mygeotab/adapter.ts` | MyGeotab adapter scaffold (session verification implemented, mutating methods unimplemented) |
| `apps/api/wrangler.toml` | Worker config (`workers_dev = true`, APP_ENV, ALLOWED_ORIGIN, GEOTAB_DATABASE, commented Hyperdrive) |
| `scripts/migrate.mjs` | Migration runner (DATABASE_URL required, schema_migrations tracking) |
| `docs/DEPLOYMENT.md` | Personal testing deployment guide |
