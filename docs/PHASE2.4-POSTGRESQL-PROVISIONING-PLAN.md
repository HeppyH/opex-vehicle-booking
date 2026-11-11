# Phase 2.4 — PostgreSQL Provisioning Plan (Neon + Cloudflare Hyperdrive)
OPEX Vehicle Booking Management (VBM)

**Status:** preparation and design only. No cloud resources created. No migrations executed.
**Target tenant:** `opex_trial`
**Cloudflare account:** `3382abe83400d3bbb6e645796250458d` (dashboard access to be verified)

---

## 1. Provider Evaluation — Neon PostgreSQL

### 1.1 Official Free Plan Verification

Source: Neon official documentation (`neon.com/docs/introduction/plans`, `neon.com/faqs/free-plan-limits-and-quotas`, last updated 2026-11-03).

| Resource | Free Plan Allowance |
|---|---|
| Cost | $0/month (free forever, not a time-limited trial) |
| Projects | 100 |
| Branches | 10 per project |
| Compute | 100 CU-hours per project per month |
| Autoscaling | Up to 2 CU (≈8 GB RAM) |
| Scale to zero | After 5 minutes of inactivity (cannot be disabled) |
| Postgres storage | 1 GB per project (up to 20 GB across all projects) |
| Public network transfer | 5 GB per project per month |
| Instant restore history | 6 hours, capped at 1 GB of change history |
| Manual snapshots | 1 |
| Monitoring history | 1 day |
| Support | Community |

### 1.2 What Resets Monthly vs. Continuously

- **Reset monthly:** Compute (CU-hours) and public network transfer, at the start of each monthly billing period.
- **Continuous limits (do not reset):** Storage usage, branch count, project count.

### 1.3 What Happens When Limits Are Hit

- Compute quota exhausted: compute is suspended; data remains in storage and counts against the 1 GB cap.
- Storage cap reached: writes fail until storage is reduced or plan is upgraded.
- Network transfer cap reached: further network operations fail until the monthly reset.

### 1.4 Paid Plan Context (for reference, not approved)

- **Launch:** $0.106/CU-hour, $0.35/GB-month storage, autoscaling up to 16 CU, 7-day restore window, 500 GB egress/project/month, 100 manual snapshots.
- **Scale:** $0.222/CU-hour, $0.35/GB-month storage, autoscaling up to 56 CU, SLAs, HIPAA, private networking.

**Free tier is initially approved for development and controlled pilot testing only. It is NOT automatically approved as the permanent production plan. Do not enable paid billing or upgrade any subscription without explicit approval.**

---

## 2. Singapore Region Validation

Source: Neon official documentation (`neon.com/docs/introduction/regions`).

| Region | Provider | Region ID | Postgres Support | Notes |
|---|---|---|---|---|
| AWS Asia Pacific (Singapore) | AWS | `aws-ap-southeast-1` | ✅ Yes | Selected region for this project |

- **Singapore region is available and supports PostgreSQL.**
- A project's region is fixed at creation time and cannot be changed afterward.
- New projects can only be created in AWS regions (Azure regions are deprecated for new projects).
- All branches within a project share the project's region.
- IP addresses for `aws-ap-southeast-1`: 13.251.199.154, 18.141.120.105, 18.142.42.169, 3.1.149.186, 3.1.239.32, 47.131.90.115, 52.221.53.167, 52.74.190.151, 52.76.51.78, 54.254.50.26, 54.254.92.70, 54.255.161.23

### 2.1 Latency Consideration

The target MyGeotab tenant `opex_trial` and the end users are in North Sumatra, Indonesia. Singapore (`ap-southeast-1`) is the closest available Neon region to Indonesia. Latency from North Sumatra to Singapore is expected to be low (cross-border, within Southeast Asia). No Tokyo region is available on Neon.

---

## 3. Cloudflare Account Inspection

**Limitation:** The Cloudflare Dashboard (`https://dash.cloudflare.com/3382abe83400d3bbb6e645796250458d/home`) requires an authenticated browser session. This session does not have authenticated access to the Cloudflare dashboard. The following items could NOT be verified:

