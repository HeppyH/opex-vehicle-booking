/*───────────────────── MyGeotab-Aligned Types ─────────────────────*/

import type { GeotabDevice, GeotabUser, GeotabTrip, GeotabLocation } from "../../../api/src/integrations/mygeotab/types";

/*───────────────────── Groups ─────────────────────*/
export interface MyGeotabGroup {
  id: string;
  name: string;
  parentId?: string;
}

/*───────────────────── Devices (extended GeotabDevice) ─────────────────────*/
export interface MyGeotabDevice extends GeotabDevice {
  licensePlate?: string;
  make?: string;
  model?: string;
  vehicleClass?: "OPERATIONAL_4X4" | "PASSENGER";
  groupIds: string[];
  status: "AVAILABLE" | "MAINTENANCE" | "OUT_OF_SERVICE";
}

/*───────────────────── Users (extended GeotabUser) ─────────────────────*/
export interface MyGeotabUser extends GeotabUser {
  email: string;
  companyGroups: string[];
  securityClearance?: string[];
  role?: "EMPLOYEE" | "APPROVER" | "GA" | "MANAGEMENT" | "ADMIN";
  siteCode?: string;
}

/*───────────────────── Telemetry ─────────────────────*/
export interface MyGeotabStatusData extends GeotabLocation {
  id: string;
  deviceId: string;
  odometer?: number;
  fuelLevel?: number;
  engineHours?: number;
}

export interface MyGeotabLogRecord extends GeotabLocation {
  id: string;
  deviceId: string;
  speed?: number;
  heading?: number;
}

/*───────────────────── OPEX Booking (MyGeotab-aligned) ─────────────────────*/
export interface OpexBooking {
  id: string;
  deviceId: string;
  requesterUserId: string;
  requestedClass: "OPERATIONAL_4X4" | "PASSENGER";
  startAt: string;
  endAt: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  purpose: string;
  destination: string | null;
  passengerCount: number | null;
  status:
    | "DRAFT"
    | "SUBMITTED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "ASSIGNED"
    | "CHECKED_OUT"
    | "OVERDUE"
    | "RETURNED"
    | "CLOSED"
    | "COMPLETED"
    | "REJECTED"
    | "CANCELLED"
    | "EXPIRED";
  assignedDriverUserId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/*───────────────────── Frontend-view types (resolved through master data) ─────────────────────*/
export interface ResolvedVehicle {
  id: string;
  vehicle_code: string;
  make_model: string;
  vehicle_class: string;
  registration_no: string | null;
  status: string;
  geotab_device_id: string | null;
}

export interface ResolvedBooking {
  id: string;
  requester_id: string;
  requester_name: string;
  requested_class: string;
  vehicle_id: string | null;
  vehicle_code: string | null;
  registration_no: string | null;
  start_at: string;
  end_at: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  purpose: string;
  destination: string | null;
  passenger_count: number | null;
  status: string;
  version: number;
  created_at: string;
}

export interface ResolvedEmployee {
  id: string;
  name: string;
  roles: string[];
}

/*───────────────────── Data Provider Interface ─────────────────────*/
export interface BookingDataProvider {
  getDevices(): Promise<ResolvedVehicle[]>;
  getUsers(): Promise<ResolvedEmployee[]>;
  getGroups(): Promise<MyGeotabGroup[]>;
  getStatusData(): Promise<MyGeotabStatusData[]>;
  getLogRecords(): Promise<MyGeotabLogRecord[]>;
  getBookings(): Promise<ResolvedBooking[]>;
  createBooking(input: {
    deviceId: string;
    requesterUserId: string;
    requestedClass: "OPERATIONAL_4X4" | "PASSENGER";
    startAt: string;
    endAt: string;
    purpose: string;
    destination: string | null;
    passengerCount: number | null;
  }): Promise<ResolvedBooking>;
  updateBookingStatus(id: string, status: string): Promise<void>;
  deleteBooking(id: string): Promise<void>;
  resetDemoData(): Promise<void>;
  isLive(): boolean;
}
