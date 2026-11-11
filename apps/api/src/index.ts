import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env.ts";
import { requirePrincipal, requireRole } from "./auth.ts";
import { sqlFor } from "./db.ts";
import {
  assignApprovedBooking,
  approveBooking,
  canApprove,
  canAssign,
  canCancel,
  cancelBooking,
  isValidTransition,
  rejectBooking,
} from "./services/booking.ts";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== c.env.ALLOWED_ORIGIN) return c.json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  await next();
});
app.use("/api/*", cors({
  origin: (origin, c) => origin === c.env.ALLOWED_ORIGIN ? origin : "",
  allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Geotab-Session-Id", "X-Geotab-User-Name"],
  maxAge: 600
}));

app.get("/api/health", c => c.json({
  ok: true, service: "opex-vbm-api", environment: c.env.APP_ENV,
  tenantTarget: c.env.GEOTAB_DATABASE,
  authConfigured: c.env.IDENTITY_ADAPTER_CONFIGURED === "true"
}));

app.get("/api/me", requirePrincipal, c => c.json(c.get("principal")));

app.get("/api/vehicles", requirePrincipal, async c => {
  const sql = sqlFor(c.env);
  try {
    const rows = await sql`
      select id, vehicle_code, make_model, vehicle_class, registration_no, status
      from vehicles where active = true order by vehicle_code
    `;
    return c.json(rows);
  } finally { await sql.end(); }
});

app.get("/api/bookings", requirePrincipal, async c => {
  const sql = sqlFor(c.env);
  try {
    const p = c.get("principal");
    const rows = await sql`
      select b.id, b.status, b.start_at, b.end_at, b.purpose, b.requester_id
      from bookings b
      where b.requester_id = ${p.appUserId}
      order by b.start_at desc limit 100
    `;
    return c.json(rows);
  } finally { await sql.end(); }
});

