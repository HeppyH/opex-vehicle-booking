import type { MiddlewareHandler } from "hono";
import type { Env } from "./env.ts";
import type { Sql } from "postgres";
import { sqlFor } from "./db.ts";
import type { GeotabCredentials } from "./integrations/mygeotab/types.ts";
import { TenantValidatedMyGeotabAdapter } from "./integrations/mygeotab/adapter.ts";

export type AppRole = "EMPLOYEE" | "APPROVER" | "GA" | "MANAGEMENT" | "ADMIN";
export type Principal = { appUserId: string; geotabUserId: string; roles: AppRole[]; siteIds: string[] };

declare module "hono" {
  interface ContextVariableMap { principal: Principal }
}

/**
 * Header names used to transport MyGeotab session credentials from the
 * Add-In frontend to the backend. The frontend receives an already-authenticated
 * `api` object from the MyGeotab host in `initialize(api, state, callback)` and
 * extracts the session credentials (userName, database, sessionId) from it.
 *
 * The database name is NEVER accepted from the frontend as proof of tenant
 * membership. It is always validated against `env.GEOTAB_DATABASE` (`opex_trial`).
 */
const HEADER_SESSION_ID = "x-geotab-session-id";
const HEADER_USER_NAME = "x-geotab-user-name";

/**
 * Extract MyGeotab session credentials from an HTTP request.
 * Returns null when no credentials are present.
 */
export function extractGeotabCredentials(request: Request): GeotabCredentials | null {
  const sessionId = request.headers.get(HEADER_SESSION_ID) ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const userName = request.headers.get(HEADER_USER_NAME);

  if (!sessionId || !userName) return null;

  return { userName, database: "", sessionId };
}

/**
 * SECURITY GATE:
 * Resolves a verified principal from a MyGeotab session.
 *
 * Flow:
 * 1. Extract session credentials (sessionId + userName) from the request.
 * 2. Fail closed if `IDENTITY_ADAPTER_CONFIGURED !== "true"`.
 * 3. Verify the session by calling MyGeotab API with the user's sessionId
 *    (sessionId substitutes for the password per MyGeotab SDK docs).
 * 4. Validate that the session's database equals `env.GEOTAB_DATABASE`
 *    (`opex_trial`). The frontend-supplied database is never trusted.
 * 5. Look up `identity_mappings` for the geotab_user_id + database_name.
 * 6. Look up `role_assignments` for the mapped app_user.
 * 7. Return the Principal or null on any failure.
 *
 * If the MyGeotab adapter is not implemented (throws
 * GEOTAB_ADAPTER_NOT_IMPLEMENTED), verification fails and this returns null.
 * Protected endpoints remain fail-closed until the adapter is implemented.
 */
export async function resolveVerifiedPrincipal(
  request: Request,
  env: Env,
): Promise<Principal | null> {
  // Fail closed: identity adapter not configured.
  if (env.IDENTITY_ADAPTER_CONFIGURED !== "true") return null;

  const credentials = extractGeotabCredentials(request);
  if (!credentials) return null;

  // Step 3: Verify the MyGeotab session server-side.
  const adapter = new TenantValidatedMyGeotabAdapter({
    database: env.GEOTAB_DATABASE,
    server: undefined,
  });

  let verification;
  try {
    verification = await adapter.verifySession({
      ...credentials,
      database: env.GEOTAB_DATABASE, // Always use server-configured tenant, never frontend-supplied.
    });
  } catch {
    // Session invalid, expired, or adapter not implemented.
    return null;
  }

  if (!verification?.valid) return null;

  // Step 4: Tenant isolation — the verified database must match opex_trial.
  if (verification.database !== env.GEOTAB_DATABASE) return null;

  // Step 5 & 6: Map MyGeotab identity to application user and roles.
  const sql = sqlFor(env);
  try {
    const mappings = await sql`
      select im.app_user_id, im.geotab_user_id, im.database_name, im.is_active
      from identity_mappings im
      where im.geotab_user_id = ${verification.userName}
        and im.database_name = ${env.GEOTAB_DATABASE}
        and im.is_active = true
      limit 1
    `;
    if (!mappings.length) return null;

    const appUserId = mappings[0].app_user_id;

    const rolesRows = await sql`
      select role from role_assignments
      where user_id = ${appUserId}
    `;
    const roles = rolesRows.map(r => r.role as AppRole);

    if (roles.length === 0) return null;

    return {
      appUserId,
      geotabUserId: verification.userName,
      roles,
      siteIds: [],
    };
  } finally {
    await sql.end();
  }
}

export const requirePrincipal: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const principal = await resolveVerifiedPrincipal(c.req.raw, c.env);
  if (!principal) return c.json({
    error: "AUTH_ADAPTER_NOT_CONFIGURED",
    message: "Protected endpoints are disabled until verified identity is implemented."
  }, 503);
  c.set("principal", principal);
  await next();
};

export function requireRole(...allowed: AppRole[]): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const p = c.get("principal");
    if (!p || !p.roles.some(r => allowed.includes(r))) {
      return c.json({ error: "FORBIDDEN" }, 403);
    }
    await next();
  };
}
