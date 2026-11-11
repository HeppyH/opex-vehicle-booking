import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { requirePrincipal, requireRole } from "./auth";
import { sqlFor } from "./db";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== c.env.ALLOWED_ORIGIN) return c.json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  await next();
});
app.use("/api/*", cors({
  origin: (origin, c) => origin === c.env.ALLOWED_ORIGIN ? origin : "",
  allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
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
  // This endpoint creates an unassigned request only. Assignment has a separate
  // transactional path and must perform the vehicle conflict check at assignment time.
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

app.post("/api/bookings/:id/approve", requirePrincipal, requireRole("APPROVER", "MANAGEMENT", "ADMIN"), c =>
  c.json({ error: "APPROVAL_ENGINE_NOT_IMPLEMENTED", bookingId: c.req.param("id") }, 501)
);
app.post("/api/bookings/:id/assign", requirePrincipal, requireRole("GA", "ADMIN"), c =>
  c.json({ error: "ASSIGNMENT_TRANSACTION_NOT_IMPLEMENTED", bookingId: c.req.param("id") }, 501)
);

app.notFound(c => c.json({ error: "NOT_FOUND" }, 404));
app.onError((err, c) => {
  return c.json({ error: "INTERNAL_ERROR", message: c.env.APP_ENV === "development" ? err.message : "Unexpected error" }, 500);
});

export default app;
