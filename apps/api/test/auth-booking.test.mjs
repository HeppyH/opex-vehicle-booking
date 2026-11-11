import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Pure function unit tests (no PostgreSQL, no network required)
// These validate the booking workflow authorization and state-machine logic.
// ---------------------------------------------------------------------------

import {
  isValidTransition,
  canApprove,
  canAssign,
  canCancel,
  APPROVER_ROLES,
  ASSIGN_ROLES,
  CANCEL_ADMIN_ROLES,
} from "../src/services/booking.ts";

// --- isValidTransition ---

test("DRAFT can transition to SUBMITTED and CANCELLED", () => {
  assert.equal(isValidTransition("DRAFT", "SUBMITTED"), true);
  assert.equal(isValidTransition("DRAFT", "CANCELLED"), true);
  assert.equal(isValidTransition("DRAFT", "APPROVED"), false);
});

test("SUBMITTED can transition to PENDING_APPROVAL, APPROVED, REJECTED, CANCELLED", () => {
  assert.equal(isValidTransition("SUBMITTED", "PENDING_APPROVAL"), true);
  assert.equal(isValidTransition("SUBMITTED", "APPROVED"), true);
  assert.equal(isValidTransition("SUBMITTED", "REJECTED"), true);
  assert.equal(isValidTransition("SUBMITTED", "CANCELLED"), true);
});

test("PENDING_APPROVAL can transition to APPROVED, REJECTED, CANCELLED", () => {
  assert.equal(isValidTransition("PENDING_APPROVAL", "APPROVED"), true);
  assert.equal(isValidTransition("PENDING_APPROVAL", "REJECTED"), true);
  assert.equal(isValidTransition("PENDING_APPROVAL", "CANCELLED"), true);
  assert.equal(isValidTransition("PENDING_APPROVAL", "ASSIGNED"), false);
});

test("APPROVED can transition to ASSIGNED and CANCELLED", () => {
  assert.equal(isValidTransition("APPROVED", "ASSIGNED"), true);
  assert.equal(isValidTransition("APPROVED", "CANCELLED"), true);
  assert.equal(isValidTransition("APPROVED", "PENDING_APPROVAL"), false);
});

test("ASSIGNED can transition to CHECKED_OUT and CANCELLED", () => {
  assert.equal(isValidTransition("ASSIGNED", "CHECKED_OUT"), true);
  assert.equal(isValidTransition("ASSIGNED", "CANCELLED"), true);
});

test("Terminal states have no outgoing transitions", () => {
  assert.equal(isValidTransition("REJECTED", "CANCELLED"), false);
  assert.equal(isValidTransition("CANCELLED", "APPROVED"), false);
  assert.equal(isValidTransition("CLOSED", "ASSIGNED"), false);
  assert.equal(isValidTransition("EXPIRED", "CANCELLED"), false);
});

test("Unknown status returns false", () => {
  assert.equal(isValidTransition("UNKNOWN_STATUS", "APPROVED"), false);
});

// --- canApprove ---

test("canApprove: APPROVER role can approve another user's booking", () => {
  assert.equal(canApprove({ appUserId: "approver-1", roles: ["APPROVER"] }, "requester-1"), true);
});

test("canApprove: MANAGEMENT role can approve another user's booking", () => {
  assert.equal(canApprove({ appUserId: "mgmt-1", roles: ["MANAGEMENT"] }, "requester-1"), true);
});

test("canApprove: ADMIN role can approve another user's booking", () => {
  assert.equal(canApprove({ appUserId: "admin-1", roles: ["ADMIN"] }, "requester-1"), true);
});

test("canApprove: EMPLOYEE role cannot approve", () => {
  assert.equal(canApprove({ appUserId: "emp-1", roles: ["EMPLOYEE"] }, "requester-1"), false);
});

test("canApprove: GA role cannot approve", () => {
  assert.equal(canApprove({ appUserId: "ga-1", roles: ["GA"] }, "requester-1"), false);
});

test("canApprove: self-approval restriction — same user cannot approve own booking", () => {
  assert.equal(canApprove({ appUserId: "user-1", roles: ["APPROVER"] }, "user-1"), false);
  assert.equal(canApprove({ appUserId: "user-1", roles: ["MANAGEMENT"] }, "user-1"), false);
  assert.equal(canApprove({ appUserId: "user-1", roles: ["ADMIN"] }, "user-1"), false);
});