- Account permissions and plan type
- Existing Workers and Pages projects
- Existing Hyperdrive configurations
- Existing secrets and environment configuration

These must be verified manually by the account owner before proceeding with resource creation.

### 3.1 What Is Known from Documentation

- Cloudflare Hyperdrive is included in both Workers Free and Paid plans.
- **Free plan:** 100,000 database queries per day, 20 origin connections per configuration, 10 configured databases per account, limits reset daily at 00:00 UTC.
- **Paid plan:** Unlimited Hyperdrive queries, 100 origin connections per configuration.
- Hyperdrive works with Neon (PostgreSQL 15.x).
- Hyperdrive requires `nodejs_compat` compatibility flag (already present in `wrangler.toml`).
- Hyperdrive manages connection pooling; the origin database must use a **direct** connection string (connection pooling disabled in Neon).
- Hyperdrive TLS mode: `require` (default) — Hyperdrive terminates SSL at Cloudflare edge, then connects to Neon with SSL encryption upstream.

---

## 4. Repository Review — PostgreSQL Schema Readiness

### 4.1 Migration Compatibility Assessment

| Migration | PostgreSQL Compatible | Required Extensions | Notes |
|---|---|---|---|
| `0001_initial.sql` | ✅ Yes | `pgcrypto`, `btree_gist` | `gen_random_uuid()` requires `pgcrypto` |
| `0002_reservation_slots.sql` | ✅ Yes | `btree_gist` | GiST exclusion constraint on `tstzrange` |
| `0003_booking_workflow.sql` | ✅ Yes | `pgcrypto` (from 0001) | Additive only; no changes to 0001/0002 |

### 4.2 Feature Support Verification

| Feature | Neon Support | Migration Usage | Status |
|---|---|---|---|
| `pgcrypto` extension | ✅ | `gen_random_uuid()` | Supported |
| `btree_gist` extension | ✅ | GiST exclusion constraint | Supported |
| GiST exclusion constraint | ✅ | `reservation_slots` overlap prevention | Supported |
| UUID primary keys | ✅ | All tables use `uuid` | Supported |
| `timestamptz` | ✅ | All timestamp columns | Supported |
| JSONB | ✅ | `booking_audit.before_json/after_json`, `mygeotab_cache.payload` | Supported |
| Native `postgres` driver | ✅ | `db.ts` uses `postgres` with `prepare: false` | Compatible with Hyperdrive |

### 4.3 Migration Ordering

Migrations must be applied in filename sort order:
1. `0001_initial.sql` — creates extensions and core tables
2. `0002_reservation_slots.sql` — creates GiST exclusion constraint table
3. `0003_booking_workflow.sql` — additive: `mygeotab_cache`, `identity_mappings`, vehicle sync columns

Migration 0003 depends on `pgcrypto` (from 0001) for `gen_random_uuid()` and on `app_users` (from 0001) for foreign keys.

### 4.4 Connection Requirements

- `apps/api/src/db.ts`: Uses `postgres` driver with `prepare: false` — required for Hyperdrive compatibility.
- `apps/api/src/env.ts`: Supports `DB.connectionString` (Hyperdrive binding) or `DATABASE_URL` (local development).
- `apps/api/wrangler.toml`: Has `nodejs_compat` flag; Hyperdrive binding is commented out (no credentials in file).

### 4.5 Worker Runtime Compatibility

- `compatibility_flags = ["nodejs_compat"]` — required for Hyperdrive and the `postgres` driver.
- The `postgres` driver is listed as a dependency in `apps/api/package.json` (`^3.4.5`).
- Cloudflare Hyperdrive documentation recommends `pg` (node-postgres) `>8.16.3` OR `postgres.js`. The existing `postgres` driver with `prepare: false` is compatible.

---

## 5. Development and Production Architecture

### 5.1 Environment Isolation Design

