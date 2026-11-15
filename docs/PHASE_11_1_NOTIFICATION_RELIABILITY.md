# Phase 11.1 – Notification Reliability – OPEX Asset Booking MyGeotab Integration

**Repository:** `C:\04. Project 2026\Geotab\Book Vehicle\opex-vehicle-booking-clone`
**Branch:** `feature/vehicle-booking-phase-2`
**Date:** 2026-11-14

## 1. Rate Limits (Official MyGeotab SDK)

**Classification:** VERIFIED FROM OFFICIAL DOCUMENTATION

| Limit | Value | Period | Status | Source |
|-------|-------|--------|--------|--------|
| Notifications visible per add-in | 2 | At a time | Active | developers.geotab.com/myGeotab/addIns/serviceAddins |
| Notification calls per add-in | 6 | 1 minute | Active | developers.geotab.com/myGeotab/addIns/serviceAddins |

## 2. Rate Limiter Implementation

**Classification:** VERIFIED BY AUTOMATED TEST

The `NotificationRateLimiter` class in `apps/web/src/serviceAddin.ts` enforces both limits:

### Per-Minute Call Limit (6 calls / 60 seconds)

Uses a rolling window:
- Records timestamp of each `service.notifications.show()` call
- Removes calls older than 60 seconds from the window
- Blocks calls when 6 calls exist within the rolling window

### Visible Notification Limit (2 at a time)

- Tracks count of currently visible notifications
- Increments when `show()` is called
- Decrements after notification duration expires (10 seconds, matching `duration: 10`)
- Blocks new deliveries when count reaches 2

### Code Location

`apps/web/src/serviceAddin.ts` — `NotificationRateLimiter` class and `deliverPendingNotifications()` function.

## 3. Delivery Status Lifecycle

**Classification:** VERIFIED BY AUTOMATED TEST (DEMO mode), REQUIRES TENANT VALIDATION (MyGeotab mode)

| Status | Set By | When | Meaning |
|--------|--------|------|---------|
| `pending` | Custom-page Add-In | Notification created in AddInData | Awaiting native delivery |
| `delivered` | Service Add-In | `service.notifications.show()` succeeds | Native toast shown |
| `failed` | Service Add-In | `service.notifications.show()` throws | Native delivery failed |

### Key Rules

1. `delivery_status` is updated **only after** the corresponding operation succeeds
2. A failed native delivery leaves the notification as `"pending"` for retry
3. A failed delivery is **NOT** marked as `"delivered"`
4. Notifications are retried on every poll cycle (30 seconds) until delivered or manually handled

## 4. Delivery Flow

```
1. Booking event occurs (custom-page Add-In)
   ↓
2. NotificationEngine.createNotification() → AddInData record
   - delivery_status: "pending"
   - idempotencyKey: notif:{event}:{bookingId}:{recipient}
   ↓
3. Service Add-In polls AddInData every 30s
   - whereClause: details.delivery_status = "pending"
   ↓
4. Rate limiter checks:
   - canCall() (max 6/min) → skip if exceeded
   - canShow() (max 2 visible) → skip if exceeded
   ↓
5. service.notifications.show({ title, text, type, duration })
   - Success → delivery_status: "delivered"
   - Failure → delivery_status: "failed" (retried next poll)
   ↓
6. api.call("Set", ...) updates AddInData record
   ↓
7. setTimeout(10s) decrements visible count
```

## 4. Idempotency and Duplicate Prevention

**Classification:** VERIFIED BY AUTOMATED TEST (deduplication), REQUIRES TENANT VALIDATION (native delivery)

### Idempotency Key Format

```
notif:{eventType}:{bookingId}:{recipientUserId}
```

Examples:
- `notif:booking_created:b-001:u104`
- `notif:booking_approved:b-002:u101`
- `notif:vehicle_assigned:b-003:u101`

### Duplicate Prevention Mechanisms

