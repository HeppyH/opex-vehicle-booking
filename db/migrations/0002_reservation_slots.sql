-- A denormalized active slot table permits a true database-level exclusion constraint.
CREATE TABLE reservation_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  reserved_from timestamptz NOT NULL,
  reserved_until timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CHECK (reserved_until > reserved_from),
  EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(reserved_from, reserved_until, '[)') WITH &&
  ) WHERE (active = true)
);
CREATE INDEX reservation_slots_vehicle_idx ON reservation_slots(vehicle_id, active);