| Component | Development | Production |
|---|---|---|
| Neon project | `opex-vbm-dev` | `opex-vbm-prod` |
| Neon database | `opex_vbm_dev` | `opex_vbm_prod` |
| Neon region | `aws-ap-southeast-1` | `aws-ap-southeast-1` |
| Neon plan | Free | Free (initially) |
| Hyperdrive config | `opex-vbm-dev-hyperdrive` | `opex-vbm-prod-hyperdrive` |
| Hyperdrive binding | `DB` (dev wrangler) | `DB` (prod wrangler) |
| Worker environment | Development variables | Production variables |
| Credentials | Dev least-privilege role | Prod least-privilege role |
| Data | Synthetic test records only | Real booking data only |
| `IDENTITY_ADAPTER_CONFIGURED` | `true` (after identity impl) | `false` until approved |

### 5.2 Database Role Design

**Recommended least-privilege roles per environment:**

| Role | Purpose | Privileges | Used By |
|---|---|---|---|
| `db_admin` | Schema migrations | CREATE, ALTER, DROP on all tables | Migration scripts only |
| `db_runtime` | Application queries | SELECT, INSERT, UPDATE, DELETE on tables | Cloudflare Worker via Hyperdrive |

- The database owner account must NOT be used for normal Worker operations.
- Each environment has its own set of roles and credentials.
- Roles are created in Neon Console under Roles > New Role.

### 5.3 Why Separate Neon Projects

- Isolates compute quotas (100 CU-hours per project per month).
- Isolates credentials and data.
- Prevents accidental production data access from development.
- Allows independent migration schedules.
- Synthetic test data in dev never mixes with production booking records.

---

## 6. Cloudflare Hyperdrive Architecture

### 6.1 Hyperdrive Configurations

| Configuration Name | Binding | Target Database | Neon Project |
|---|---|---|---|
| `opex-vbm-dev-hyperdrive` | `DB` | `opex_vbm_dev` | `opex-vbm-dev` |
| `opex-vbm-prod-hyperdrive` | `DB` | `opex_vbm_prod` | `opex-vbm-prod` |

### 6.2 Hyperdrive Connection Requirements

- Hyperdrive requires a **direct** PostgreSQL connection string (connection pooling disabled in Neon).
- Format: `postgres://USERNAME:PASSWORD@HOSTNAME:PORT/database_name`
- Hyperdrive creates its own pooled connection string for the Worker (`env.DB.connectionString`).
- Hyperdrive verifies the connection string works before creating the configuration.
- TLS mode: `require` (Hyperdrive manages SSL to origin).

### 6.3 Wrangler Configuration Changes Needed

`apps/api/wrangler.toml` currently has the Hyperdrive binding commented out:

```toml
[[hyperdrive]]
binding = "DB"
id = "REPLACE_WITH_HYPERDRIVE_CONFIG_ID"
```

For each environment, uncomment and replace `REPLACE_WITH_HYPERDRIVE_CONFIG_ID` with the actual Hyperdrive configuration ID returned by `wrangler hyperdrive create`.

No connection strings or credentials go in `wrangler.toml`.

### 6.4 Compatibility

- `nodejs_compat` flag: ✅ Already present in `wrangler.toml`.
- `postgres` driver with `prepare: false`: ✅ Compatible with Hyperdrive.
- Hyperdrive Free plan: 100,000 queries/day, 20 origin connections/config — sufficient for pilot.

---

## 7. Required Resources

### 7.1 Neon Resources (Free Tier)

| Resource | Development | Production |
|---|---|---|
| Project | `opex-vbm-dev` | `opex-vbm-prod` |
| Database | `opex_vbm_dev` | `opex_vbm_prod` |
| Region | `aws-ap-southeast-1` | `aws-ap-southeast-1` |
| Role (admin) | `db_admin_dev` | `db_admin_prod` |
| Role (runtime) | `db_runtime_dev` | `db_runtime_prod` |
| Branch | `main` (default) | `main` (default) |

### 7.2 Cloudflare Resources

| Resource | Development | Production |
|---|---|---|
| Hyperdrive config | `opex-vbm-dev-hyperdrive` | `opex-vbm-prod-hyperdrive` |
| Worker | `opex-vbm-api` | `opex-vbm-api` |
| Pages project | (existing or new) | (existing or new) |
| Worker URL pattern | `https://opex-vbm-api.<account-subdomain>.workers.dev` | `https://opex-vbm-api.<account-subdomain>.workers.dev` |
| Frontend URL | `https://heppyh.github.io/opex-vehicle-booking/` | `https://heppyh.github.io/opex-vehicle-booking/` |

