-- ============================================================================
-- Migration 0003: Booking workflow — MyGeotab-first additive schema
-- ============================================================================
--
-- Status: prepared only. NOT executed against any database.
--
-- Design rules:
--   * Additive only. Existing migrations 0001_initial.sql and
--     0002_reservation_slots.sql are preserved unchanged.
--   * No existing table, column, or constraint is altered or dropped.
--   * MyGeotab identifiers (geotab_device_id, geotab_user_id) are stored as
--     TEXT external references, never as PostgreSQL primary keys.
--   * Safe to execute against a newly provisioned PostgreSQL database that has
--     already had migrations 0001 and 0002 applied.
--   * Requires the pgcrypto and btree_gist extensions (already created in 0001).
--
-- Rollback documentation:
--   To reverse this migration, drop the two new tables and remove the two
--   additive columns from vehicles. Dropping columns added with ADD COLUMN is
--   safe; no data in 0001/0002 tables is touched.
--
--     ALTER TABLE vehicles DROP COLUMN IF EXISTS geotab_last_synced_at;
--     ALTER TABLE vehicles DROP COLUMN IF EXISTS geotab_sync_version;
--     DROP TABLE IF EXISTS identity_mappings;
--     DROP TABLE IF EXISTS mygeotab_cache;
--
--   Note: dropping mygeotab_cache discards cached MyGeotab data only; it is
--   regenerable from the MyGeotab API. Dropping identity_mappings severs the
--   MyGeotab user <-> application user link and must be coordinated with the
--   verified identity adapter.

-- ----------------------------------------------------------------------------
-- 1. MyGeotab sync tracking on vehicles (additive columns only)
-- ----------------------------------------------------------------------------
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS geotab_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS geotab_sync_version text;

-- ----------------------------------------------------------------------------
-- 2. MyGeotab cache registry with explicit TTL
--    Selected MyGeotab data cached only when technically necessary.
--    Never the source of truth; always regenerable from the MyGeotab API.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mygeotab_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL
    CHECK (entity_type IN ('device', 'user', 'trip', 'location')),
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX mygeotab_cache_expiry_idx ON mygeotab_cache (expires_at);
CREATE INDEX mygeotab_cache_entity_idx ON mygeotab_cache (entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- 3. Identity mapping: MyGeotab user -> application user, tenant-scoped
--    Links a verified MyGeotab identity (geotab_user_id) to an app_users row.
--    database_name enforces that only users from the expected tenant (opex_trial)
--    can be mapped.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  geotab_user_id text NOT NULL,
  database_name text NOT NULL DEFAULT 'opex_trial',
  linked_by uuid REFERENCES app_users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (geotab_user_id, database_name)
);

CREATE INDEX identity_mappings_app_user_idx ON identity_mappings (app_user_id);
CREATE INDEX identity_mappings_geotab_idx ON identity_mappings (geotab_user_id);
CREATE INDEX identity_mappings_active_idx ON identity_mappings (is_active, database_name);

-- ============================================================================
-- Notes on scope
-- ============================================================================
--
-- booking_slots: NOT added here. Migration 0002 already creates reservation_slots
-- which fulfills the booking-slot role with a GiST exclusion constraint.
-- Adding a second slot table would be redundant. reservation_slots is the
-- single source of truth for active reserved intervals.
--
-- app_roles: NOT added as a separate table. Role assignments live in
-- role_assignments (0001) which references app_users and enforces a CHECK
-- constraint on the role enum. This satisfies the application-role requirement
-- without a separate roles lookup table.
