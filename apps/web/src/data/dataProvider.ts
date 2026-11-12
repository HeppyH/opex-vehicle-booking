/*───────────────────── Local MyGeotab-Aligned Data Provider ─────────────────────*/

import type {
  MyGeotabDevice,
  MyGeotabUser,
  MyGeotabGroup,
  MyGeotabStatusData,
  MyGeotabLogRecord,
  OpexBooking,
  ResolvedVehicle,
  ResolvedBooking,
  ResolvedEmployee,
  BookingDataProvider,
} from "./types";
import {
  mockMyGeotabDevices,
  mockMyGeotabUsers,
  mockMyGeotabGroups,
  mockMyGeotabStatusData,
  mockMyGeotabLogRecords,
  mockOpexBookings,
} from "./mockMyGeotab";

const STORAGE_KEY = "opex-vbm-demo-bookings";
const RESET_KEY = "opex-vbm-demo-reset";

/*───────────────────── Helper: resolve master data references ─────────────────────*/

function resolveVehicle(device: MyGeotabDevice): ResolvedVehicle {
  return {
    id: device.id,
    vehicle_code: `VEH-${device.id.slice(-3).toUpperCase()}`,
    make_model: `${device.make ?? "Unknown"} ${device.model ?? "Vehicle"}`,
    vehicle_class: device.vehicleClass ?? "OPERATIONAL_4X4",
    registration_no: device.licensePlate ?? null,
    status: device.status,
    geotab_device_id: device.id,
  };
}

function resolveUser(user: MyGeotabUser): ResolvedEmployee {
  return {
    id: user.id,
    name: user.name || "Unknown",
    roles: user.role ? [user.role] : ["EMPLOYEE"],
  };
}

function resolveBooking(
  booking: OpexBooking,
  devices: Map<string, MyGeotabDevice>,
  users: Map<string, MyGeotabUser>,
): ResolvedBooking {
  const device = devices.get(booking.deviceId);
  const requester = users.get(booking.requesterUserId);

  return {
    id: booking.id,
    requester_id: booking.requesterUserId,
    requester_name: requester?.name ?? "Unknown User",
    requested_class: booking.requestedClass,
    vehicle_id: booking.deviceId ?? null,
    vehicle_code: device ? `VEH-${device.id.slice(-3).toUpperCase()}` : null,
    registration_no: device?.licensePlate ?? null,
    start_at: booking.startAt,
    end_at: booking.endAt,
    buffer_before_minutes: booking.bufferBeforeMinutes,
    buffer_after_minutes: booking.bufferAfterMinutes,
    purpose: booking.purpose,
    destination: booking.destination,
    passenger_count: booking.passengerCount,
    status: booking.status,
    version: booking.version,
    created_at: booking.createdAt,
  };
}

/*───────────────────── Local Data Provider Implementation ─────────────────────*/
export class LocalBookingDataProvider implements BookingDataProvider {
  private devices: MyGeotabDevice[];
  private users: MyGeotabUser[];
  private groups: MyGeotabGroup[];
  private statusData: MyGeotabStatusData[];
  private logRecords: MyGeotabLogRecord[];
  private bookings: OpexBooking[];

  constructor() {
    this.devices = [...mockMyGeotabDevices];
    this.users = [...mockMyGeotabUsers];
    this.groups = [...mockMyGeotabGroups];
    this.statusData = [...mockMyGeotabStatusData];
    this.logRecords = [...mockMyGeotabLogRecords];
    this.bookings = this.loadBookingsFromStorage();
  }

  /*───────────────────── localStorage persistence ─────────────────────*/
  private loadBookingsFromStorage(): OpexBooking[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [...mockOpexBookings];
      const parsed = JSON.parse(raw) as OpexBooking[];
      if (!Array.isArray(parsed) || parsed.length === 0) return [...mockOpexBookings];
      return parsed;
    } catch {
      return [...mockOpexBookings];
    }
  }

  private saveBookingsToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bookings));
    } catch {
      // localStorage may be unavailable in some environments
    }
  }

  /*───────────────────── Master data ─────────────────────*/
  async getDevices(): Promise<ResolvedVehicle[]> {
    return this.devices.map(resolveVehicle);
  }

  async getUsers(): Promise<ResolvedEmployee[]> {
    return this.users.map(resolveUser);
  }

  async getGroups(): Promise<MyGeotabGroup[]> {
    return [...this.groups];
  }

  async getStatusData(): Promise<MyGeotabStatusData[]> {
    return [...this.statusData];
  }

  async getLogRecords(): Promise<MyGeotabLogRecord[]> {
    return [...this.logRecords];
  }

  /*───────────────────── Booking operations ─────────────────────*/
  async getBookings(): Promise<ResolvedBooking[]> {
    const deviceMap = new Map(this.devices.map(d => [d.id, d]));
    const userMap = new Map(this.users.map(u => [u.id, u]));
    return this.bookings.map(b => resolveBooking(b, deviceMap, userMap));
  }

  async createBooking(input: {
    deviceId: string;
    requesterUserId: string;
    requestedClass: "OPERATIONAL_4X4" | "PASSENGER";
    startAt: string;
    endAt: string;
    purpose: string;
    destination: string | null;
    passengerCount: number | null;
  }): Promise<ResolvedBooking> {
    const newId = `b${Date.now()}`;
    const now = new Date().toISOString();

    const booking: OpexBooking = {
      id: newId,
      deviceId: input.deviceId,
      requesterUserId: input.requesterUserId,
      requestedClass: input.requestedClass,
      startAt: input.startAt,
      endAt: input.endAt,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 30,
      purpose: input.purpose,
      destination: input.destination,
      passengerCount: input.passengerCount,
      status: "PENDING_APPROVAL",
      assignedDriverUserId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    this.bookings.push(booking);
    this.saveBookingsToStorage();

    const deviceMap = new Map(this.devices.map(d => [d.id, d]));
    const userMap = new Map(this.users.map(u => [u.id, u]));
    return resolveBooking(booking, deviceMap, userMap);
  }

  async updateBookingStatus(id: string, status: string): Promise<void> {
    const idx = this.bookings.findIndex(b => b.id === id);
    if (idx === -1) throw new Error(`BOOKING_NOT_FOUND: ${id}`);
    this.bookings[idx] = {
      ...this.bookings[idx],
      status: status as OpexBooking["status"],
      updatedAt: new Date().toISOString(),
      version: this.bookings[idx].version + 1,
    };
    this.saveBookingsToStorage();
  }

  async deleteBooking(id: string): Promise<void> {
    const idx = this.bookings.findIndex(b => b.id === id);
    if (idx === -1) throw new Error(`BOOKING_NOT_FOUND: ${id}`);
    this.bookings.splice(idx, 1);
    this.saveBookingsToStorage();
  }

  async resetDemoData(): Promise<void> {
    this.bookings = [...mockOpexBookings];
    this.saveBookingsToStorage();
  }

  isLive(): boolean {
    return false;
  }
}

/*───────────────────── Singleton instance ─────────────────────*/
export const bookingDataProvider = new LocalBookingDataProvider();
