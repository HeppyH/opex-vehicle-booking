import type { MyGeotabAdapter } from "./types";

/**
 * Deliberately not wired to an undocumented endpoint.
 * Implement with the official MyGeotab API/SDK after validating:
 * - target tenant/database and server,
 * - supported authentication mechanism,
 * - least-privilege API user / clearance,
 * - actual entity fields and search semantics for Device, User, Trip, LogRecord.
 */
export class TenantValidatedMyGeotabAdapter implements MyGeotabAdapter {
  constructor(_config: { database: string; server?: string; username?: string }) {}
  async listDevices(): Promise<never> { throw new Error("GEOTAB_ADAPTER_NOT_IMPLEMENTED"); }
  async listUsers(): Promise<never> { throw new Error("GEOTAB_ADAPTER_NOT_IMPLEMENTED"); }
  async listTrips(_deviceId: string, _fromUtc: string, _toUtc: string): Promise<never> { throw new Error("GEOTAB_ADAPTER_NOT_IMPLEMENTED"); }
  async latestLocations(_deviceIds: string[]): Promise<never> { throw new Error("GEOTAB_ADAPTER_NOT_IMPLEMENTED"); }
}
