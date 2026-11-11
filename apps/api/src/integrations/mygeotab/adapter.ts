import type { GeotabCredentials, GeotabLocation, GeotabSessionVerification, GeotabTrip, GeotabUser, MyGeotabAdapter } from "./types";

/**
 * MyGeotab adapter — scaffold implementation.
 *
 * Authentication model (per MyGeotab SDK documentation):
 * - The Add-In host provides an already-authenticated `api` object in
 *   `initialize(api, state, callback)`. The frontend can retrieve the active
 *   user's credentials (userName, database, sessionId) via `api.getSession()`
 *   or from `api.credentials`.
 * - The frontend sends the sessionId to the backend in the
 *   `X-Geotab-Session-Id` header (or `Authorization: Bearer`).
 * - The backend verifies the session by calling MyGeotab API with the
 *   user's sessionId (substituting for the password) and confirming the
 *   database matches `opex_trial`.
 * - Session IDs expire after 14 days, on password change, or at the
 *   100-concurrent-session limit.
 *
 * All mutating device/user/trip/location methods remain unimplemented
 * until tenant validation against `opex_trial` is complete.
 */
export class TenantValidatedMyGeotabAdapter implements MyGeotabAdapter {
  private readonly server: string;
  private readonly database: string;

  constructor(config: { database: string; server?: string; username?: string }) {
    this.server = config.server ?? "my.geotab.com";
    this.database = config.database;
  }

  private baseUrl(): string {
    return `https://${this.server}/apiv1`;
  }

  private async jsonRpc<T>(
    method: string,
    params: Record<string, unknown>,
    credentials?: { userName: string; sessionId: string; database: string }
  ): Promise<T> {
    const creds = credentials ?? { userName: "", database: this.database, sessionId: "" };
    const body = {
      jsonrpc: "2.0",
      method,
      params: {
        credentials: {
          userName: creds.userName,
          database: creds.database,
          sessionId: creds.sessionId,
        },
        ...params,
      },
      id: 1,
    };

    const response = await fetch(this.baseUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`MYGEOTAB_HTTP_ERROR: ${response.status}`);
    }

    const result = (await response.json()) as { error?: { code?: number; message?: string; data?: unknown }; result?: unknown };
    if (result.error) {
      throw new Error(`MYGEOTAB_API_ERROR: ${result.error.message ?? String(result.error)}`);
    }
    return result.result as T;
  }

  async listDevices(): Promise<never> {
    throw new Error("GEOTAB_ADAPTER_NOT_IMPLEMENTED");
  }

  async listUsers(): Promise<never> {
    throw new Error("GEOTAB_ADAPTER_NOT_IMPLEMENTED");
  }

  async listTrips(_deviceId: string, _fromUtc: string, _toUtc: string): Promise<never> {
    throw new Error("GEOTAB_ADAPTER_NOT_IMPLEMENTED");
  }

  async latestLocations(_deviceIds: string[]): Promise<never> {
    throw new Error("GEOTAB_ADAPTER_NOT_IMPLEMENTED");
  }

  /**
   * Verify a MyGeotab user session by calling a lightweight authenticated
   * API method (Get on User) with the user's own sessionId. Returns the
   * verified database and userName if the session is active.
   */
  async verifySession(credentials: GeotabCredentials): Promise<GeotabSessionVerification> {
    // Use Get on User to confirm the session is active. Searching by the
    // user's own username returns their record if the session is valid.
    await this.jsonRpc<unknown>("Get", {
      typeName: "User",
      search: { userName: credentials.userName },
      resultsLimit: 1,
    }, credentials);

    return {
      valid: true,
      database: credentials.database,
      userName: credentials.userName,
    };
  }
}
