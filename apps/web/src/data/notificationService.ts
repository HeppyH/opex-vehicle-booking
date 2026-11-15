/*───────────────────── Notification Engine ─────────────────────*/
/* Handles notification creation for booking lifecycle events.
   Deduplicates notifications, resolves recipients, integrates with
   native MyGeotab notifications, and tracks delivery status separately
   from read/unread state.
   Notification records use AddInData (LIVE) or localStorage (DEMO)
   via NotificationDataProvider. */

import type {
  BookingDataProvider,
  NotificationDataProvider,
  OpexNotification,
  ResolvedBooking,
  ResolvedUser,
  NotificationType,
} from "./types";

/*───────────────────── Notification Event Types ─────────────────────*/

export type NotificationEvent =
  | { kind: "booking_created"; booking: ResolvedBooking; approvers: ResolvedUser[] }
  | { kind: "booking_approved"; booking: ResolvedBooking; approver: ResolvedUser | null }
  | { kind: "booking_rejected"; booking: ResolvedBooking; approver: ResolvedUser | null; reason: string | null }
  | { kind: "vehicle_assigned"; booking: ResolvedBooking; assignedBy: ResolvedUser | null }
  | { kind: "booking_cancelled"; booking: ResolvedBooking };

/*───────────────────── Native MyGeotab Notification ─────────────────────*/
/* Native notification via MyGeotab Service Add-In API.
   Returns delivery status: "delivered" when the API accepts the call,
   "failed" otherwise. Best-effort; never breaks the workflow.
   NOTE: This API is only available inside a Service Add-In WebWorker
   context (geotab.addin.service), not from a custom-page Add-In. */

function showNativeNotification(input: {
  title: string;
  message: string;
  recipientUserId?: string;
}): Promise<"delivered" | "failed"> {
  return new Promise(resolve => {
    try {
      const geotab = (window as unknown as { geotab?: { service?: { notifications?: { show?: (opts: { title: string; text: string; type?: "info" | "warning" | "error" | "success"; duration?: number; buttons?: unknown[] }) => unknown } } } }).geotab;
      const show = geotab?.service?.notifications?.show;
      if (typeof show === "function") {
        try {
          show({
            title: input.title,
            text: input.message,
            type: "info",
            duration: 10,
          });
          resolve("delivered");
        } catch {
          resolve("failed");
        }
        return;
      }
      resolve("failed");
    } catch {
      resolve("failed");
    }
  });
}

/*───────────────────── Idempotency ─────────────────────*/

function makeIdempotencyKey(kind: NotificationEvent["kind"], bookingId: string, recipientUserId: string): string {
  return `notif:${kind}:${bookingId}:${recipientUserId}`;
}

/*───────────────────── Notification Templates ─────────────────────*/

function bookingCreatedTemplate(booking: ResolvedBooking): { title: string; message: string } {
  return {
    title: "New Vehicle Booking Request",
    message: `A new booking request BK-${booking.id.slice(-4)} from ${booking.requester_name} requires your approval.`,
  };
}

function bookingApprovedTemplate(booking: ResolvedBooking, approver: ResolvedUser | null): { title: string; message: string } {
  return {
    title: "Booking Approved",
    message: `Your vehicle booking BK-${booking.id.slice(-4)} has been approved by ${approver?.name ?? "an approver"}.`,
  };
}

function bookingRejectedTemplate(booking: ResolvedBooking, approver: ResolvedUser | null, reason: string | null): { title: string; message: string } {
  return {
    title: "Booking Rejected",
    message: `Your vehicle booking BK-${booking.id.slice(-4)} has been rejected${reason ? `. Reason: ${reason}` : ""}.`,
  };
}

function vehicleAssignedTemplate(booking: ResolvedBooking, assignedBy: ResolvedUser | null): { title: string; message: string } {
  return {
    title: "Vehicle Assigned",
    message: `${booking.asset_code || "A vehicle"} has been assigned to your booking BK-${booking.id.slice(-4)}.`,
  };
}

function bookingCancelledTemplate(booking: ResolvedBooking): { title: string; message: string } {
  return {
    title: "Booking Cancelled",
    message: `Your vehicle booking BK-${booking.id.slice(-4)} has been cancelled.`,
  };
}

/*───────────────────── Notification Engine ─────────────────────*/

export class NotificationEngine {
  private readonly notifProvider: NotificationDataProvider;
  private readonly bookingProvider: BookingDataProvider;

  constructor(notifProvider: NotificationDataProvider, bookingProvider: BookingDataProvider) {
    this.notifProvider = notifProvider;
    this.bookingProvider = bookingProvider;
  }

  /*───────────────────── Event Handlers ─────────────────────*/

  async handleBookingCreated(event: NotificationEvent): Promise<void> {
    if (event.kind !== "booking_created") return;
    const { booking, approvers } = event;
    const tmpl = bookingCreatedTemplate(booking);

    // Deduplicate: skip if a booking_created notification for this booking + approver already exists
    const existingApproverIds = new Set<string>();
    for (const approver of approvers) {
      const key = makeIdempotencyKey("booking_created", booking.id, approver.id);
      const existing = await this.notifProvider.findByIdempotencyKey(key);
      if (existing) {
        existingApproverIds.add(approver.id);
        continue;
      }

      await this.notifProvider.createNotification({
        eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        idempotencyKey: key,
        type: "booking_created",
        recipient_user_id: approver.id,
        related_booking_id: booking.id,
        title: tmpl.title,
        message: tmpl.message,
      });

      // Native notification (best-effort, tracked separately from persistence)
      const delivery = await showNativeNotification({
        title: tmpl.title,
        message: tmpl.message,
        recipientUserId: approver.id,
      });
      // Note: delivery status update requires notification id; best-effort fire-and-forget
      // The AddInData record is created first; native delivery is best-effort.
      void delivery;
    }
  }