test("canApprove: empty roles returns false", () => {
  assert.equal(canApprove({ appUserId: "user-1", roles: [] }, "requester-1"), false);
});

// --- canAssign ---

test("canAssign: GA role can assign", () => {
  assert.equal(canAssign({ roles: ["GA"] }), true);
});

test("canAssign: ADMIN role can assign", () => {
  assert.equal(canAssign({ roles: ["ADMIN"] }), true);
});

test("canAssign: EMPLOYEE cannot assign", () => {
  assert.equal(canAssign({ roles: ["EMPLOYEE"] }), false);
});

test("canAssign: APPROVER cannot assign", () => {
  assert.equal(canAssign({ roles: ["APPROVER"] }), false);
});

test("canAssign: empty roles returns false", () => {
  assert.equal(canAssign({ roles: [] }), false);
});

// --- canCancel ---

test("canCancel: requester can cancel their own booking", () => {
  assert.equal(canCancel({ appUserId: "user-1", roles: ["EMPLOYEE"] }, "user-1"), true);
});

test("canCancel: MANAGEMENT can cancel any booking", () => {
  assert.equal(canCancel({ appUserId: "mgmt-1", roles: ["MANAGEMENT"] }, "user-1"), true);
});

test("canCancel: ADMIN can cancel any booking", () => {
  assert.equal(canCancel({ appUserId: "admin-1", roles: ["ADMIN"] }, "user-1"), true);
});

test("canCancel: non-requester without admin role cannot cancel", () => {
  assert.equal(canCancel({ appUserId: "user-2", roles: ["EMPLOYEE"] }, "user-1"), false);
  assert.equal(canCancel({ appUserId: "user-2", roles: ["APPROVER"] }, "user-1"), false);
  assert.equal(canCancel({ appUserId: "user-2", roles: ["GA"] }, "user-1"), false);
});

test("canCancel: empty roles non-requester returns false", () => {
  assert.equal(canCancel({ appUserId: "user-2", roles: [] }, "user-1"), false);
});

// --- Role constant exports ---

test("APPROVER_ROLES contains expected roles", () => {
  assert.equal(APPROVER_ROLES.includes("APPROVER"), true);
  assert.equal(APPROVER_ROLES.includes("MANAGEMENT"), true);
  assert.equal(APPROVER_ROLES.includes("ADMIN"), true);
  assert.equal(APPROVER_ROLES.length, 3);
});

test("ASSIGN_ROLES contains expected roles", () => {
  assert.equal(ASSIGN_ROLES.includes("GA"), true);
  assert.equal(ASSIGN_ROLES.includes("ADMIN"), true);
  assert.equal(ASSIGN_ROLES.length, 2);
});

test("CANCEL_ADMIN_ROLES contains expected roles", () => {
  assert.equal(CANCEL_ADMIN_ROLES.includes("MANAGEMENT"), true);
  assert.equal(CANCEL_ADMIN_ROLES.includes("ADMIN"), true);
  assert.equal(CANCEL_ADMIN_ROLES.length, 2);
});

// ---------------------------------------------------------------------------
// extractGeotabCredentials unit tests (no network, no PostgreSQL)
// ---------------------------------------------------------------------------

import { extractGeotabCredentials } from "../src/auth.ts";

function makeRequest(headers) {
  return new Request("https://api.example.com/api/bookings/1/approve", {
    method: "POST",
    headers,
  });
}

test("extractGeotabCredentials: returns null when no headers present", () => {
  assert.equal(extractGeotabCredentials(makeRequest({})), null);
});

test("extractGeotabCredentials: returns null when only session ID present", () => {
  assert.equal(
    extractGeotabCredentials(makeRequest({ "x-geotab-session-id": "abc123" })),
    null
  );
});

test("extractGeotabCredentials: returns null when only user name present", () => {
  assert.equal(
    extractGeotabCredentials(makeRequest({ "x-geotab-user-name": "user@example.com" })),
    null
  );
});

test("extractGeotabCredentials: extracts from x-geotab headers", () => {
  const creds = extractGeotabCredentials(
    makeRequest({
      "x-geotab-session-id": "sess-123",
      "x-geotab-user-name": "user@example.com",
    })
  );
  assert.equal(creds.userName, "user@example.com");
  assert.equal(creds.sessionId, "sess-123");
  assert.equal(creds.database, "");
});

