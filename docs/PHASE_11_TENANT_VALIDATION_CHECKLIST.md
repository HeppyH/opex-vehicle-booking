# Phase 11 Tenant Validation Checklist – OPEX Asset Booking MyGeotab Integration

**Repository:** `C:\04. Project 2026\Geotab\Book Vehicle\opex-vehicle-booking-clone`
**Branch:** `feature/vehicle-booking-phase-2`
**Target Database:** `opex_trial` (test database only — NOT production)

## Prerequisites (Complete Before Testing)

| # | Prerequisite | Status | Notes |
|---|-------------|--------|-------|
| P1 | MyGeotab administrator access to `opex_trial` database | Pending | Required for Add-In registration |
| P2 | Replace `REPLACE_WITH_PERSONAL_SUPPORT_EMAIL` in both config files | Pending | Edit `geotab/opex-vbm-config.json` and `geotab/opex-vbm-service-config.json` |
| P3 | Deploy `service-addin.js` to public URL matching config `serviceSrc` | Pending | File built at `apps/web/dist/service-addin.js` |
| P4 | Update `vite.config.ts` base path if deployment URL differs | Pending | Current base: `/opexassetbooking/` |

## Test Checklist

### Phase A: Add-In Registration

| # | Test Step | Expected Result | Actual Result | Status |
|---|-----------|-----------------|---------------|--------|
| A1 | Register custom-page Add-In using `geotab/opex-vbm-config.json` in `opex_trial` | Add-In appears in Installed Add-Ins list; AddInId generated | Pending | BLOCKED |
| A2 | Record the generated AddInId | AddInId string captured | Pending | BLOCKED |
| A3 | Register Service Add-In using `geotab/opex-vbm-service-config.json` | Service Add-In appears in Installed Add-Ins list | Pending | BLOCKED |
| A4 | Verify both Add-Ins use the same AddInId | Same AddInId associated with both registrations | Pending | BLOCKED |
| A5 | Enable "Allow unverified Add-Ins" for both | Both Add-Ins active in MyGeotab | Pending | BLOCKED |

### Phase B: Application Configuration

| # | Test Step | Expected Result | Actual Result | Status |
|---|-----------|-----------------|---------------|--------|
| B1 | Open OPEX Vehicle Booking Add-In from MyGeotab menu | App loads inside MyGeotab iframe | Pending | BLOCKED |
| B2 | App detects MyGeotab context and switches to ADDIN_DATA mode | Footer shows "LIVE · Bookings: MyGeotab AddInData" | Pending | BLOCKED |
| B3 | Enter AddInId in the AddInId field and click Save | AddInId stored in localStorage `opex-vbm-addin-id` | Pending | BLOCKED |
| B4 | AddInId persists after browser refresh | AddInId field still populated | Pending | BLOCKED |

### Phase C: Booking Workflow + Notification Generation

| # | Test Step | Expected Result | Actual Result | Status |
|---|-----------|-----------------|---------------|--------|
| C1 | Employee (u101 John Doe) creates a new booking | Booking status = PENDING_APPROVAL; notification record created for each approver | Pending | BLOCKED |
| C2 | Approver (u104 Sarah Chen) sees booking in Approval Inbox | Booking appears with correct requester info | Pending | BLOCKED |
| C3 | Approver receives BOOKING_CREATED native toast | Native MyGeotab toast displayed with "New Vehicle Booking Request" | Pending | BLOCKED |
| C4 | Approver approves the booking | Booking status = APPROVED; notification record created for requester | Pending | BLOCKED |
| C5 | Requester receives BOOKING_APPROVED native toast | Native MyGeotab toast displayed with "Booking Approved" | Pending | BLOCKED |
| C6 | Employee creates second booking and it gets rejected | Booking status = REJECTED; notification record created for requester | Pending | BLOCKED |
| C7 | Requester receives BOOKING_REJECTED native toast | Native MyGeotab toast displayed with "Booking Rejected" + reason | Pending | BLOCKED |
| C8 | GA/Admin assigns a vehicle to an approved booking | Booking status = ASSIGNED; notification record created for requester | Pending | BLOCKED |
| C9 | Requester receives VEHICLE_ASSIGNED native toast | Native MyGeotab toast displayed with "Vehicle Assigned" | Pending | BLOCKED |

### Phase D: Notification Persistence

| # | Test Step | Expected Result | Actual Result | Status |
|---|-----------|-----------------|---------------|--------|
| D1 | Refresh browser after notifications created | Notification history preserved in Notification Center | Pending | BLOCKED |
| D2 | Log out and log back into MyGeotab | Notification history still accessible | Pending | BLOCKED |
| D3 | Open app in different browser session | Same notifications visible for same user | Pending | BLOCKED |
| D4 | Header bell unread count matches Navigation badge | Both show identical count | Pending | BLOCKED |
| D5 | Mark notification as Read in dropdown | Both badges decrement immediately | Pending | BLOCKED |
| D6 | Mark All as Read in Notification Center | Both badges show 0 | Pending | BLOCKED |

### Phase E: Duplicate Prevention

| # | Test Step | Expected Result | Actual Result | Status |
|---|-----------|-----------------|---------------|--------|
| E1 | Trigger same BOOKING_CREATED event twice (same booking + approver) | Only 1 notification record created | Pending | BLOCKED |
| E2 | BOOKING_APPROVED and BOOKING_REJECTED for same booking | 2 distinct notification records (different event types) | Pending | BLOCKED |
| E3 | Two different bookings both approved | 2 distinct notification records | Pending | BLOCKED |

### Phase F: Delivery Status Tracking

| # | Test Step | Expected Result | Actual Result | Status |
|---|-----------|-----------------|---------------|--------|
| F1 | New notification created | `delivery_status` = "pending" | Pending | BLOCKED |
| F2 | Service Add-In delivers notification | `delivery_status` changes to "delivered" | Pending | BLOCKED |
| F3 | `delivered_at` timestamp populated | Non-null ISO-8601 timestamp | Pending | BLOCKED |
| F4 | Notification delivery fails | `delivery_status` = "failed" (not silently dropped) | Pending | BLOCKED |

## Test Users (Seeded in opex_trial)

| User ID | Name | Role | Purpose |
|---------|------|------|---------|
| u101 | John Doe | EMPLOYEE | Booking requester |
| u102 | Jane Smith | EMPLOYEE | Booking requester |
| u103 | Bob Wilson | EMPLOYEE | Booking requester |
| u104 | Sarah Chen | APPROVER | Approve/reject bookings |
| u105 | Michael Ross | APPROVER | Approve/reject bookings |

## Assets (Seeded in opex_trial)

| Asset ID | Code | Registration |
|----------|------|-------------|
| dev-001 | VEH-001 | BS 1234 XY |
| dev-002 | VEH-002 | BS 5678 AB |
| dev-003 | VEH-003 | BS 9012 CD |

## Blocker Escalation

If any test in Phase A or B is BLOCKED, all subsequent phases cannot proceed. Report the exact blocker:

- **Add-In registration failed** → Verify support email is replaced; verify JSON syntax
- **App doesn't detect MyGeotab context** → Verify AddInId entered; verify running inside MyGeotab iframe
- **Native toast not displayed** → Verify Service Add-In registered; verify `service-addin.js` hosted at correct URL; verify `service.notifications.show` available

## Sign-Off

| Role | Name | Date | Status |
|------|------|------|--------|
| Developer | — | — | Pending |
| QA | — | — | Pending |
| MyGeotab Admin | — | — | Pending |