| Mechanism | Scope | Prevents |
|-----------|-------|----------|
| `findByIdempotencyKey()` before `createNotification()` | AddInData records | Duplicate notification records for same logical event |
| `delivery_status` check before processing | Service Add-In polling | Re-processing already-delivered notifications |
| Rate limiter | Service Add-In polling | Excessive API calls |

### What Is NOT Prevented

| Scenario | Classification | Mitigation |
|----------|---------------|------------|
| Duplicate native toast under race conditions | At-least-once, best-effort | Documented limitation |
| Duplicate delivery if two Service Add-In instances run | Not guaranteed | MyGeotab runs one instance per database |
| Re-delivery after browser restart | Expected behavior | Notifications remain pending until delivered |

## 5. Concurrency and Race Conditions

**Classification:** DOCUMENTED LIMITATION

### Known Race Condition

Two Service Add-In instances (or two poll cycles overlapping) could:

1. Both read the same pending notification from AddInData
2. Both call `service.notifications.show()`
3. Both call `api.call("Set", ...)` to mark as delivered

### Mitigation

`deliverPendingNotifications` re-checks `delivery_status !== "pending"` before processing each notification. This reduces but does not eliminate the race condition.

### Atomic Locking

**Classification:** NOT AVAILABLE

AddInData `Get`/`Set` operations are not atomic. There is no `compareAndSet` or conditional update mechanism. Exact-once delivery is **not technically guaranteed**.

### Delivery Guarantee

**Classification:** At-least-once, best-effort

- A notification **may** be delivered more than once under race conditions
- A notification **may not** be delivered if the Service Add-In is not running when the poll occurs
- Duplicate native toasts are possible

## 6. Failed Notification Handling

**Classification:** VERIFIED BY AUTOMATED TEST

| Failure Scenario | Behavior |
|-----------------|----------|
| `service.notifications.show()` throws | Caught, notification remains `pending`, retried next poll |
| `service.notifications.show()` unavailable | `canCall()` not invoked, notification remains `pending` |
| `api.call("Set", ...)` fails | Caught, delivery_status update skipped, notification remains `pending` |
| `service.localStorage.get()` fails | `getAddInId()` returns `null`, delivery skipped safely |
| `service.api.call()` missing | `apiCall()` returns `null`, delivery skipped safely |

### Retry Strategy

- Failed notifications remain `pending` indefinitely
- Retried on every poll cycle (30 seconds)
- No exponential backoff (simple retry)
- No maximum retry count (notifications persist until delivered)
- Rate limiter prevents thundering herd on retry

## 7. Visibility and Duration

- Notification duration: 10 seconds (matches `duration: 10` in `show()` call)
- Visible count decremented via `setTimeout(10000)` after delivery
- If browser is closed before timeout, visible count is not decremented (reset on next session)

## 8. Test Results

**Classification:** VERIFIED BY AUTOMATED TEST

| Test | Result |
|------|--------|
| Rate limiter: 6 calls per minute | PASS |
| Rate limiter: 7th call blocked | PASS |
| Rate limiter: 2 visible notifications | PASS |
| Rate limiter: 3rd visible blocked | PASS |
| Rate limiter: decrementVisible | PASS |
| Delivery: status checked before processing | PASS |
| Delivery: rate limit integration | PASS |
| Delivery: missing AddInId → safe no-op | PASS |
| Delivery: failed notification not marked delivered | PASS |
| Concurrency: duplicate processing handled | PASS |

## 9. Remaining Tenant Validation Requirements

| Item | Classification |
|------|---------------|
| `service.localStorage` shares data with `window.localStorage` | REQUIRES TENANT VALIDATION |
| `service.notifications.show()` available in tenant | REQUIRES TENANT VALIDATION |
| Native toast actually displayed to user | REQUIRES TENANT VALIDATION |
| delivery_status transitions observed in AddInData | REQUIRES TENANT VALIDATION |
| Rate limits enforced by MyGeotab platform | REQUIRES TENANT VALIDATION |
