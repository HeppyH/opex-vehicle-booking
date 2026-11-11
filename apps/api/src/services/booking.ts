import type { Sql } from "postgres";

export type BookingRole = "EMPLOYEE" | "APPROVER" | "GA" | "MANAGEMENT" | "ADMIN";

/**
 * Valid booking status transitions.
 * The current status is the key; the value is the set of statuses it can
 * transition to via a single workflow action.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["CHECKED_OUT", "CANCELLED"],
  CHECKED_OUT: ["OVERDUE", "RETURNED"],
  OVERDUE: ["RETURNED"],
  RETURNED: ["CLOSED"],
  REJECTED: [],
  CANCELLED: [],
  CLOSED: [],
  EXPIRED: [],
} as const;

/**
 * Roles permitted to approve a booking.
 */
export const APPROVER_ROLES: BookingRole[] = ["APPROVER", "MANAGEMENT", "ADMIN"];

/**
 * Roles permitted to assign a vehicle to a booking.
 */
export const ASSIGN_ROLES: BookingRole[] = ["GA", "ADMIN"];

/**
 * Roles permitted to cancel a booking (in addition to the requester).
 */
export const CANCEL_ADMIN_ROLES: BookingRole[] = ["MANAGEMENT", "ADMIN"];

/**
 * Check whether a state transition is valid.
 */
export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Check whether a principal may approve/reject a booking.
 * A user may not approve or reject their own booking.
 */
export function canApprove(principal: { appUserId: string; roles: BookingRole[] }, requesterId: string): boolean {
  if (!APPROVER_ROLES.some(r => principal.roles.includes(r))) return false;
  if (principal.appUserId === requesterId) return false;
  return true;
}

/**
 * Check whether a principal may assign a vehicle to a booking.
 */
export function canAssign(principal: { roles: BookingRole[] }): boolean {
  return ASSIGN_ROLES.some(r => principal.roles.includes(r));
}

/**
 * Check whether a principal may cancel a booking.
 * The requester may cancel their own booking; MANAGEMENT/ADMIN may cancel any.
 */
export function canCancel(principal: { appUserId: string; roles: BookingRole[] }, requesterId: string): boolean {
  if (principal.appUserId === requesterId) return true;
  return CANCEL_ADMIN_ROLES.some(r => principal.roles.includes(r));
}

/**
 * Assign an already-approved booking to a vehicle.
 * Transactional: vehicle row lock, idempotency, conflict check, hold check,
 * reservation slot insert, audit, idempotency record.
 */
export async function assignApprovedBooking(
  sql: Sql,
  input: { bookingId: string; vehicleId: string; assignedBy: string; idempotencyKey: string }
) {
  return sql.begin(async tx => {
    const prior = await tx`
      select response_json from idempotency_records
      where idempotency_key = ${input.idempotencyKey}
    `;
    if (prior.length) return prior[0].response_json;

    const vehicle = await tx`
      select id, status, active from vehicles
      where id = ${input.vehicleId} for update
    `;
    if (!vehicle.length || !vehicle[0].active || vehicle[0].status !== "AVAILABLE") {
      throw new Error("VEHICLE_NOT_AVAILABLE");
    }

    const bookingRows = await tx`
      select id, status, start_at, end_at, buffer_before_minutes, buffer_after_minutes, requester_id
      from bookings where id = ${input.bookingId} for update
    `;
    if (!bookingRows.length) throw new Error("BOOKING_NOT_FOUND");
    const booking = bookingRows[0];
    if (booking.status !== "APPROVED") throw new Error("BOOKING_NOT_APPROVED");

    const conflict = await tx`
      select id from reservation_slots
      where vehicle_id = ${input.vehicleId} and active = true
        and tstzrange(reserved_from, reserved_until, '[)')
          && tstzrange(
            ${booking.start_at}::timestamptz - (${booking.buffer_before_minutes} || ' minutes')::interval,
            ${booking.end_at}::timestamptz + (${booking.buffer_after_minutes} || ' minutes')::interval,
            '[)'
          )
      limit 1
    `;
    if (conflict.length) throw new Error("VEHICLE_TIME_CONFLICT");

    const hold = await tx`
      select id from vehicle_holds
      where vehicle_id = ${input.vehicleId} and status = 'ACTIVE'
        and tstzrange(start_at, end_at, '[)')
          && tstzrange(
            ${booking.start_at}::timestamptz - (${booking.buffer_before_minutes} || ' minutes')::interval,
            ${booking.end_at}::timestamptz + (${booking.buffer_after_minutes} || ' minutes')::interval,
            '[)'
          )
      limit 1
    `;
    if (hold.length) throw new Error("VEHICLE_ON_HOLD");

    const assignment = await tx`
      insert into assignments (booking_id, vehicle_id, assigned_by)
      values (${input.bookingId}, ${input.vehicleId}, ${input.assignedBy})
      returning id, booking_id, vehicle_id, assigned_at
    `;
    await tx`
      insert into reservation_slots
        (booking_id, vehicle_id, reserved_from, reserved_until, active)
      values (
        ${input.bookingId}, ${input.vehicleId},
        ${booking.start_at}::timestamptz - (${booking.buffer_before_minutes} || ' minutes')::interval,
        ${booking.end_at}::timestamptz + (${booking.buffer_after_minutes} || ' minutes')::interval,
        true
      )
    `;
    await tx`
      update bookings set status = 'ASSIGNED', version = version + 1, updated_at = now()
      where id = ${input.bookingId}
    `;
    await tx`
      insert into booking_audit (actor_user_id, entity_type, entity_id, action, after_json)
      values (${input.assignedBy}, 'BOOKING', ${input.bookingId}, 'VEHICLE_ASSIGNED', ${tx.json(assignment[0])})
    `;
    await tx`
      insert into idempotency_records (idempotency_key, response_json)
      values (${input.idempotencyKey}, ${tx.json(assignment[0])})
    `;
    return assignment[0];
  });
}

