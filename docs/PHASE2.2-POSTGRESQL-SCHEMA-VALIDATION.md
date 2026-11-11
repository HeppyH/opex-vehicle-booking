# Phase 2.2 — PostgreSQL Schema Validation & Backend Readiness
OPEX Vehicle Booking Management (VBM)

**Status:** analysis and preparation only. No migration executed, no database provisioned, no Cloudflare infrastructure created, nothing committed or pushed.
**Reference documents:** `docs/MYGEOTAB-POSTGRESQL-DATA-ARCHITECTURE.md`, `docs/PHASE2-CLOUDFLARE-IMPLEMENTATION-PLAN.md`
**Existing migrations preserved unchanged:** `db/migrations/0001_initial.sql`, `db/migrations/0002_reservation_slots.sql`

---

## 1. Schema validation results

### 1.1 UUID primary keys — PASS
Every table created in 0001/0002 uses `uuid PRIMARY KEY DEFAULT gen_random_uuid()`:
`app_users`, `role_assignments`, `vehicles`, `bookings`, `booking_approvals`,
`vehicle_holds`, `assignments`, `handovers`, `booking_audit`,
`notification_outbox`, `idempotency_records`, `reservation_slots`.

### 1.2 Stable MyGeotab external IDs — PARTIAL (schema ready, data not wired)
- `vehicles.geotab_device_id text UNIQUE` — present (0001).
- `app_users.geotab_user_id text UNIQUE` — present (0001).
- Both are `text` external references, **not** PostgreSQL primary keys — conforms to the MyGeotab-first requirement.
- **Gap:** no `identity_mappings` table exists yet to formally link a verified MyGeotab user to an `app_users` row with tenant scoping. Migration 0003 adds this.
- **Gap:** no tenant-context validation column exists on any table. `GEOTAB_DATABASE=opex_trial` is currently a Worker var label only, not enforced in SQL. Migration 0003 adds `database_name` on `identity_mappings`.

### 1.3 Foreign key relationships — PASS
All FKs reference `app_users(id)` or `bookings(id)` / `vehicles(id)` with `ON DELETE CASCADE` where appropriate:
- `role_assignments.user_id -> app_users(id)`
- `bookings.requester_id -> app_users(id)`
- `booking_approvals.booking_id -> bookings(id)`, `approver_id -> app_users(id)`, `delegated_from -> app_users(id)`
- `vehicle_holds.vehicle_id -> vehicles(id)`, `created_by -> app_users(id)`
- `assignments.booking_id -> bookings(id)`, `vehicle_id -> vehicles(id)`, `assigned_by -> app_users(id)`
- `handovers.booking_id -> bookings(id)`
- `booking_audit.actor_user_id -> app_users(id)`
- `notification_outbox.recipient_user_id -> app_users(id)`
- `reservation_slots.booking_id -> bookings(id) ON DELETE CASCADE`, `vehicle_id -> vehicles(id)`

Self-reference: `app_users.manager_user_id -> app_users(id)`.

### 1.4 Booking lifecycle — PASS (schema), INCOMPLETE (endpoints)
`bookings.status` CHECK constraint covers the full lifecycle:
`DRAFT, SUBMITTED, PENDING_APPROVAL, APPROVED, ASSIGNED, CHECKED_OUT, OVERDUE,
RETURNED, CLOSED, REJECTED, CANCELLED, EXPIRED`.
`CHECK (end_at > start_at)` enforces valid intervals.
Buffer columns `buffer_before_minutes` / `buffer_after_minutes` with `>= 0` checks.

**Endpoint gaps:**
- `POST /api/bookings` — implemented (creates SUBMITTED).
- `POST /api/bookings/:id/approve` — **501 stub** (`APPROVAL_ENGINE_NOT_IMPLEMENTED`).
- `POST /api/bookings/:id/assign` — **501 stub** (`ASSIGNMENT_TRANSACTION_NOT_IMPLEMENTED`; logic exists in `services/booking.ts` but is not wired to a route).
- No rejection, cancellation, or status-transition endpoints exist.

### 1.5 Approval records — PASS (schema), INCOMPLETE (endpoints)
`booking_approvals` supports `step_no`, `approver_id`, `decision` (`PENDING/APPROVED/REJECTED/CANCELLED`), `comments`, `delegated_from`, `decided_at`, `UNIQUE(booking_id, step_no)`. No endpoint writes to it yet.