app.post("/api/bookings", requirePrincipal, async c => {
  const body = await c.req.json().catch(() => null) as null | {
    startAt?: string; endAt?: string; purpose?: string; requestedClass?: string
  };
  if (!body?.startAt || !body?.endAt || !body?.purpose) return c.json({ error: "INVALID_REQUEST" }, 400);
  const start = new Date(body.startAt), end = new Date(body.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return c.json({ error: "INVALID_INTERVAL" }, 400);
  const sql = sqlFor(c.env);
  try {
    const p = c.get("principal");
    const rows = await sql`
      insert into bookings (requester_id, requested_class, start_at, end_at, purpose, status)
      values (${p.appUserId}, ${body.requestedClass || "PASSENGER"},
              ${start.toISOString()}, ${end.toISOString()}, ${body.purpose}, 'SUBMITTED')
      returning id, status, start_at, end_at
    `;
    await sql`
      insert into booking_audit (actor_user_id, entity_type, entity_id, action, after_json)
      values (${p.appUserId}, 'BOOKING', ${rows[0].id}, 'BOOKING_SUBMITTED', ${sql.json(rows[0])})
    `;
    return c.json(rows[0], 201);
  } catch (e) {
    return c.json({ error: "BOOKING_CREATE_FAILED", detail: e instanceof Error ? e.message : "unknown" }, 500);
  } finally { await sql.end(); }
});

app.post("/api/bookings/:id/submit-for-approval", requirePrincipal, async c => {
  const bookingId = c.req.param("id");
  const sql = sqlFor(c.env);
  try {
    const p = c.get("principal");
    const booking = await sql`
      select id, status, requester_id from bookings where id = ${bookingId} for update
    `;
    if (!booking.length) return c.json({ error: "BOOKING_NOT_FOUND" }, 404);
    const b = booking[0];
    if (b.requester_id !== p.appUserId) return c.json({ error: "FORBIDDEN" }, 403);
    if (!isValidTransition(b.status, "PENDING_APPROVAL")) {
      return c.json({ error: "INVALID_TRANSITION", from: b.status, to: "PENDING_APPROVAL" }, 409);
    }
    await sql`
      update bookings set status = 'PENDING_APPROVAL', version = version + 1, updated_at = now()
      where id = ${bookingId}
    `;
    await sql`
      insert into booking_audit (actor_user_id, entity_type, entity_id, action, after_json)
      values (${p.appUserId}, 'BOOKING', ${bookingId}, 'BOOKING_SUBMIT_FOR_APPROVAL', ${sql.json({ status: "PENDING_APPROVAL" })})
    `;
    return c.json({ bookingId, status: "PENDING_APPROVAL" });
  } finally { await sql.end(); }
});

app.post("/api/bookings/:id/approve", requirePrincipal, requireRole("APPROVER", "MANAGEMENT", "ADMIN"), async c => {
  const bookingId = c.req.param("id");
  const p = c.get("principal");
  const body = await c.req.json().catch(() => null) as null | { comments?: string; stepNo?: number };
  const sql = sqlFor(c.env);
  try {
    const booking = await sql`
      select id, status, requester_id from bookings where id = ${bookingId} for update
    `;
    if (!booking.length) return c.json({ error: "BOOKING_NOT_FOUND" }, 404);
    const b = booking[0];
    if (!canApprove(p, b.requester_id)) {
      return c.json({ error: "FORBIDDEN", reason: "SELF_APPROVAL_NOT_PERMITTED_OR_INSUFFICIENT_ROLE" }, 403);
    }
    if (!isValidTransition(b.status, "APPROVED")) {
      return c.json({ error: "INVALID_TRANSITION", from: b.status, to: "APPROVED" }, 409);
    }
    const result = await approveBooking(sql, {
      bookingId,
      approverId: p.appUserId,
      comments: body?.comments,
      stepNo: body?.stepNo,
    });
    return c.json(result, 200);
  } catch (e) {
    return c.json({ error: "APPROVAL_FAILED", detail: e instanceof Error ? e.message : "unknown" }, 500);
  } finally { await sql.end(); }
});

app.post("/api/bookings/:id/reject", requirePrincipal, requireRole("APPROVER", "MANAGEMENT", "ADMIN"), async c => {
  const bookingId = c.req.param("id");
  const p = c.get("principal");
  const body = await c.req.json().catch(() => null) as null | { reason?: string; comments?: string; stepNo?: number };
  const sql = sqlFor(c.env);
  try {
    const booking = await sql`
      select id, status, requester_id from bookings where id = ${bookingId} for update
    `;
    if (!booking.length) return c.json({ error: "BOOKING_NOT_FOUND" }, 404);
    const b = booking[0];
    if (!canApprove(p, b.requester_id)) {
      return c.json({ error: "FORBIDDEN", reason: "SELF_REJECTION_NOT_PERMITTED_OR_INSUFFICIENT_ROLE" }, 403);
    }
    if (!isValidTransition(b.status, "REJECTED")) {
      return c.json({ error: "INVALID_TRANSITION", from: b.status, to: "REJECTED" }, 409);
    }
    const result = await rejectBooking(sql, {
      bookingId,
      rejecterId: p.appUserId,
      reason: body?.reason,
      comments: body?.comments,
      stepNo: body?.stepNo,
    });
    return c.json(result, 200);
  } catch (e) {
    return c.json({ error: "REJECTION_FAILED", detail: e instanceof Error ? e.message : "unknown" }, 500);
  } finally { await sql.end(); }
});

app.post("/api/bookings/:id/assign", requirePrincipal, requireRole("GA", "ADMIN"), async c => {
  const bookingId = c.req.param("id");
  const p = c.get("principal");
  const body = await c.req.json().catch(() => null) as null | { vehicleId?: string };
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!body?.vehicleId) return c.json({ error: "INVALID_REQUEST", reason: "MISSING_VEHICLE_ID" }, 400);
  if (!idempotencyKey) return c.json({ error: "INVALID_REQUEST", reason: "MISSING_IDEMPOTENCY_KEY" }, 400);
  const sql = sqlFor(c.env);
  try {
    const booking = await sql`
      select id, status, requester_id from bookings where id = ${bookingId} for update
    `;
    if (!booking.length) return c.json({ error: "BOOKING_NOT_FOUND" }, 404);
    const b = booking[0];
    if (!canAssign(p)) return c.json({ error: "FORBIDDEN" }, 403);
    if (!isValidTransition(b.status, "ASSIGNED")) {
      return c.json({ error: "INVALID_TRANSITION", from: b.status, to: "ASSIGNED" }, 409);
    }
    const result = await assignApprovedBooking(sql, {
      bookingId,
      vehicleId: body.vehicleId,
      assignedBy: p.appUserId,
      idempotencyKey,
    });
    return c.json(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "VEHICLE_NOT_AVAILABLE") return c.json({ error: "VEHICLE_NOT_AVAILABLE" }, 409);
    if (msg === "BOOKING_NOT_APPROVED") return c.json({ error: "BOOKING_NOT_APPROVED" }, 409);
    if (msg === "VEHICLE_TIME_CONFLICT") return c.json({ error: "VEHICLE_TIME_CONFLICT" }, 409);
    if (msg === "VEHICLE_ON_HOLD") return c.json({ error: "VEHICLE_ON_HOLD" }, 409);
    return c.json({ error: "ASSIGNMENT_FAILED", detail: msg }, 500);
  } finally { await sql.end(); }
});

app.post("/api/bookings/:id/cancel", requirePrincipal, async c => {
  const bookingId = c.req.param("id");
  const p = c.get("principal");
  const body = await c.req.json().catch(() => null) as null | { reason?: string };
  const sql = sqlFor(c.env);
  try {
    const booking = await sql`
      select id, status, requester_id from bookings where id = ${bookingId} for update
    `;
    if (!booking.length) return c.json({ error: "BOOKING_NOT_FOUND" }, 404);
    const b = booking[0];
    if (!canCancel(p, b.requester_id)) {
      return c.json({ error: "FORBIDDEN", reason: "NOT_BOOKING_OWNER_OR_ADMIN" }, 403);
    }
    if (!isValidTransition(b.status, "CANCELLED")) {
      return c.json({ error: "INVALID_TRANSITION", from: b.status, to: "CANCELLED" }, 409);
    }
    const result = await cancelBooking(sql, {
      bookingId,
      cancelerId: p.appUserId,
      reason: body?.reason,
    });
    return c.json(result, 200);
  } catch (e) {
    return c.json({ error: "CANCELLATION_FAILED", detail: e instanceof Error ? e.message : "unknown" }, 500);
  } finally { await sql.end(); }
});

app.notFound(c => c.json({ error: "NOT_FOUND" }, 404));
app.onError((err, c) => {
  return c.json({ error: "INTERNAL_ERROR", message: c.env.APP_ENV === "development" ? err.message : "Unexpected error" }, 500);
});

export default app;