### 7.3 Secrets / Environment Variables (Never Commit)

| Variable | Development | Production |
|---|---|---|
| `DATABASE_URL` (local dev only) | Dev direct connection string | Not used in prod |
| `DB` (Hyperdrive binding) | Dev Hyperdrive config ID | Prod Hyperdrive config ID |
| `APP_ENV` | `development` | `production` |
| `ALLOWED_ORIGIN` | `https://heppyh.github.io` | `https://heppyh.github.io` |
| `GEOTAB_DATABASE` | `opex_trial` | `opex_trial` |
| `IDENTITY_ADAPTER_CONFIGURED` | `false` (until verified) | `false` (until verified) |

---

## 8. Estimated Cost and Free-Tier Risks

### 8.1 Estimated Monthly Cost (Free Tier)

| Component | Development | Production | Total |
|---|---|---|---|
| Neon PostgreSQL | $0 | $0 | $0 |
| Cloudflare Hyperdrive | $0 | $0 | $0 |
| Cloudflare Workers | $0 | $0 | $0 |
| Cloudflare Pages | $0 | $0 | $0 |
| **Total** | **$0** | **$0** | **$0** |

### 8.2 Free-Tier Risks and Limitations

| Risk | Impact | Mitigation |
|---|---|---|
| 1 GB storage per project | Production data may exceed 1 GB over time | Monitor storage; upgrade to Launch before hitting cap |
| 100 CU-hours per project per month | Compute suspends after quota; scale-to-zero causes cold starts | Monitor CU usage; consider Launch plan for production |
| Scale-to-zero after 5 min inactivity | First request after idle has cold-start latency | Acceptable for pilot; evaluate Launch plan (disable scale-to-zero) |
| 6-hour instant restore only | Limited point-in-time recovery | Manual snapshot (1 allowed); document backup strategy |
| No scheduled backups on Free plan | No automated backup/restore | Document manual export process; consider paid plan for production |
| 100,000 Hyperdrive queries/day | May be exceeded in heavy production use | Monitor query count; upgrade Workers plan if needed |
| 20 origin connections per Hyperdrive config | Connection pool limit | Acceptable for pilot; monitor connection usage |

### 8.3 When to Upgrade

- Production storage approaching 1 GB
- Production CU-hours approaching 100/month
- Need for scheduled backups or 7-day restore window
- Need to disable scale-to-zero for consistent latency
- Hyperdrive queries exceeding 100,000/day

**Do not enable paid billing or upgrade any subscription without explicit approval.**

---

## 9. Migration Procedure

### 9.1 Development Environment (Safe to Execute)

1. Create Neon project `opex-vbm-dev` in region `aws-ap-southeast-1`.
2. Create database `opex_vbm_dev` on the `main` branch.
3. Create roles `db_admin_dev` and `db_runtime_dev` with least privileges.
4. Record the direct connection string (connection pooling OFF) for `db_runtime_dev`.
5. Create Hyperdrive config `opex-vbm-dev-hyperdrive` using the direct connection string.
6. Record the Hyperdrive configuration ID.
7. Locally, set `DATABASE_URL` to the dev direct connection string.
8. Run `npm run db:migrate` to apply migrations 0001, 0002, 0003.
9. Verify tables, constraints, and indexes exist.
10. Run real PostgreSQL integration tests (concurrent reservations, slot deactivation, etc.).

### 9.2 Production Environment (Requires Explicit Approval)

1. **Obtain explicit approval before proceeding.**
2. Create Neon project `opex-vbm-prod` in region `aws-ap-southeast-1`.
3. Create database `opex_vbm_prod` on the `main` branch.
4. Create roles `db_admin_prod` and `db_runtime_prod` with least privileges.
5. Record the direct connection string (connection pooling OFF) for `db_runtime_prod`.
6. Create Hyperdrive config `opex-vbm-prod-hyperdrive` using the direct connection string.
7. Record the Hyperdrive configuration ID.
8. Apply migrations 0001, 0002, 0003 to production using `db_admin_prod`.
9. Verify tables and constraints in production.
10. Configure Cloudflare Worker with production Hyperdrive binding and secrets.
11. Set `IDENTITY_ADAPTER_CONFIGURED=true` only after verified identity implementation and review.