test("extractGeotabCredentials: extracts from Authorization Bearer header", () => {
  const creds = extractGeotabCredentials(
    makeRequest({
      authorization: "Bearer sess-456",
      "x-geotab-user-name": "user@example.com",
    })
  );
  assert.equal(creds.userName, "user@example.com");
  assert.equal(creds.sessionId, "sess-456");
});

// ---------------------------------------------------------------------------
// resolveVerifiedPrincipal: fail-closed tests (no PostgreSQL, no network)
// ---------------------------------------------------------------------------

import { resolveVerifiedPrincipal } from "../src/auth.ts";

function makeEnv(overrides) {
  return {
    APP_ENV: "development",
    ALLOWED_ORIGIN: "https://vbm.opexcg.com",
    GEOTAB_DATABASE: "opex_trial",
    ...overrides,
  };
}

test("resolveVerifiedPrincipal: returns null when IDENTITY_ADAPTER_CONFIGURED is not set", async () => {
  const env = makeEnv({ IDENTITY_ADAPTER_CONFIGURED: undefined });
  const request = makeRequest({
    "x-geotab-session-id": "sess-123",
    "x-geotab-user-name": "user@example.com",
  });
  const result = await resolveVerifiedPrincipal(request, env);
  assert.equal(result, null);
});

test("resolveVerifiedPrincipal: returns null when IDENTITY_ADAPTER_CONFIGURED is false", async () => {
  const env = makeEnv({ IDENTITY_ADAPTER_CONFIGURED: "false" });
  const request = makeRequest({
    "x-geotab-session-id": "sess-123",
    "x-geotab-user-name": "user@example.com",
  });
  const result = await resolveVerifiedPrincipal(request, env);
  assert.equal(result, null);
});

test("resolveVerifiedPrincipal: returns null when no credentials present", async () => {
  const env = makeEnv({ IDENTITY_ADAPTER_CONFIGURED: "true" });
  const request = makeRequest({});
  const result = await resolveVerifiedPrincipal(request, env);
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Adapter verifySession error-handling (unit, no live MyGeotab)
// ---------------------------------------------------------------------------

import { TenantValidatedMyGeotabAdapter } from "../src/integrations/mygeotab/adapter.ts";

const originalFetch = globalThis.fetch;

test("verifySession: throws when fetch fails with network error", async () => {
  globalThis.fetch = async () => {
    throw new Error("NETWORK_ERROR");
  };

  const adapter = new TenantValidatedMyGeotabAdapter({
    database: "opex_trial",
    server: "my.geotab.com",
  });

  await assert.rejects(
    adapter.verifySession({ userName: "user@example.com", database: "opex_trial", sessionId: "sess-123" }),
    /NETWORK_ERROR/
  );

  globalThis.fetch = originalFetch;
});

test("verifySession: throws on HTTP error response", async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({}), { status: 500, statusText: "Internal Server Error" });
  };

  const adapter = new TenantValidatedMyGeotabAdapter({
    database: "opex_trial",
    server: "my.geotab.com",
  });

  await assert.rejects(
    adapter.verifySession({ userName: "user@example.com", database: "opex_trial", sessionId: "sess-123" }),
    /MYGEOTAB_HTTP_ERROR: 500/
  );

  globalThis.fetch = originalFetch;
});

test("verifySession: throws on JSON-RPC error response", async () => {
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Incorrect login credentials", data: { type: "InvalidUserException" } },
        id: 1,
      }),
      { status: 200, statusText: "OK" }
    );
  };

  const adapter = new TenantValidatedMyGeotabAdapter({
    database: "opex_trial",
    server: "my.geotab.com",
  });

  await assert.rejects(
    adapter.verifySession({ userName: "user@example.com", database: "opex_trial", sessionId: "bad-session" }),
    /MYGEOTAB_API_ERROR: Incorrect login credentials/
  );

  globalThis.fetch = originalFetch;
});

test("verifySession: returns valid on successful JSON-RPC response", async () => {
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: [{ userName: "user@example.com", name: "Test User" }],
        id: 1,
      }),
      { status: 200, statusText: "OK" }
    );
  };

  const adapter = new TenantValidatedMyGeotabAdapter({
    database: "opex_trial",
    server: "my.geotab.com",
  });

  const result = await adapter.verifySession({
    userName: "user@example.com",
    database: "opex_trial",
    sessionId: "sess-valid",
  });

  assert.equal(result.valid, true);
  assert.equal(result.database, "opex_trial");
  assert.equal(result.userName, "user@example.com");

  globalThis.fetch = originalFetch;
});
