/*───────────────────── Local MyGeotab-Aligned Data Provider ─────────────────────*/

import type {
  MyGeotabDevice,
  MyGeotabUser,
  MyGeotabGroup,
  MyGeotabStatusData,
  MyGeotabLogRecord,
  OpexBooking,
  ResolvedAsset,
  ResolvedBooking,
  ResolvedUser,
  BookingDataProvider,
  NotificationDataProvider,
  OpexNotification,
  OpexBookingAudit,
  NotificationType,
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
const NOTIFICATION_STORAGE_KEY = "opex-vbm-demo-notifications";
const AUDIT_STORAGE_KEY = "opex-vbm-demo-audit";

/*───────────────────── Helper: resolve master data references ─────────────────────*/

function resolveAsset(device: MyGeotabDevice): ResolvedAsset {
  return {
    id: device.id,
    asset_code: `VEH-${device.id.slice(-3).toUpperCase()}`,
    make_model: `${device.make ?? "Unknown"} ${device.model ?? "Asset"}`,
    asset_class: device.vehicleClass ?? "OPERATIONAL_4X4",
    registration_no: device.licensePlate ?? null,
    status: device.status,
    geotab_device_id: device.id,
  };
}

function resolveUser(user: MyGeotabUser): ResolvedUser {
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
    asset_id: booking.deviceId ?? null,
    asset_code: device ? `VEH-${device.id.slice(-3).toUpperCase()}` : null,
    registration_no: device?.licensePlate ?? null,
    start_at: booking.startAt,
    end_at: booking.endAt,
    buffer_before_minutes: booking.bufferBeforeMinutes,
    buffer_after_minutes: booking.bufferAfterMinutes,
    purpose: booking.purpose,
    destination: booking.destination,
    passenger_count: booking.passengerCount,
    status: booking.status,
    approver_id: booking.approverId ?? null,
    approval_remarks: booking.approvalRemarks ?? null,
    version: booking.version,
    created_at: booking.createdAt,
    updated_at: booking.updatedAt,
  };
}

/*───────────────────── Local Data Provider Implementation ─────────────────────*/
export class LocalBookingDataProvider implements BookingDataProvider, NotificationDataProvider {
  private devices: MyGeotabDevice[];
  private users: MyGeotabUser[];
  private groups: MyGeotabGroup[];
  private statusData: MyGeotabStatusData[];
  private logRecords: MyGeotabLogRecord[];
  private bookings: OpexBooking[];
  private notifications: OpexNotification[];
  private auditRecords: OpexBookingAudit[];

  constructor() {
    this.devices = [...mockMyGeotabDevices];
    this.users = [...mockMyGeotabUsers];
    this.groups = [...mockMyGeotabGroups];
    this.statusData = [...mockMyGeotabStatusData];
    this.logRecords = [...mockMyGeotabLogRecords];
    this.bookings = this.loadBookingsFromStorage();
    this.notifications = this.loadNotificationsFromStorage();
    this.auditRecords = this.loadAuditRecordsFromStorage();
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

  private loadNotificationsFromStorage(): OpexNotification[] {
    try {
      const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as OpexNotification[];
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }

  private saveNotificationsToStorage(): void {
    try {
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(this.notifications));
    } catch {
      // localStorage may be unavailable
    }
  }

  private loadAuditRecordsFromStorage(): OpexBookingAudit[] {
    try {
      const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as OpexBookingAudit[];
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }

  private saveAuditRecordsToStorage(): void {
    try {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.auditRecords));
    } catch {
      // localStorage may be unavailable
    }
  }

  /*───────────────────── Master data ─────────────────────*/
  async getAssets(): Promise<ResolvedAsset[]> {
    return this.devices.map(resolveAsset);
  }