**Never execute migrations against production without explicit approval.**

---

## 10. Backup Strategy

### 10.1 Free Plan Backup Limitations

| Feature | Free Plan | Production Impact |
|---|---|---|
| Automated backups | ❌ Not available | No automated recovery |
| Scheduled backups | ❌ Not available | Manual process required |
| Instant restore history | 6 hours, 1 GB max | Very limited recovery window |
| Manual snapshots | 1 per project | One point-in-time capture |
| Storage billing during suspension | Counts against 1 GB cap | Data persists but is read-only |

### 10.2 Recommended Backup Process

1. **Before any production migration:** Take one manual snapshot (Free plan limit).
2. **Regular exports:** Use `pg_dump` to export production data to a secure location on a defined schedule.
3. **Document restore procedure:** Test restore from manual snapshot and `pg_dump` exports.
4. **Monitor storage:** Track growth against the 1 GB per-project cap.

### 10.3 Recovery Limitations

- Maximum 6-hour instant restore window on Free plan.
- No automated failover or cross-region replication on Free plan.
- Compute-level HA is limited (newer feature, not as mature as multi-AZ deployments).
- Logical replication across regions is available but requires paid features.

---

## 11. Security Controls

### 11.1 Credential Management

- **Never commit** connection strings, passwords, tokens, or `.env` files.
- **Never print** credentials in logs, console output, or documentation.
- Store database credentials in Cloudflare secrets (`wrangler secret put`) or Neon Console only.
- Use separate credentials for dev and prod environments.
- Rotate credentials on a defined schedule (e.g., every 90 days).

### 11.2 Network Security

- Neon connections require TLS (`sslmode=require`).
- Hyperdrive terminates SSL at Cloudflare edge and connects to Neon with SSL.
- Hyperdrive origin connection limit: 20 for free tier.
- Do not expose the PostgreSQL port (5432) to the public internet; Neon manages access.

### 11.3 Access Control

- Least-privilege database roles (`db_runtime` for Worker, `db_admin` for migrations).
- Worker accesses database only through Hyperdrive binding (`env.DB.connectionString`).
- No direct `DATABASE_URL` in production Worker configuration.
- `IDENTITY_ADAPTER_CONFIGURED` remains `false` until verified identity is implemented and reviewed.

### 11.4 Audit Strategy

- PostgreSQL `booking_audit` table captures all booking mutations (already in migration 0001).
- Neon monitoring history: 1 day on Free plan (limited).
- Application-level audit logs should be reviewed regularly.
- Consider upgrading to paid plan for longer monitoring retention if audit compliance is required.

---

## 12. Migration and Validation Plan (Execution Sequence)

### Phase A — Development Provisioning (No Approval Required for Free Tier)

1. Create Neon project `opex-vbm-dev` (region: `aws-ap-southeast-1`).
2. Create database `opex_vbm_dev`, roles `db_admin_dev`, `db_runtime_dev`.
3. Create Hyperdrive config `opex-vbm-dev-hyperdrive`.
4. Apply migrations 0001, 0002, 0003 locally against dev database.
5. Run real PostgreSQL integration tests:
   - GiST exclusion constraint under concurrent transactions
   - Reservation slot activation/deactivation on cancel/reject
   - `SELECT FOR UPDATE` row locking behavior
   - Cross-user authorization enforcement
6. Verify all tests pass against real PostgreSQL.

### Phase B — Production Provisioning (Requires Explicit Approval)

1. Obtain explicit approval for production provisioning.
2. Create Neon project `opex-vbm-prod` (region: `aws-ap-southeast-1`).
3. Create database `opex_vbm_prod`, roles `db_admin_prod`, `db_runtime_prod`.
4. Create Hyperdrive config `opex-vbm-prod-hyperdrive`.
5. Apply migrations 0001, 0002, 0003 to production.
6. Configure Cloudflare Worker with production secrets and Hyperdrive binding.
7. Verify `/api/health` endpoint.
8. Deploy frontend to GitHub Pages with `VITE_API_BASE_URL`.

