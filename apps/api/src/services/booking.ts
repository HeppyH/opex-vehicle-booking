import type { Sql } from "postgres";

/**
 * Assign an already-approved booking to a vehicle.
 * Must run as one transaction. The vehicle row lock serializes concurrent
 * assignments for that vehicle; reservation_slots has a GiST exclusion
 * constraint as a second line of defence.
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
      select id, status, start_at, end_at, buffer_before_minutes, buffer_after_minutes
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