  async handleBookingApproved(event: NotificationEvent): Promise<void> {
    if (event.kind !== "booking_approved") return;
    const { booking, approver } = event;
    const tmpl = bookingApprovedTemplate(booking, approver);

    const key = makeIdempotencyKey("booking_approved", booking.id, booking.requester_id);
    const existing = await this.notifProvider.findByIdempotencyKey(key);
    if (existing) return;

    await this.notifProvider.createNotification({
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      idempotencyKey: key,
      type: "booking_approved",
      recipient_user_id: booking.requester_id,
      related_booking_id: booking.id,
      title: tmpl.title,
      message: tmpl.message,
    });

    await showNativeNotification({
      title: tmpl.title,
      message: tmpl.message,
      recipientUserId: booking.requester_id,
    });
  }

  async handleBookingRejected(event: NotificationEvent): Promise<void> {
    if (event.kind !== "booking_rejected") return;
    const { booking, approver, reason } = event;
    const tmpl = bookingRejectedTemplate(booking, approver, reason);

    const key = makeIdempotencyKey("booking_rejected", booking.id, booking.requester_id);
    const existing = await this.notifProvider.findByIdempotencyKey(key);
    if (existing) return;

    await this.notifProvider.createNotification({
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      idempotencyKey: key,
      type: "booking_rejected",
      recipient_user_id: booking.requester_id,
      related_booking_id: booking.id,
      title: tmpl.title,
      message: tmpl.message,
    });

    await showNativeNotification({
      title: tmpl.title,
      message: tmpl.message,
      recipientUserId: booking.requester_id,
    });
  }

  async handleVehicleAssigned(event: NotificationEvent): Promise<void> {
    if (event.kind !== "vehicle_assigned") return;
    const { booking, assignedBy } = event;
    const tmpl = vehicleAssignedTemplate(booking, assignedBy);

    const key = makeIdempotencyKey("vehicle_assigned", booking.id, booking.requester_id);
    const existing = await this.notifProvider.findByIdempotencyKey(key);
    if (existing) return;

    await this.notifProvider.createNotification({
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      idempotencyKey: key,
      type: "vehicle_assigned",
      recipient_user_id: booking.requester_id,
      related_booking_id: booking.id,
      title: tmpl.title,
      message: tmpl.message,
    });

    await showNativeNotification({
      title: tmpl.title,
      message: tmpl.message,
      recipientUserId: booking.requester_id,
    });
  }

  async handleBookingCancelled(event: NotificationEvent): Promise<void> {
    if (event.kind !== "booking_cancelled") return;
    const { booking } = event;
    const tmpl = bookingCancelledTemplate(booking);

    const key = makeIdempotencyKey("booking_cancelled", booking.id, booking.requester_id);
    const existing = await this.notifProvider.findByIdempotencyKey(key);
    if (existing) return;

    await this.notifProvider.createNotification({
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      idempotencyKey: key,
      type: "booking_cancelled",
      recipient_user_id: booking.requester_id,
      related_booking_id: booking.id,
      title: tmpl.title,
      message: tmpl.message,
    });

    await showNativeNotification({
      title: tmpl.title,
      message: tmpl.message,
      recipientUserId: booking.requester_id,
    });
  }

  /*───────────────────── Convenience: dispatch from App workflow ─────────────────────*/

  async onBookingCreated(booking: ResolvedBooking, approvers: ResolvedUser[]): Promise<void> {
    await this.handleBookingCreated({ kind: "booking_created", booking, approvers });
  }

  async onBookingApproved(booking: ResolvedBooking, approver: ResolvedUser | null): Promise<void> {
    await this.handleBookingApproved({ kind: "booking_approved", booking, approver });
  }

  async onBookingRejected(booking: ResolvedBooking, approver: ResolvedUser | null, reason: string | null): Promise<void> {
    await this.handleBookingRejected({ kind: "booking_rejected", booking, approver, reason });
  }

  async onVehicleAssigned(booking: ResolvedBooking, assignedBy: ResolvedUser | null): Promise<void> {
    await this.handleVehicleAssigned({ kind: "vehicle_assigned", booking, assignedBy });
  }

  async onBookingCancelled(booking: ResolvedBooking): Promise<void> {
    await this.handleBookingCancelled({ kind: "booking_cancelled", booking });
  }

  /*───────────────────── Notification queries ─────────────────────*/

  async getNotificationsForUser(userId: string, opts?: { limit?: number; offset?: number; unreadOnly?: boolean; type?: NotificationType }): Promise<OpexNotification[]> {
    return this.notifProvider.getNotifications(userId, opts);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notifProvider.getUnreadCount(userId);
  }

  async markAsRead(notificationId: string): Promise<void> {
    await this.notifProvider.markAsRead(notificationId);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notifProvider.markAllAsRead(userId);
  }

  async markDeliveryStatus(notificationId: string, status: "pending" | "delivered" | "failed"): Promise<void> {
    await this.notifProvider.markDeliveryStatus(notificationId, status);
  }
}

/*───────────────────── Factory ─────────────────────*/

export function createNotificationEngine(
  notifProvider: NotificationDataProvider,
  bookingProvider: BookingDataProvider,
): NotificationEngine {
  return new NotificationEngine(notifProvider, bookingProvider);
}