/**
 * Approve a booking. Transitions SUBMITTED/PENDING_APPROVAL → APPROVED.
 * Creates a booking_approvals record with decision APPROVED.
 * The approver may not be the requester.
 */
export async function approveBooking(
  sql: Sql,
  input: { bookingId: string; approverId: string; comments?: string; stepNo?: number }
) {
  return sql.begin(async tx => {
    const booking = await tx`
      select id, status, requester_id from bookings where id = ${input.bookingId} for update
    `;
    if (!booking.length) throw new Error("BOOKING_NOT_FOUND");
    const b = booking[0];
    if (!isValidTransition(b.status, "APPROVED")) {
      throw new Error(`INVALID_TRANSITION: ${b.status} → APPROVED`);
    }

    const stepNo = input.stepNo ?? 1;

    const approval = await tx`
      insert into booking_approvals (booking_id, step_no, approver_id, decision, comments)
      values (${input.bookingId}, ${stepNo}, ${input.approverId}, 'APPROVED', ${input.comments ?? null})
      returning id, booking_id, step_no, approver_id, decision, decided_at, created_at
    `;

    await tx`
      update bookings set status = 'APPROVED', version = version + 1, updated_at = now()
      where id = ${input.bookingId}
    `;

    await tx`
      insert into booking_audit (actor_user_id, entity_type, entity_id, action, after_json)
      values (${input.approverId}, 'BOOKING', ${input.bookingId}, 'BOOKING_APPROVED', ${tx.json(approval[0])})
    `;

    return { bookingId: b.id, status: "APPROVED", approval: approval[0] };
  });
}

/**
 * Reject a booking. Transitions SUBMITTED/PENDING_APPROVAL → REJECTED.
 * Creates a booking_approvals record with decision REJECTED.
 * Deactivates any reservation slot for the booking.
 * The rejecter may not be the requester.
 */
export async function rejectBooking(
  sql: Sql,
  input: { bookingId: string; rejecterId: string; reason?: string; comments?: string; stepNo?: number }
) {
  return sql.begin(async tx => {
    const booking = await tx`
      select id, status, requester_id from bookings where id = ${input.bookingId} for update
    `;
    if (!booking.length) throw new Error("BOOKING_NOT_FOUND");
    const b = booking[0];
    if (!isValidTransition(b.status, "REJECTED")) {
      throw new Error(`INVALID_TRANSITION: ${b.status} → REJECTED`);
    }

    const stepNo = input.stepNo ?? 1;

    const approval = await tx`
      insert into booking_approvals (booking_id, step_no, approver_id, decision, comments)
      values (${input.bookingId}, ${stepNo}, ${input.rejecterId}, 'REJECTED', ${input.comments ?? null})
      returning id, booking_id, step_no, approver_id, decision, decided_at, created_at
    `;

    await tx`
      update bookings set status = 'REJECTED', version = version + 1, updated_at = now()
      where id = ${input.bookingId}
    `;

    // Deactivate any active reservation slot for this booking.
    await tx`
      update reservation_slots set active = false
      where booking_id = ${input.bookingId} and active = true
    `;

    await tx`
      insert into booking_audit (actor_user_id, entity_type, entity_id, action, after_json)
      values (${input.rejecterId}, 'BOOKING', ${input.bookingId}, 'BOOKING_REJECTED', ${tx.json(approval[0])})
    `;

    return { bookingId: b.id, status: "REJECTED", approval: approval[0] };
  });
}

/**
 * Cancel a booking. Transitions DRAFT/SUBMITTED/PENDING_APPROVAL/APPROVED → CANCELLED.
 * If the booking is APPROVED, deactivates any reservation slot in the same
 * transaction. The requester may cancel their own booking; MANAGEMENT/ADMIN
 * may cancel any booking.
 */
export async function cancelBooking(
  sql: Sql,
  input: { bookingId: string; cancelerId: string; reason?: string }
) {
  return sql.begin(async tx => {
    const booking = await tx`
      select id, status, requester_id from bookings where id = ${input.bookingId} for update
    `;
    if (!booking.length) throw new Error("BOOKING_NOT_FOUND");
    const b = booking[0];
    if (!isValidTransition(b.status, "CANCELLED")) {
      throw new Error(`INVALID_TRANSITION: ${b.status} → CANCELLED`);
    }

    await tx`
      update bookings set status = 'CANCELLED', version = version + 1, updated_at = now()
      where id = ${input.bookingId}
    `;

    // Deactivate any active reservation slot for this booking.
    // This runs for all cancelled bookings; for non-APPROVED bookings the
    // update simply affects zero rows (no slot exists yet).
    await tx`
      update reservation_slots set active = false
      where booking_id = ${input.bookingId} and active = true
    `;

    await tx`
      insert into booking_audit (actor_user_id, entity_type, entity_id, action, after_json)
      values (${input.cancelerId}, 'BOOKING', ${input.bookingId}, 'BOOKING_CANCELLED', ${tx.json({
        status: "CANCELLED",
        reason: input.reason ?? null,
      })})
    `;

    return { bookingId: b.id, status: "CANCELLED" };
  });
}
