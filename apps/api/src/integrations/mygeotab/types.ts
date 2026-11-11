export type GeotabDevice = { id: string; name?: string; serialNumber?: string };
export type GeotabUser = { id: string; name?: string; firstName?: string; lastName?: string };
export type GeotabTrip = { id?: string; device?: { id: string }; start?: string; stop?: string };
export type GeotabLocation = { device?: { id: string }; dateTime?: string; latitude?: number; longitude?: number };

export interface MyGeotabAdapter {
  listDevices(): Promise<GeotabDevice[]>;
  listUsers(): Promise<GeotabUser[]>;
  listTrips(deviceId: string, fromUtc: string, toUtc: string): Promise<GeotabTrip[]>;
  latestLocations(deviceIds: string[]): Promise<GeotabLocation[]>;
}