### 1.6 Vehicle assignments — PASS (schema), INCOMPLETE (endpoints)
`assignments` supports `booking_id`, `vehicle_id`, `active`, `assigned_by`, `assigned_at`,
`UNIQUE(booking_id) WHERE active = true` (one active assignment per booking).
The transactional `assignApprovedBooking` service exists but is not exposed via an endpoint.

### 1.7 Reservation slots — PASS (schema), UNVERIFIED at DB level
`reservation_slots` (0002) has `booking_id UNIQUE`, `vehicle_id`, `reserved_from`,
`reserved_until`, `active`, `CHECK (reserved_until > reserved_from)`, and a
GiST exclusion constraint. See Section 2 for concurrency analysis.

### 1.8 Audit logs — PASS (schema)
`booking_audit` supports `actor_user_id`, `entity_type`, `entity_id`, `action`,
`before_json`, `after_json`, `correlation_id`, `occurred_at`, plus an entity index.

### 1.9 MyGeotab cache with TTL — MISSING from 0001/0002
No cache table exists. Migration 0003 adds `mygeotab_cache` with
`entity_type`, `entity_id`, `payload`, `fetched_at`, `expires_at`, and a
`UNIQUE(entity_type, entity_id)` plus expiry index.

---

## 2. Booking concurrency analysis

### 2.1 GiST exclusion constraint (0002)
```sql
EXCLUDE USING gist (
  vehicle_id WITH =,
  tstzrange(reserved_from, reserved_until, '[)') WITH &&
) WHERE (active = true)
```

**What it prevents:** Two *active* reservation slots for the same `vehicle_id`
whose `tstzrange` intervals overlap (`&&` operator).

### 2.2 Time-zone handling
`tstzrange` is `timestamptz`-aware. All `reserved_from`/`reserved_until` columns are `timestamptz`, so time zones are handled correctly **provided callers pass timestamptz values**. The service casts inputs via `::timestamptz`. No `timestamptz` → `timestamp` silent conversion risk.

**Assumption (not verified against live PostgreSQL):** `tstzrange` normalizes inputs to a consistent internal representation. This is standard PostgreSQL behavior but was not executed here.

### 2.3 Reservation boundaries
Range `[)` = lower bound inclusive, upper bound exclusive. Two slots where one ends exactly when the next begins (`end == start`) do **not** overlap. This matches the `overlaps()` unit test (half-open intervals). Touching endpoints are permitted, which is the desired turnaround behavior.

### 2.4 Cancelled / rejected bookings
The constraint applies `WHERE (active = true)`. A cancelled/rejected booking's slot remains blocking unless `active` is set to `false` (or the row is deleted via `ON DELETE CASCADE` when the booking is deleted).

**Risk:** If the application cancels a booking but leaves its `reservation_slots.active = true`, the slot continues to block the vehicle. The assignment service and any cancel/reject path must deactivate or remove the slot. This is an **application-level responsibility**, not enforced by the constraint.

### 2.5 Concurrent requests
Two layers of defence:
1. `SELECT ... FOR UPDATE` on the `vehicles` row serializes concurrent assignments for the same vehicle.
2. The GiST exclusion constraint is checked at `INSERT ... INTO reservation_slots` commit time; a concurrent overlapping insert raises an exclusion violation and one transaction aborts.

**Not verified:** Actual behavior under concurrent transactions against a live PostgreSQL (isolation level, deadlock probability, error codes). This requires a real database integration test.

### 2.6 Transaction isolation
Default `READ COMMITTED` is sufficient for the GiST exclusion check (evaluated at insert). `SERIALIZABLE` would be stronger but is not strictly required and adds abort/retry overhead. The service uses `sql.begin()` (single transaction) for the full assign flow.

### 2.7 Database index performance
- `reservation_slots_vehicle_idx` on `(vehicle_id, active)` supports lookups by vehicle.
- The GiST exclusion constraint is backed by a GiST index automatically.
- `bookings_requester_start_idx` and `bookings_status_start_idx` support booking queries.
- No index on `reservation_slots(reserved_from, reserved_until)` directly; the GiST index covers range queries.

