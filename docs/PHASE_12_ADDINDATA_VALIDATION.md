# Phase 12 – AddInData Validation

**Repository:** `C:\04. Project 2026\Geotab\Book Vehicle\opex-vehicle-booking-clone`
**Branch:** `feature/vehicle-booking-phase-2`
**Target Tenant:** `opex_trial` (test database only)
**Status:** BLOCKED — Requires registered Add-In and AddInId

## 1. Validation Scope

AddInData persistence operations to validate:

| Operation | API Call | Status |
|-----------|----------|--------|
| Add notification record | `api.call("Add", { typeName: "AddInData", ... })` | BLOCKED — tenant required |
| Get notification records | `api.call("Get", { typeName: "AddInData", search: { addInId } })` | BLOCKED — tenant required |
| Set (update) notification | `api.call("Set", { typeName: "AddInData", entity: { id, ... } })` | BLOCKED — tenant required |
| Find by idempotency key | `Get` + filter by `idempotencyKey` | BLOCKED — tenant required |
| Mark as read | `Set` with `is_read: true` | BLOCKED — tenant required |
| Mark delivery status | `Set` with `delivery_status` update | BLOCKED — tenant required |

## 2. Expected Behavior

### Notification Record Structure

```json
{
  "id": "n-<timestamp>-<random>",
  "eventId": "evt-<timestamp>-<random>",
  "idempotencyKey": "notif:<eventType>:<bookingId>:<recipientUserId>",
  "type": "booking_created|booking_approved|booking_rejected|vehicle_assigned|booking_cancelled",
  "recipient_user_id": "<mygeotab-user-id>",
  "related_booking_id": "<booking-id>|null",
  "title": "<notification-title>",
  "message": "<notification-message>",
  "is_read": false,
  "delivery_status": "pending|delivered|failed",
  "delivered_at": null|ISO-8601,
  "created_at": "<ISO-8601>",
  "updated_at": "<ISO-8601>"
}
```

### Persistence Validation Points

| Test Scenario | Expected Result | Actual Result | Status |
|--------------|----------------|---------------|--------|
| AddInData Add creates record | Record stored with correct details | Not tested | BLOCKED |
| AddInData Get retrieves records | Records returned, filtered by addInId | Not tested | BLOCKED |
| AddInData Set updates record | Record updated with new details | Not tested | BLOCKED |
| Idempotency key prevents duplicates | Second create returns existing record | Not tested | BLOCKED |
| Delivery status updates | Status changes pending→delivered/failed | Not tested | BLOCKED |
| Persistence after reload | Records survive browser refresh | Not tested | BLOCKED |
| Persistence after logout/login | Records survive session change | Not tested | BLOCKED |
| No cross-user access | User A cannot see User B's notifications | Not tested | BLOCKED |

## 3. Implementation Details

### Custom-Page Add-In (Notification Creation)

- Located in: `apps/web/src/data/addinDataProvider.ts`
- Method: `createNotification()` creates AddInData record with `delivery_status: "pending"`
- Uses `api.call("Add", ...)` with callback-style API
- Duplicate prevention via `findByIdempotencyKey()` before `Add`

### Service Add-In (Delivery Status Update)

- Located in: `apps/web/src/serviceAddin.ts`
- Method: `deliverPendingNotifications()` reads pending records, delivers toasts, updates status
- Uses `service.api.call("Set", ...)` with Promise-style API
- Updates `delivery_status` to `"delivered"` or `"failed"` after native notification attempt

### Rate Limits (Official MyGeotab SDK)

| Operation | Limit | Period |
|-----------|-------|--------|
| AddInData Get | 650 | 1 minute |
| AddInData Set | 1700 | 1 minute |
| AddInData Add | 100 | 1 minute |
| Notification calls | 6 | 1 minute |
| Visible notifications | 2 | At a time |

## 3. Classification

| Item | Classification |
|------|---------------|
| AddInData Add implementation | VERIFIED IN LOCAL CODE |
| AddInData Get implementation | VERIFIED IN LOCAL CODE |
| AddInData Set implementation | VERIFIED IN LOCAL CODE |
| Idempotency key duplicate prevention | VERIFIED BY AUTOMATED TEST |
| Delivery status tracking | VERIFIED BY AUTOMATED TEST |
| Live AddInData persistence in opex_trial | BLOCKED — TENANT ACCESS REQUIRED |
| Cross-user notification isolation | REQUIRES TENANT VALIDATION |
| Persistence after reload/logout | REQUIRES TENANT VALIDATION |

## 4. Manual Test Checklist (For Administrator)

1. Register custom-page Add-In in `opex_trial`
2. Register Service Add-In in `opex_trial` (same AddInId)
3. Enter AddInId in app UI; verify ADDIN_DATA mode
4. Create a test booking; verify AddInData record created
5. Approve/reject/assign booking; verify notification records created
6. Verify notification records filtered by correct recipient_user_id
7. Reload browser; verify records persist
8. Log out and log in; verify records still accessible
9. Verify no cross-user notification access
10. Verify delivery_status transitions from pending→delivered