---

## 13. Outstanding Dependencies and Blockers

| Blocker | Description | Required Action |
|---|---|---|
| Cloudflare dashboard access | Cannot verify account permissions, existing resources | Manual verification by account owner |
| Neon account | Not yet created | Sign up at console.neon.tech |
| Identity adapter | `resolveVerifiedPrincipal` returns null until configured | Implement and review before enabling |
| `IDENTITY_ADAPTER_CONFIGURED` | Must remain `false` until identity is verified | Do not set to `true` without approval |
| PostgreSQL integration tests | Cannot run without live database | Execute after dev provisioning |
| Production approval | Required before any production resource creation | Obtain explicit approval |

---

## 14. Step-by-Step Provisioning Instructions (Manual)

### 14.1 Prerequisites

- Neon account at https://console.neon.tech
- Cloudflare account access at https://dash.cloudflare.com/3382abe83400d3bbb6e645796250458d/home
- Wrangler CLI installed (`npm install -g wrangler` or use local `node_modules/.bin/wrangler`)
- Node.js 22.6+ installed

### 14.2 Development Provisioning

```bash
# 1. Sign in to Neon
npx neon login

# 2. Create development project in Singapore
npx neon projects create --name opex-vbm-dev --region-id aws-ap-southeast-1

# 3. Create database and roles in Neon Console
# - Database: opex_vbm_dev
# - Role: db_admin_dev (migration/admin)
# - Role: db_runtime_dev (least-privilege runtime)

# 4. Get direct connection string (connection pooling OFF)
# From Neon Console > Connection Details > select db_runtime_dev role

# 5. Create Hyperdrive config
npx wrangler hyperdrive create opex-vbm-dev-hyperdrive \
  --connection-string="postgres://db_runtime_dev:PASSWORD@HOSTNAME:5432/opex_vbm_dev"

# 6. Record Hyperdrive config ID from output
# Update apps/api/wrangler.toml with the binding and ID

# 7. Apply migrations locally
export DATABASE_URL="postgres://db_admin_dev:PASSWORD@HOSTNAME:5432/opex_vbm_dev"
npm run db:migrate

# 8. Verify tables and constraints
# Run psql queries to confirm schema
```

### 14.3 Production Provisioning (Requires Approval)

Same steps as development, but with project `opex-vbm-prod`, database `opex_vbm_prod`, and Hyperdrive config `opex-vbm-prod-hyperdrive`.

**Do not proceed to production provisioning without explicit approval.**

---

## 15. Final Report

| Item | Result |
|---|---|
| Neon Free plan verification | ✅ Verified from official docs (last updated 2026-11-03): $0/month, 100 projects, 10 branches/project, 100 CU-hours/project/month, 1 GB storage/project, 5 GB egress/project/month, scale-to-zero after 5 min |
| Singapore region availability | ✅ `aws-ap-southeast-1` available, PostgreSQL supported, closest to Indonesia |
| Cloudflare account inspection | ⚠️ Not verifiable without authenticated dashboard session |
| PostgreSQL schema readiness | ✅ Migrations 0001–0003 are PostgreSQL-compatible; pgcrypto, btree_gist, GiST, UUID, timestamptz all supported by Neon |
| Development/production architecture | ✅ Designed with separate Neon projects, separate Hyperdrive configs, separate credentials |
| Hyperdrive compatibility | ✅ Neon + Hyperdrive officially supported; `nodejs_compat` present; `postgres` driver with `prepare: false` compatible |
| Estimated cost | $0/month for both environments on Free tier |
| Free-tier risks | 1 GB storage cap, 100 CU-hours/month, scale-to-zero cold starts, 6-hour restore, no scheduled backups |
| Provisioning blockers | Cloudflare dashboard access not verified; Neon account not created; identity adapter not implemented |
| Exact manual actions | Create Neon projects, databases, roles; create Hyperdrive configs; apply migrations; run integration tests; configure Cloudflare secrets |
| Recommended next step | Verify Cloudflare dashboard access, then provision development Neon database and run real PostgreSQL integration tests |

**Do not create any cloud resources until this plan is reviewed and approved.**
