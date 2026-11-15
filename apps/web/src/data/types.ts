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
  approverId: string | null;
  approvalRemarks: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/*───────────────────── Frontend-view types (resolved through master data) ─────────────────────*/
export interface ResolvedAsset {
  id: string;
  asset_code: string;
  make_model: string;
  asset_class: string;
  registration_no: string | null;
  status: string;
  geotab_device_id: string | null;
}

export interface ResolvedBooking {
  id: string;
  requester_id: string;
  requester_name: string;
  requested_class: string;
  asset_id: string | null;
  asset_code: string | null;
  registration_no: string | null;
  start_at: string;
  end_at: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  purpose: string;
  destination: string | null;
  passenger_count: number | null;
  status: string;
  approver_id: string | null;
  approval_remarks: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ResolvedUser {
  id: string;
  name: string;
  roles: string[];
}

/*───────────────────── Data Provider Interface ─────────────────────*/
export interface BookingDataProvider {
  getAssets(): Promise<ResolvedAsset[]>;
  getUsers(): Promise<ResolvedUser[]>;
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
  updateBookingStatus(id: string, status: string, approverId?: string, approvalRemarks?: string): Promise<void>;
  deleteBooking(id: string): Promise<void>;
  resetDemoData(): Promise<void>;
  isLive(): boolean;
  getApprovers(): Promise<ResolvedUser[]>;
}

/*───────────────────── Notification Types ─────────────────────*/

export type NotificationType =
  | "booking_created"
  | "booking_approved"
  | "booking_rejected"
  | "vehicle_assigned"
  | "booking_cancelled";

export interface OpexNotification {
  id: string;
  eventId: string;
  idempotencyKey: string;
  type: NotificationType;
  recipient_user_id: string;
  related_booking_id: string | null;
  title: string;
  message: string;
  is_read: boolean;
  delivery_status: "pending" | "delivered" | "failed";
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpexBookingAudit {
  id: string;
  booking_id: string;
  action: string;
  actor_user_id: string;
  previous_status: string | null;
  new_status: string | null;
  details: string | null;
  created_at: string;
}

/*───────────────────── Notification Provider Interface ─────────────────────*/

export interface NotificationDataProvider {
  getNotifications(userId: string, opts?: { limit?: number; offset?: number; unreadOnly?: boolean; type?: NotificationType }): Promise<OpexNotification[]>;
  getUnreadCount(userId: string): Promise<number>;
  createNotification(input: {
    eventId: string;
    idempotencyKey: string;
    type: NotificationType;
    recipient_user_id: string;
    related_booking_id: string | null;
    title: string;
    message: string;
  }): Promise<OpexNotification>;
  findByIdempotencyKey(idempotencyKey: string): Promise<OpexNotification | null>;
  markAsRead(notificationId: string): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
  markDeliveryStatus(notificationId: string, status: "pending" | "delivered" | "failed"): Promise<void>;
  createAuditRecord(input: {
    booking_id: string;
    action: string;
    actor_user_id: string;
    previous_status: string | null;
    new_status: string | null;
    details: string | null;
  }): Promise<void>;
  getAuditRecords(bookingId: string): Promise<OpexBookingAudit[]>;
  isLive(): boolean;
}