### 2.8 Concurrency guarantee statement
> **Cannot be claimed without live PostgreSQL verification.** The schema provides the mechanisms (GiST exclusion + row lock + idempotency), but real concurrent double-booking prevention must be validated with actual PostgreSQL transactions under load. Unit tests (below) validate the pure interval logic only.

---

## 3. Approval workflow validation

| Step | Schema support | Endpoint status | Notes |
|---|---|---|---|
| Employee submits booking | `bookings` (DRAFT/SUBMITTED), `booking_audit` | `POST /api/bookings` ✅ implemented | Creates SUBMITTED + audit row |
| Manager approves | `booking_approvals` (decision APPROVED) | `POST /api/bookings/:id/approve` ❌ 501 stub | Approval engine not implemented |
| Manager rejects | `booking_approvals` (decision REJECTED) | ❌ no endpoint | Rejection not implemented |
| Fleet Admin assigns | `assignments`, `reservation_slots`, `booking_audit` | `POST /api/bookings/:id/assign` ❌ 501 stub | `assignApprovedBooking` service exists, not wired |
| Booking cancellation | `bookings.status` = CANCELLED | ❌ no endpoint | Cancellation not implemented; slot deactivation not handled |
| Audit history | `booking_audit` | partial (submit + assign audit only) | Approve/reject/cancel audit not implemented |

### Unauthorized access protection
- `requirePrincipal` middleware resolves a verified principal; `resolveVerifiedPrincipal` currently returns `null` unless `IDENTITY_ADAPTER_CONFIGURED === "true"`. **All protected routes return `503 AUTH_ADAPTER_NOT_CONFIGURED` until identity is implemented** — fail-closed.
- `requireRole("APPROVER","MANAGEMENT","ADMIN")` on approve; `requireRole("GA","ADMIN")` on assign. Role checks are correct **but unreachable** because the principal resolver never returns a principal in the current scaffold.
- No endpoint filters bookings by requester for cross-user read protection beyond `GET /api/bookings` filtering by `requester_id`. This is correct for the list endpoint but other routes (approve/assign) do not verify the actor owns/approves the specific booking — moot until endpoints are implemented and identity is live.

**Conclusion:** The authorization *design* is sound (role-based, fail-closed), but it cannot enforce anything until `resolveVerifiedPrincipal` is implemented and endpoints are wired.

---

## 4. MyGeotab references validation

| Requirement | Status | Evidence |
|---|---|---|
| `geotab_device_id` uses text | ✅ | `vehicles.geotab_device_id text UNIQUE` (0001) |
| `geotab_user_id` uses text | ✅ | `app_users.geotab_user_id text UNIQUE` (0001) |
| IDs are external references, not PKs | ✅ | PKs are `uuid`; MyGeotab IDs are `text` with UNIQUE only |
| Tenant/database context validated | ⚠️ partial | `GEOTAB_DATABASE=opex_trial` is a Worker var label; no SQL-level tenant enforcement. 0003 adds `database_name` on `identity_mappings`. |
| No full fleet duplication | ✅ | Only `geotab_device_id` + application attributes stored; no mirror of full Device records |
| Cache has TTL and refresh | ⚠️ not in 0001/0002 | 0003 adds `mygeotab_cache` with `expires_at`; refresh strategy to be implemented in adapter |

No `vehicles` row contains plate numbers, trims, or seating capacities invented by the app — consistent with the "no dummy data" rule. Fleet data must be imported from real MyGeotab records post-tenant-validation.

---

## 5. Migration 0003 — `db/migrations/0003_booking_workflow.sql`

Prepared as an **additive** migration. Preserves 0001 and 0002 unchanged. Contents:

1. **Additive columns on `vehicles`:** `geotab_last_synced_at timestamptz`, `geotab_sync_version text` — tracks when a vehicle record was last refreshed from MyGeotab.
2. **`mygeotab_cache` table:** `id` (uuid PK), `entity_type` (CHECK device/user/trip/location), `entity_id` (text), `payload` (jsonb), `fetched_at`, `expires_at`, `UNIQUE(entity_type, entity_id)`, plus expiry and entity indexes. Supports the cache-with-TTL strategy.
3. **`identity_mappings` table:** links `app_user_id -> geotab_user_id`, scoped by `database_name` (default `opex_trial`), with `is_active`, `linked_by`, `linked_at`, `last_validated_at`, and `UNIQUE(geotab_user_id, database_name)`. Enables tenant-scoped identity validation.

