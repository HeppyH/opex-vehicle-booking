# Migration 0003 — Review Report
OPEX Vehicle Booking Management (VBM)

**File:** `db/migrations/0003_booking_workflow.sql`
**Status:** Prepared only. NOT executed against any database.
**Migrations preserved unchanged:** `0001_initial.sql`, `0002_reservation_slots.sql`

---

## 1. SQL syntax validation

| Element | Status | Notes |
|---|---|---|
| `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS` | Valid | PostgreSQL 9.6+ supports `IF NOT EXISTS` on `ADD COLUMN` |
| `CREATE TABLE IF NOT EXISTS mygeotab_cache` | Valid | Standard |
| `CREATE TABLE IF NOT EXISTS identity_mappings` | Valid | Standard |
| `CREATE INDEX ... ON ...` | Valid | Standard |
| `CHECK (entity_type IN (...))` | Valid | Inline check constraint |
| `UNIQUE (entity_type, entity_id)` | Valid | Composite unique constraint |
| `UNIQUE (geotab_user_id, database_name)` | Valid | Composite unique constraint |
| `REFERENCES app_users(id) ON DELETE CASCADE` | Valid | FK with cascade |
| `DEFAULT gen_random_uuid()` | Valid | Requires `pgcrypto` extension (provided by 0001) |
| `DEFAULT now()` | Valid | Standard |
| `timestamptz` type | Valid | Timezone-aware timestamps |

**Syntax:** Valid. No syntax errors detected.

---

## 2. UUID primary keys — PASS

All new tables use `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`:
- `mygeotab_cache.id`
- `identity_mappings.id`

The `gen_random_uuid()` function requires the `pgcrypto` extension, which is created in migration 0001 (`CREATE EXTENSION IF NOT EXISTS pgcrypto`). Migration ordering is correct (0003 runs after 0001).

---

## 3. Foreign keys — PASS

| FK | Column | References | On Delete |
|---|---|---|---|
| `identity_mappings.app_user_id` | `app_users.id` | CASCADE |
| `identity_mappings.linked_by` | `app_users.id` | (no action, nullable) |

Both reference `app_users(id)` which is defined in 0001. The `app_users` table exists before 0003 runs. FK ordering is correct.

---

## 4. Unique constraints — PASS

| Table | Constraint | Purpose |
|---|---|---|
| `mygeotab_cache` | `UNIQUE (entity_type, entity_id)` | One cache entry per entity type + id |
| `identity_mappings` | `UNIQUE (geotab_user_id, database_name)` | One mapping per MyGeotab user per tenant |

No duplicate constraints with 0001/0002. No constraint name conflicts.

---

## 5. Indexes — PASS

| Index | Table | Columns | Purpose |
|---|---|---|---|
| `mygeotab_cache_expiry_idx` | `mygeotab_cache` | `expires_at` | TTL cleanup queries |
| `mygeotab_cache_entity_idx` | `mygeotab_cache` | `(entity_type, entity_id)` | Cache lookups (supports unique constraint) |
| `identity_mappings_app_user_idx` | `identity_mappings` | `app_user_id` | Lookup mappings by app user |
| `identity_mappings_geotab_idx` | `identity_mappings` | `geotab_user_id` | Lookup mappings by MyGeotab user |
| `identity_mappings_active_idx` | `identity_mappings` | `(is_active, database_name)` | Active tenant-scoped lookups |

All indexes are additive and do not conflict with 0001/0002 indexes.

---

## 6. Tenant-scoped identity mappings — PASS

`identity_mappings.database_name`:
- Type: `text`, NOT NULL, DEFAULT `'opex_trial'`
- Part of `UNIQUE(geotab_user_id, database_name)` composite constraint
- Indexed via `identity_mappings_active_idx(is_active, database_name)`

This enforces that a MyGeotab user is mapped to an app user within a specific tenant. The default `'opex_trial'` matches the target tenant. The auth layer can query `WHERE geotab_user_id = $1 AND database_name = $2 AND is_active = true` to validate tenant membership.

---

## 7. `geotab_device_id` / `geotab_user_id` — PASS

These columns already exist in 0001:
- `vehicles.geotab_device_id text UNIQUE`
- `app_users.geotab_user_id text UNIQUE`

0003 does **not** alter these columns. It adds new tables that reference them:
- `identity_mappings.geotab_user_id text NOT NULL` (external reference, not a FK to MyGeotab — it's a text field storing the MyGeotab user ID)

No new columns named `geotab_device_id` or `geotab_user_id` are added by 0003, so there's no conflict.

---

## 8. MyGeotab cache expiration — PASS

`mygeotab_cache.expires_at`:
- Type: `timestamptz`, NOT NULL
- Indexed via `mygeotab_cache_expiry_idx` for efficient TTL cleanup queries
- The application is responsible for setting `expires_at` in the future and cleaning up expired rows

No automatic expiration mechanism exists in PostgreSQL without a scheduled job or extension. The application must handle TTL enforcement at the data access layer.

---

## 9. Vehicle synchronization metadata — PASS

Additive columns on `vehicles`:
- `geotab_last_synced_at timestamptz` — when vehicle data was last refreshed from MyGeotab
- `geotab_sync_version text` — version/identifier of the synced data

Both use `ADD COLUMN IF NOT EXISTS`, making the migration idempotent. No data is modified; existing rows get NULL values until synced.

---

## 10. Migration ordering — PASS

| Dependency | Provided by | Order |
|---|---|---|
| `pgcrypto` extension | 0001 | Before 0003 |
| `btree_gist` extension | 0001 | Before 0003 |
| `app_users` table | 0001 | Before 0003 |
| `gen_random_uuid()` function | 0001 (pgcrypto) | Before 0003 |

0003 correctly depends on 0001 and 0002 being applied first. The `migrate.mjs` script applies migrations in filename sort order, so 0003 runs after 0001 and 0002.

---

## 11. Rollback strategy — PASS

Documented rollback:
```sql
ALTER TABLE vehicles DROP COLUMN IF EXISTS geotab_last_synced_at;
ALTER TABLE vehicles DROP COLUMN IF EXISTS geotab_sync_version;
DROP TABLE IF EXISTS identity_mappings;
DROP TABLE IF EXISTS mygeotab_cache;
```

- Dropping additive columns is safe (no data loss in 0001/0002 tables)
- Dropping `mygeotab_cache` discards only regenerable cache data
- Dropping `identity_mappings` severs MyGeotab user <-> app user links; requires identity-adapter coordination
- No 0001/0002 tables, columns, or data are touched

---

## 12. Compatibility with 0001 and 0002 — PASS

| Check | Result |
|---|---|
| No table name conflicts | ✅ `mygeotab_cache`, `identity_mappings` are new |
| No column name conflicts on existing tables | ✅ Only additive columns on `vehicles` |
| No constraint name conflicts | ✅ All constraint names are new or inline |
| No extension conflicts | ✅ Uses `pgcrypto` and `btree_gist` from 0001 |
| FK targets exist | ✅ `app_users(id)` from 0001 |
| GiST constraint (0002) not affected | ✅ `reservation_slots` is untouched |
| Migration sort order correct | ✅ 0003 > 0002 > 0001 |

---

## 13. Review result: APPROVED (prepared, not executed)

Migration 0003 is syntactically valid, structurally consistent with 0001 and 0002, uses safe additive changes only, has documented rollback, and correctly handles tenant-scoped identity mapping and cache TTL. It is safe to execute against a newly provisioned PostgreSQL database that has 0001 and 0002 applied.

**Not executed** — no live PostgreSQL is available in this environment. Execution requires `DATABASE_URL` and `npm run db:migrate`.
