# OPEX Vehicle Booking Management — MyGeotab Add-In starter

**Status:** implementation scaffold, not a production-ready deployment.  
**Target hosting:** Cloudflare Pages (frontend) + Cloudflare Worker (API).  
**Database:** PostgreSQL, recommended through Cloudflare Hyperdrive or another approved private connection.  
**Proposed Add-In domain:** `https://vbm.opexcg.com`  
**Tenant in this deployment request:** `opex_trial`.

> Tenant note: the current implementation target is `opex_trial`. Verify the database name and admin context before saving Add-In settings. Do not register this in production until the pilot and security checks pass.

## What is included

- React/Vite Add-In shell with the MyGeotab Add-In lifecycle (`initialize`, `focus`, `blur`) and a basic responsive booking dashboard.
- Example Add-In configuration JSON in `geotab/opex-vbm-config.json`.
- Cloudflare Worker API scaffold using Hono.
- PostgreSQL migration for application users, role assignments, vehicle mapping, bookings, approval steps, holds, assignments, handovers, audit and outbox.
- Server-side interval-overlap logic and transactional approved-booking assignment service with vehicle-row locking, active-hold checks, idempotency and a GiST exclusion constraint.
- Health endpoint and API contracts for vehicles, bookings, approvals and assignment.
- MyGeotab adapter interface with explicit tenant-validation TODOs for Device, User, Trip and LogRecord access.
- Cloudflare deployment notes, environment templates, security gates and test plan.

## Important capability / security boundaries

1. MyGeotab is the source for Geotab Device/User and available telematics records. This app's PostgreSQL database is authoritative for bookings, approvals, assignment and audit.
2. The MyGeotab identity-to-API authentication bridge is intentionally **fail-closed** in this scaffold. A backend must not trust a browser-supplied `userId`, role, email or clearance. Implement and validate a supported identity proof for the tenant (or approved OIDC account linking) before enabling write endpoints.
3. The MyGeotab adapter contains interfaces and TODOs, not a claim that the target tenant exposes every entity/field. Test with a least-privilege identity in the actual tenant.
4. GPS and Trip are optional read-only enrichment. They do not prove driver identity and do not control booking availability.
5. The example Add-In JSON is a starting configuration. Confirm the current Add-In schema and menu path against the tenant's Add-In editor / current Geotab developer documentation before saving.
6. No credentials, API passwords, tokens, database URLs or production secrets are included.

## Repository structure

```text
apps/
  web/                 React Add-In frontend
  api/                 Cloudflare Worker API
db/
  migrations/          PostgreSQL schema migrations
geotab/
  opex-vbm-config.json Add-In configuration starting point
scripts/
  migrate.mjs          Local migration runner (DATABASE_URL required)
docs/
  DEPLOYMENT.md        Cloudflare + PostgreSQL + MyGeotab deployment
  TENANT-VALIDATION.md Tenant proof-of-concept checklist
```

## Local setup

Requirements: Node.js 22.6+ (for the included native TypeScript test runner), npm, PostgreSQL 15+.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a PostgreSQL database and set `DATABASE_URL` in your shell (never commit it).
3. Apply migration:
   ```bash
   npm run db:migrate
   ```
4. Run frontend:
   ```bash
   npm run dev:web
   ```
5. Run API in another terminal:
   ```bash
   npm run dev:api
   ```

The frontend uses `VITE_API_BASE_URL` when an API endpoint is configured. If it is unset, the Add-In shell still loads without attempting a localhost request. Set `VITE_GEOTAB_DATABASE=opex_trial` for the target label. The API health route is `/api/health`.

### Local auth

There is no permissive mock-auth mode by default. Until a real, verified authentication adapter is implemented, protected API routes return `503 AUTH_ADAPTER_NOT_CONFIGURED`. This is intentional. Do not solve this by accepting `X-User-Id` or a role from the browser.

## Cloudflare deployment overview

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Suggested split:
- Cloudflare Pages: static React frontend, custom domain `vbm.opexcg.com`.
- Cloudflare Worker: API on a separate route/hostname such as `api-vbm.opexcg.com` (or a path route), connected to PostgreSQL through Hyperdrive.
- PostgreSQL: managed provider approved by OPEX/IT. Cloudflare Hyperdrive is a connection pooling/connection path, not the database itself.

Before production: implement verified identity, validate MyGeotab API access, set RBAC scopes, configure CORS/CSP, backups, monitoring, data retention and incident ownership.

## Initial fleet seed

Do not invent plate numbers, Device IDs, exact trims or seating capacities. Import the real vehicle register after GA validates it:
- 5 operational Toyota Fortuner/Hilux vehicles for plantation operations.
- 3 passenger Toyota Zenix/Innova variants.

The `vehicle_class` field supports `OPERATIONAL_4X4` and `PASSENGER`. The actual mapping to MyGeotab `Device.id` is required before telematics enrichment.

## Current implementation gaps before production

- [ ] Implement and security-review verified MyGeotab user identity / approved OIDC linking.
- [ ] Verify Add-In JSON schema, menu path, and view clearance behavior in the target tenant.
- [ ] Validate Device, User, Trip, LogRecord and status data access in `opex_trial`.
- [ ] Add full approval policy resolver and delegated approval policy.
- [ ] Add notification provider (email / approved channel), retry worker and templates.
- [ ] Add vehicle register import and role/manager mapping.
- [ ] Add frontend booking wizard, GA dispatch and management reporting.
- [ ] Configure PostgreSQL backups, RPO/RTO, secrets, logs, alerting and retention.
- [ ] Complete UAT and penetration/security testing.