**What 0003 intentionally does NOT add:**
- `booking_slots` — redundant; `reservation_slots` (0002) already fulfills this role with a GiST exclusion constraint.
- `app_roles` lookup table — `role_assignments` (0001) already enforces roles via CHECK constraint; a separate roles table is unnecessary.
- Dummy/seed vehicle or user data — none inserted.

**Rollback:** `ALTER TABLE vehicles DROP COLUMN ...` for the two new columns; `DROP TABLE identity_mappings; DROP TABLE mygeotab_cache;`. No 0001/0002 data is touched. Dropping `mygeotab_cache` discards only regenerable cache data; dropping `identity_mappings` severs identity links and requires identity-adapter coordination.

The migration is safe to execute against a newly provisioned PostgreSQL that has 0001 and 0002 applied. It has **not** been executed against any database.

---

## 6. Test results

### 6.1 Executed unit tests (no PostgreSQL required)

`apps/api/test/overlap.test.mjs` (existing): 3/3 pass.
`apps/api/test/overlap-scenarios.test.mjs` (new): 9/9 pass.

Coverage: overlapping/adjacent/contained/identical intervals, before-buffer and after-buffer conflicts, invalid intervals (end <= start, zero-length), negative buffer rejection.

```
# pass 9
# fail 0
```

### 6.2 TypeScript typecheck
`apps/api` typecheck: clean (no errors).

### 6.3 Tests NOT executed (require live PostgreSQL)
The following cannot be run without a provisioned PostgreSQL database. They are clearly distinguished from unit tests:
- Real GiST exclusion constraint behavior under concurrent transactions.
- `assignApprovedBooking` transactional behavior (row lock, idempotency, audit, slot insert).
- `booking_approvals` write paths (approve/reject).
- Cancellation + slot deactivation.
- Cross-user authorization enforcement.
- `mygeotab_cache` TTL expiry and refresh.

These must be run as PostgreSQL integration tests after a database is provisioned and migrations applied.

---

## 7. Database provisioning requirements

1. Provision a managed PostgreSQL (approved by OPEX/IT; not D1, not Hyperdrive itself).
2. Create dedicated database + least-privilege application role; enable TLS, backups, PITR.
3. Set `DATABASE_URL` in shell (never commit).
4. Apply migrations in order: `npm run db:migrate` (runs 0001, 0002, 0003).
5. Configure Cloudflare Hyperdrive binding `DB` pointing at the PostgreSQL.
6. Never put `DATABASE_URL` or credentials in `wrangler.toml` or source control.

---

## 8. Outstanding blockers

1. **No live PostgreSQL** available in this environment — DB-level concurrency, GiST behavior, and integration tests cannot be executed or verified here.
2. **Identity adapter not implemented** — `resolveVerifiedPrincipal` fails closed; all protected endpoints return 503. Approval/assign/cancellation endpoints remain 501 stubs.
3. **MyGeotab adapter not implemented** — `listDevices`/`listUsers`/`listTrips`/`latestLocations` throw; no session handling or tenant validation against `opex_trial`.
4. **Cloudflare access not verified** — dashboard permissions, DNS zone `opexcg.com`, existing Workers/Pages/Hyperdrive not inspected.
5. **Phase 1.4 files referenced in earlier planning do not exist** in the repository (`docs/PHASE1.4-FRONTEND-VALIDATION.md`, `docs/screenshots-phase1.4/`); working tree is clean. Noted for reconciliation but outside this phase's scope.

---

## 9. Recommended next action

1. Review and approve `db/migrations/0003_booking_workflow.sql` (additive; safe; not executed).
2. Implement `resolveVerifiedPrincipal` (verified identity + tenant `opex_trial` check) before enabling any write endpoint.
3. Wire `approve`/`reject`/`assign`/cancel endpoints to the existing service logic.
4. Implement the MyGeotab adapter with session handling against `opex_trial`.
5. Provision PostgreSQL + Hyperdrive, apply migrations, then run real PostgreSQL integration tests for concurrency and conflict prevention.

No Cloudflare infrastructure created, no database provisioned, nothing committed or pushed in this phase.
