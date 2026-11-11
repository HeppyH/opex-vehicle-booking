import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

export type AppRole = "EMPLOYEE" | "APPROVER" | "GA" | "MANAGEMENT" | "ADMIN";
export type Principal = { appUserId: string; geotabUserId: string; roles: AppRole[]; siteIds: string[] };

declare module "hono" {
  interface ContextVariableMap { principal: Principal }
}

/**
 * SECURITY GATE:
 * Implement this using a documented and tenant-approved identity proof.
 * Do not trust X-User-Id, X-Role, email, or user IDs sent in request JSON.
 * If MyGeotab context cannot be securely verified server-side, use an
 * approved OIDC login and explicit account linking to the MyGeotab User ID.
 */
export async function resolveVerifiedPrincipal(_request: Request, env: Env): Promise<Principal | null> {
  if (env.IDENTITY_ADAPTER_CONFIGURED !== "true") return null;
  // TODO: Replace with real token/session verification and DB role lookup.
  // Fail closed until code review and tenant validation are complete.
  return null;
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