  async getUsers(): Promise<ResolvedUser[]> {
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
      approverId: null,
      approvalRemarks: null,
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

  async updateBookingStatus(id: string, status: string, approverId?: string, approvalRemarks?: string): Promise<void> {
    const idx = this.bookings.findIndex(b => b.id === id);
    if (idx === -1) throw new Error(`BOOKING_NOT_FOUND: ${id}`);
    this.bookings[idx] = {
      ...this.bookings[idx],
      status: status as OpexBooking["status"],
      ...(approverId !== undefined ? { approverId } : {}),
      ...(approvalRemarks !== undefined ? { approvalRemarks } : {}),
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
    this.notifications = [];
    this.auditRecords = [];
    this.saveBookingsToStorage();
    this.saveNotificationsToStorage();
    this.saveAuditRecordsToStorage();
  }

  /*───────────────────── Notification operations ─────────────────────*/
  async getNotifications(userId: string, opts?: { limit?: number; offset?: number; unreadOnly?: boolean; type?: NotificationType }): Promise<OpexNotification[]> {
    let result = this.notifications
      .filter(n => n.recipient_user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (opts?.unreadOnly) result = result.filter(n => !n.is_read);
    if (opts?.type) result = result.filter(n => n.type === opts.type);
    const start = opts?.offset ?? 0;
    const end = opts?.limit !== undefined ? start + opts.limit : result.length;
    return result.slice(start, end);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notifications.filter(n => n.recipient_user_id === userId && !n.is_read).length;
  }

  async createNotification(input: {
    eventId: string;
    idempotencyKey: string;
    type: NotificationType;
    recipient_user_id: string;
    related_booking_id: string | null;
    title: string;
    message: string;
  }): Promise<OpexNotification> {
    // Duplicate prevention: skip if a notification with this idempotency key already exists
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const now = new Date().toISOString();
    const notification: OpexNotification = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      eventId: input.eventId,
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      recipient_user_id: input.recipient_user_id,
      related_booking_id: input.related_booking_id,
      title: input.title,
      message: input.message,
      is_read: false,
      delivery_status: "pending",
      delivered_at: null,
      created_at: now,
      updated_at: now,
    };
    this.notifications.push(notification);
    this.saveNotificationsToStorage();
    return notification;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OpexNotification | null> {
    const found = this.notifications.find(n => n.idempotencyKey === idempotencyKey);
    return found ?? null;
  }

  async markAsRead(notificationId: string): Promise<void> {
    const idx = this.notifications.findIndex(n => n.id === notificationId);
    if (idx === -1) return;
    this.notifications[idx] = { ...this.notifications[idx], is_read: true, updated_at: new Date().toISOString() };
    this.saveNotificationsToStorage();
  }

  async markAllAsRead(userId: string): Promise<void> {
    const now = new Date().toISOString();
    this.notifications = this.notifications.map(n =>
      n.recipient_user_id === userId && !n.is_read
        ? { ...n, is_read: true, updated_at: now }
        : n
    );
    this.saveNotificationsToStorage();
  }

  async markDeliveryStatus(notificationId: string, status: "pending" | "delivered" | "failed"): Promise<void> {
    const idx = this.notifications.findIndex(n => n.id === notificationId);
    if (idx === -1) return;
    this.notifications[idx] = {
      ...this.notifications[idx],
      delivery_status: status,
      delivered_at: status === "delivered" ? new Date().toISOString() : this.notifications[idx].delivered_at,
      updated_at: new Date().toISOString(),
    };
    this.saveNotificationsToStorage();
  }

  /*───────────────────── Audit operations ─────────────────────*/
  async createAuditRecord(input: {
    booking_id: string;
    action: string;
    actor_user_id: string;
    previous_status: string | null;
    new_status: string | null;
    details: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    const record: OpexBookingAudit = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      booking_id: input.booking_id,
      action: input.action,
      actor_user_id: input.actor_user_id,
      previous_status: input.previous_status,
      new_status: input.new_status,
      details: input.details,
      created_at: now,
    };
    this.auditRecords.push(record);
    this.saveAuditRecordsToStorage();
  }

  async getAuditRecords(bookingId: string): Promise<OpexBookingAudit[]> {
    return this.auditRecords
      .filter(r => r.booking_id === bookingId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  isLive(): boolean {
    return false;
  }

  async getApprovers(): Promise<ResolvedUser[]> {
    return this.users
      .filter(u => u.role === "APPROVER")
      .map(resolveUser);
  }
}

/*───────────────────── Singleton instance ─────────────────────*/
export const bookingDataProvider = new LocalBookingDataProvider();
