# Phase 3 POC Test Checklist — MyGeotab AddInData Booking Storage

**Repository:** `opex-vehicle-booking`  
**Target database:** `opex_trial`  
**Branch:** `feature/vehicle-booking-phase-2` (uncommitted)  
**Storage:** MyGeotab AddInData only (no PostgreSQL, no Cloudflare, no localStorage permanent storage)  
**UI:** Phase 3.1 simplified 6-menu navigation (Dashboard, New Booking, My Bookings, Approval Inbox, Asset Availability, Booking Reports)  
**Mode:** Phase 3.5 — DEMO (standalone) vs LIVE / ADDIN_DATA (inside MyGeotab) toggle

## Prerequisites (manual, not automated)

- [ ] MyGeotab Add-In registered in database `opex_trial`
- [ ] AddInId obtained from MyGeotab registration
- [ ] Add-In loaded in MyGeotab (custom page pointing to `https://heppyh.github.io/opex-vehicle-booking/`)

## Phase 3.5 — DEMO / LIVE Mode

### Mode toggle (topbar)

| Step | Action | Expected Result |
|------|--------|-----------------|
| M.1 | Open app in standalone browser (no MyGeotab Add-In) | Default mode is DEMO; "LIVE (MyGeotab AddInData)" option is disabled with "API not available" hint |
| M.2 | Enter AddInId in standalone browser | AddInId saved to localStorage; mode stays DEMO until inside MyGeotab |
| M.3 | Open app inside registered MyGeotab Add-In | `getSession` called; current MyGeotab user shown in topbar; if AddInId configured, mode auto-activates to LIVE (ADDIN_DATA) |
| M.4 | Switch mode DEMO → LIVE inside MyGeotab without AddInId | Error shown: Add-In Id not configured; no silent fallback to DEMO |
| M.5 | Switch mode LIVE → DEMO | App uses localStorage demo data; no data loss from AddInData (separate storage) |
| M.6 | Clear AddInId while in LIVE mode | Mode reverts to DEMO; success toast shown |

### AddInId validation

| Step | Action | Expected Result |
|------|--------|-----------------|
| V.1 | Enter invalid/unknown AddInId | Stored in localStorage; write operations fail at runtime with `ADDIN_ID_NOT_CONFIGURED` or `GEOTAB_API_ERROR` |
| V.2 | Enter valid AddInId inside MyGeotab | Add and Set operations succeed; bookings stored under that AddInId |
| V.3 | AddInId persists across page reloads | Value read from `localStorage` key `opex-vbm-addin-id` |

### No silent fallback

| Step | Action | Expected Result |
|------|--------|-----------------|
| S.1 | MyGeotab initialization fails inside Add-In | Error banner shown; app stays in DEMO mode (not silently switched) |
| S.2 | AddInData `createBooking` fails (API error) | Error toast shown; booking not created; no silent retry |
| S.3 | AddInData `updateBookingStatus` fails | Error toast shown; status unchanged |
| S.4 | geotabApi is null and mode is ADDIN_DATA | Provider falls back to DEMO only as last resort for standalone preview; error banner explains why |

## Test Checklist

### Navigation (all pages)

| Step | Action | Expected Result |
|------|--------|-----------------|
| N.1 | Open app in standalone browser | Sidebar shows 6 flat menu items only; no Administration section |
| N.2 | Click each nav item | Each page loads: Dashboard, New Booking, My Bookings, Approval Inbox, Asset Availability, Booking Reports |
| N.3 | Topbar "Demo Employee" dropdown | Selecting an employee updates the user badge and filters My Bookings (DEMO mode only) |
| N.4 | Topbar mode toggle | Switching DEMO ↔ LIVE works; LIVE disabled without geotabApi |
| N.5 | Resize to mobile (<=768px) | Sidebar collapses; hamburger toggle appears; nav still works |

### Current user identity (from MyGeotab session)

| Step | Action | Expected Result |
|------|--------|-----------------|
| U.1 | Open inside MyGeotab Add-In | Topbar shows authenticated user name, database, and server from `getSession` |
| U.2 | `getSession` returns null | No user badge shown; mode cannot auto-activate to LIVE |
| U.3 | ADDIN_DATA mode active | Current user is used as requester for new bookings (via `demoEmployee` matched from session user name) |

### 1. Dashboard

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1.1 | Open Dashboard | 4 KPI cards show: Total Assets, Available Assets, Pending Approval, Active Bookings |
| 1.2 | Click "Load Data" | Bookings refreshed; toast shows source (AddInData or local storage) |
| 1.3 | Click "Create New Booking" | Navigates to New Booking page |
| 1.4 | Click "Export CSV" | CSV download of all bookings starts |
| 1.5 | Recent Bookings table | Shows up to 5 most recent bookings with status badges |

### 2. New Booking

| Step | Action | Expected Result |
|------|--------|-----------------|
| 2.1 | Open New Booking without selecting employee | Error notice: no demo employee selected |
| 2.2 | Select employee, fill all fields, submit | Confirmation dialog appears |
| 2.3 | Confirm booking | Booking created as PENDING_APPROVAL; navigates to My Bookings; toast success |
| 2.4 | End time before start time | Error: "End time must be after start time." |
| 2.5 | Missing required fields | Error: "Please fill in all required fields." |
| 2.6 | Overlapping time on same asset | Conflict error shown; booking blocked |
| 2.7 | Non-overlapping time on same asset | Booking created successfully |

