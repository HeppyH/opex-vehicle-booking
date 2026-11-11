CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geotab_user_id text UNIQUE,
  email text UNIQUE,
  display_name text NOT NULL,
  department text,
  manager_user_id uuid REFERENCES app_users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  role text NOT NULL CHECK (role IN ('EMPLOYEE','APPROVER','GA','MANAGEMENT','ADMIN')),
  site_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role, site_code)
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_code text NOT NULL UNIQUE,
  geotab_device_id text UNIQUE,
  registration_no text UNIQUE,
  make_model text NOT NULL,
  vehicle_class text NOT NULL CHECK (vehicle_class IN ('OPERATIONAL_4X4','PASSENGER')),
  passenger_capacity integer CHECK (passenger_capacity IS NULL OR passenger_capacity > 0),
  four_wheel_drive boolean,
  site_code text NOT NULL DEFAULT 'NORTH_SUMATRA',
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','MAINTENANCE','OUT_OF_SERVICE')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES app_users(id),
  requested_class text NOT NULL CHECK (requested_class IN ('OPERATIONAL_4X4','PASSENGER')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes integer NOT NULL DEFAULT 30 CHECK (buffer_after_minutes >= 0),
  purpose text NOT NULL,
  destination text,
  passenger_count integer CHECK (passenger_count IS NULL OR passenger_count >= 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','PENDING_APPROVAL','APPROVED','ASSIGNED',
    'CHECKED_OUT','OVERDUE','RETURNED','CLOSED','REJECTED','CANCELLED','EXPIRED'
  )),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX bookings_requester_start_idx ON bookings(requester_id, start_at DESC);
CREATE INDEX bookings_status_start_idx ON bookings(status, start_at);

CREATE TABLE booking_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  step_no integer NOT NULL,
  approver_id uuid NOT NULL REFERENCES app_users(id),
  decision text NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  comments text,
  delegated_from uuid REFERENCES app_users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(booking_id, step_no)
);

CREATE TABLE vehicle_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  created_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES app_users(id),
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_assignment_per_booking ON assignments(booking_id) WHERE active = true;
CREATE INDEX assignments_vehicle_active_idx ON assignments(vehicle_id) WHERE active = true;

CREATE TABLE handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  checkout_at timestamptz,
  return_at timestamptz,
  odometer_out numeric(12,1),
  odometer_in numeric(12,1),
  fuel_level_out numeric(5,2),
  fuel_level_in numeric(5,2),
  condition_out text,
  condition_in text,
  notes text,
  CHECK (odometer_out IS NULL OR odometer_in IS NULL OR odometer_in >= odometer_out)
);

CREATE TABLE booking_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES app_users(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  correlation_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_audit_entity_idx ON booking_audit(entity_type, entity_id, occurred_at);

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  recipient_user_id uuid REFERENCES app_users(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Conflict enforcement is implemented in a single transaction with a vehicle-row
-- lock and an overlap re-check. A materialized reservation_slots table with a
-- native GiST exclusion constraint can be added if desired; the assignment and
-- booking interval spans two tables, so this migration does not declare an invalid
-- cross-table exclusion expression.
