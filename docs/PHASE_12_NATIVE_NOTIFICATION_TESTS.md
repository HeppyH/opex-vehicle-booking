# Phase 12 – Native MyGeotab Notification Tests

**Repository:** `C:\04. Project 2026\Geotab\Book Vehicle\opex-vehicle-booking-clone`
**Branch:** `feature/vehicle-booking-phase-2`
**Target Tenant:** `opex_trial` (test database only)
**Status:** BLOCKED — Requires registered Service Add-In and tenant access

## 1. Native Notification API Contract

**Classification:** VERIFIED FROM OFFICIAL DOCUMENTATION

| Method | Signature | Returns | Source |
|--------|-----------|---------|--------|
| `service.notifications.show()` | `(opts: INotificationOptions) => INotification` | `{ hide: () => void }` | developers.geotab.com/myGeotab/addIns/serviceAddins |

### `INotificationOptions`

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `title` | string | Yes | Notification title |
| `text` | string | Yes | Notification message body |
| `type` | "info" \| "warning" \| "error" \| "success" | No | Notification type (default: "info") |
| `duration` | number | No | Seconds until auto-hide (default: platform default) |
| `buttons` | unknown[] | No | Action buttons with click handlers |

**Note:** The SDK does NOT support `recipientType` or `recipientUserId` parameters. Notifications are shown to the currently authenticated MyGeotab user in the Service Add-In context.

### Rate Limits

| Limit | Value | Period | Status |
|-------|-------|--------|--------|
| Notification calls per add-in | 6 | 1 minute | Active |
| Notifications visible per add-in | 2 | At a time | Active |

## 2. Test Scenarios

### Scenario 1 – Booking Created → Approver

| Field | Value |
|-------|-------|
| Trigger | User A (employee) creates a new booking |
| Expected Recipient | Configured approver (User B) |
| Native Toast Title | "New Vehicle Booking Request" |
| Native Toast Message | "A new booking request BK-XXXX from [Requester] requires your approval." |
| OPEX Record | `type: "booking_created"`, `recipient_user_id: <approver-id>` |
| Test Date/Time | Not tested |
| Actual Result | BLOCKED — tenant required |
| OPEX Notification Status | Not tested |
| Native Toast Status | Not tested |
| AddInData Delivery Status | Not tested |
| Classification | BLOCKED — TENANT ACCESS REQUIRED |

### Scenario 2 – Booking Approved → Requester

| Field | Value |
|-------|-------|
| Trigger | Approver (User B) approves booking |
| Expected Recipient | Original requester (User A) |
| Native Toast Title | "Booking Approved" |
| Native Toast Message | "Your vehicle booking BK-XXXX has been approved by [Approver]." |
| OPEX Record | `type: "booking_approved"`, `recipient_user_id: <requester-id>` |
| Test Date/Time | Not tested |
| Actual Result | BLOCKED — tenant required |
| OPEX Notification Status | Not tested |
| Native Toast Status | Not tested |
| AddInData Delivery Status | Not tested |
| Classification | BLOCKED — TENANT ACCESS REQUIRED |

### Scenario 3 – Booking Rejected → Requester

| Field | Value |
|-------|-------|
| Trigger | Approver (User B) rejects booking |
| Expected Recipient | Original requester (User A) |
| Native Toast Title | "Booking Rejected" |
| Native Toast Message | "Your vehicle booking BK-XXXX has been rejected[. Reason: <reason>]." |
| OPEX Record | `type: "booking_rejected"`, `recipient_user_id: <requester-id>` |
| Test Date/Time | Not tested |
| Actual Result | BLOCKED — tenant required |
| OPEX Notification Status | Not tested |
| Native Toast Status | Not tested |
| AddInData Delivery Status | Not tested |
| Classification | BLOCKED — TENANT ACCESS REQUIRED |

### Scenario 4 – Vehicle Assigned → Requester

| Field | Value |
|-------|-------|
| Trigger | GA/Admin assigns vehicle to booking |
| Expected Recipient | Original requester |
| Native Toast Title | "Vehicle Assigned" |
| Native Toast Message | "[Vehicle code] has been assigned to your booking BK-XXXX." |
| OPEX Record | `type: "vehicle_assigned"`, `recipient_user_id: <requester-id>` |
| Test Date/Time | Not tested |
| Actual Result | BLOCKED — tenant required |
| OPEX Notification Status | Not tested |
| Native Toast Status | Not tested |
| AddInData Delivery Status | Not tested |
| Classification | BLOCKED — TENANT ACCESS REQUIRED |

### Scenario 5 – Duplicate Prevention

| Field | Value |
|-------|-------|
| Trigger | Same event triggered twice (same booking + recipient + event type) |
| Expected Result | Only 1 OPEX notification record created |
| Idempotency Key | `notif:<eventType>:<bookingId>:<recipientUserId>` — same for both |
| Test Date/Time | Not tested |
| Actual Result | BLOCKED — tenant required |
| Classification | BLOCKED — TENANT ACCESS REQUIRED |

### Scenario 6 – Delivery Failure

| Field | Value |
|-------|-------|
| Trigger | `service.notifications.show()` fails or unavailable |
| Expected Result | Notification record remains `pending`, not marked `delivered` |
| Retry | Eligible for retry on next poll cycle (30s) |
| Test Date/Time | Not tested |
| Actual Result | BLOCKED — tenant required |
| Classification | BLOCKED — TENANT ACCESS REQUIRED |

### Scenario 7 – Persistence

| Field | Value |
|-------|-------|
| Trigger | Browser reload; logout/login |
| Expected Result | Notification records remain available in AddInData |
| Test Date/Time | Not tested |
| Actual Result | BLOCKED — tenant required |
| Classification | BLOCKED — TENANT ACCESS REQUIRED |

## 3. Test Users (Generic Labels)

| Label | Role | Purpose |
|-------|------|---------|
| User A | EMPLOYEE | Booking requester |
| User B | APPROVER | Approve/reject bookings |
| User C | GA/ADMIN | Vehicle assignment |

## 4. Evidence Requirements

For each scenario, the following must be captured from the actual `opex_trial` tenant:

1. Screenshot of native MyGeotab toast notification (if visible)
2. Screenshot of AddInData record in database (if accessible)
3. Console log showing `service.notifications.show()` call
4. Console log showing delivery status update

**Important:** Do not fabricate test results or screenshots. Mark as BLOCKED if not actually executed.

## 5. Classification

| Item | Classification |
|------|---------------|
| Native notification API contract | VERIFIED FROM OFFICIAL DOCUMENTATION |
| Rate limiting implementation | VERIFIED BY AUTOMATED TEST |
| Delivery status tracking | VERIFIED BY AUTOMATED TEST |
| Live native toast delivery in opex_trial | BLOCKED — TENANT ACCESS REQUIRED |
| Live AddInData persistence in opex_trial | BLOCKED — TENANT ACCESS REQUIRED |
| Cross-user notification routing | REQUIRES TENANT VALIDATION |