### 3. My Bookings

| Step | Action | Expected Result |
|------|--------|-----------------|
| 3.1 | Open My Bookings without employee | Notice: select a demo employee |
| 3.2 | Select employee, switch tabs | Upcoming / Past / All tabs filter correctly |
| 3.3 | Click "View" on a booking | View Details modal opens |
| 3.4 | Click "Cancel" on PENDING_APPROVAL/APPROVED/ASSIGNED | Confirm dialog; on confirm → CANCELLED |
| 3.5 | Click "Cancel" on COMPLETED/REJECTED/CANCELLED | Cancel button not available |
| 3.6 | Click "Export CSV" | CSV download of my bookings starts |

### 4. Approval Inbox

| Step | Action | Expected Result |
|------|--------|-----------------|
| 4.1 | Open Approval Inbox | PENDING_APPROVAL bookings listed; count badge shown |
| 4.2 | Click "Approve" on a booking | Status → APPROVED; removed from inbox |
| 4.3 | Click "Reject" on a booking | Rejection reason textarea appears |
| 4.4 | Enter reason, click "Confirm Reject" | Status → REJECTED; `approvalRemarks` stored |
| 4.5 | Reject without reason, click "Confirm Reject" | Error toast: "Please provide a rejection reason." |
| 4.6 | Click "Export CSV" | CSV download of pending approvals starts |
| 4.7 | No pending bookings | Empty state shown |

### 5. Asset Availability

| Step | Action | Expected Result |
|------|--------|-----------------|
| 5.1 | Open Asset Availability | 4 KPI cards: Total Fleet, Available, Maintenance, Out of Service |
| 5.2 | Asset Register table | All assets listed with license plate, type, device ID, availability badge, current booking |
| 5.3 | Click "Export CSV" | CSV download of fleet starts |

### 6. Booking Reports

| Step | Action | Expected Result |
|------|--------|-----------------|
| 6.1 | Open Booking Reports | 4 stat cards: Total Bookings, Asset Utilization, Most Booked Asset, Status Summary |
| 6.2 | Status Summary cards | Breakdown of bookings by status |
| 6.3 | Most Booked Assets | Top 5 assets with progress bars |
| 6.4 | Click "Export CSV" | CSV download of dashboard bookings starts |

### 7. View Details Modal

| Step | Action | Expected Result |
|------|--------|-----------------|
| 7.1 | Open modal on PENDING_APPROVAL booking | Approve / Reject / Cancel Booking buttons shown |
| 7.2 | Click Approve | Status → APPROVED; toast success |
| 7.3 | Click Reject | Rejection reason field appears |
| 7.4 | On APPROVED booking | Assign Asset button shown |
| 7.5 | On ASSIGNED booking | Complete Booking button shown |

### 8. Concurrent booking conflict test

| Step | Action | Expected Result |
|------|--------|-----------------|
| 8.1 | Session A: Create booking for Asset X, 08:00–10:00 | Booking created (PENDING_APPROVAL) |
| 8.2 | Session B: Create booking for Asset X, 09:00–11:00 (overlapping) | Conflict error shown; booking blocked |
| 8.3 | Session B: Create booking for Asset X, 11:00–13:00 (non-overlapping) | Booking created successfully |
| 8.4 | Document simultaneous create from two sessions | **Not guaranteed** — AddInData has no atomic locking |

## Cross-user data visibility

- AddInData records are scoped by `addInId`. All users of the same registered MyGeotab Add-In see all bookings stored under that AddInId — there is no per-user data isolation at the storage layer.
- Requester filtering is done client-side (`My Bookings` filters by `requester_id`). Any user with access to the Add-In can view all bookings via `getBookings()`.
- Approver identity (`approverId`) and remarks (`approvalRemarks`) are stored with each booking but are not enforced by MyGeotab permissions.

## Known Concurrency Limitations (documented)

1. **No atomic locking**: AddInData `Add`/`Set`/`Remove` are individual API calls. Between a conflict check (read) and a create (write), another session can create a conflicting booking. Double-booking is **not guaranteed prevented** for simultaneous users.
2. **No unique constraints**: AddInData does not enforce uniqueness on asset + time range. Conflict detection is best-effort client-side only.
3. **No transactions**: Multi-step operations are not atomic. A failure mid-way can leave partial state.
4. **10,000-char `details` limit**: Each booking's JSON must stay under 10,000 characters. Large payloads will fail with `ADDIN_DATA_DETAILS_EXCEEDED`.
5. **No server-side conflict resolution**: Last-write-wins on `Set` operations.

## Live Integration Verification Status

**NOT VERIFIED** — The following cannot be verified without testing inside a registered MyGeotab Add-In in database `opex_trial`:

- AddInData `Add`/`Set`/`Remove` against the real MyGeotab server
- `getSession` returning the authenticated user's identity
- Auto-activation of LIVE mode when the Add-In loads
- Cross-user data visibility in a multi-user MyGeotab environment
- Concurrent booking conflicts under real load

Do not claim live integration is verified unless tested inside MyGeotab.
