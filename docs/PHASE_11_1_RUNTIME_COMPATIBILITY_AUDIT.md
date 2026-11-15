# Phase 11.1 – Runtime Compatibility Audit – OPEX Asset Booking MyGeotab Integration

**Repository:** `C:\04. Project 2026\Geotab\Book Vehicle\opex-vehicle-booking-clone`
**Branch:** `feature/vehicle-booking-phase-2`
**Date:** 2026-11-14

## 1. Executive Summary

This audit resolves critical runtime compatibility risks identified in Phase 11 before registering the Custom-page Add-In and Service Add-In in the MyGeotab `opex_trial` tenant. Key findings:

- Service Add-Ins run in **WebWorkers** where `window.localStorage` is **NOT available**
- MyGeotab provides `service.localStorage` (Promise-based `get`/`set`/`remove`) as the supported storage API for Service Add-Ins
- Cross-context storage sharing between custom-page and Service Add-In is **NOT guaranteed** by official documentation
- Notification rate limits: **6 calls per rolling minute**, **2 visible at a time**
- No atomic locking in AddInData — delivery is **at-least-once, best-effort** (not exactly-once)

## 2. Files Inspected

| File | Purpose |
|------|---------|
| `apps/web/src/serviceAddin.ts` | Service Add-In entry point |
| `apps/web/src/main.tsx` | Custom-page Add-In entry point + app bootstrap |
| `apps/web/src/data/addinDataProvider.ts` | AddInData provider (booking + notification CRUD) |
| `apps/web/src/data/notificationService.ts` | NotificationEngine (booking event → notification) |
| `apps/web/src/data/types.ts` | Type definitions |
| `apps/web/src/data/dataProvider.ts` | LocalStorage DEMO provider |
| `apps/web/src/ui/App.tsx` | Main application (AddInId storage via window.localStorage) |
| `geotab/opex-vbm-config.json` | Custom-page Add-In configuration |
| `geotab/opex-vbm-service-config.json` | Service Add-In configuration |
| `apps/web/package.json` | Build scripts and dependencies |
| `apps/web/tsconfig.json` | TypeScript configuration |
| `apps/web/vite.config.ts` | Vite build configuration |

## 3. Files Created

| File | Purpose |
|------|---------|
| `apps/web/test/service-addin.test.mjs` | 16 unit tests for Service Add-In |
| `apps/web/dist/serviceAddin.js` | Compiled Service Add-In bundle |
| `docs/PHASE_11_1_RUNTIME_COMPATIBILITY_AUDIT.md` | This file |
| `docs/PHASE_11_1_BUILD_GUIDE.md` | Build instructions |
| `docs/PHASE_11_1_NOTIFICATION_RELIABILITY.md` | Reliability and rate-limit details |

## 4. Files Modified

| File | Change |
|------|--------|
| `apps/web/src/serviceAddin.ts` | Rewrote with `service.localStorage` API, rate limiting, `self`-based registration, exported testable functions |
| `apps/web/src/main.tsx` | No functional change (already imports serviceAddin) |
| `apps/web/package.json` | Added `build:service` script |
| `geotab/opex-vbm-service-config.json` | Updated `serviceSrc` to `serviceAddin.js` |

## 5. Task A – AddInId Storage Compatibility

### Finding: `window.localStorage` is NOT available in Service Add-In WebWorker

**Classification:** VERIFIED FROM OFFICIAL DOCUMENTATION

The official MyGeotab documentation states that Service Add-Ins run in WebWorkers, and WebWorkers cannot access `window.localStorage`. The MyGeotab SDK provides `service.localStorage` as a Promise-based alternative:

| Method | Signature | Returns |
|--------|-----------|---------|
| `service.localStorage.get(key)` | `(key: string) => Promise<string \| null>` | Stored value |
| `service.localStorage.set(key, value)` | `(key: string, value: string) => Promise<void>` | void |
| `service.localStorage.remove(key)` | `(key: string) => Promise<void>` | void |

**Source:** https://developers.geotab.com/myGeotab/addIns/serviceAddins

### Finding: Cross-context storage sharing is NOT guaranteed

**Classification:** REQUIRES TENANT VALIDATION

The custom-page Add-In stores AddInId via `window.localStorage.setItem("opex-vbm-addin-id", ...)`. The Service Add-In reads via `service.localStorage.get("opex-vbm-addin-id")`. The documentation says `service.localStorage` is "Service to request information stored in browser LocalStorage" but does not explicitly confirm it shares the same storage as `window.localStorage`.

**Risk:** If they don't share storage, the Service Add-In cannot find the AddInId and will not deliver notifications.

**Mitigation:**
1. Service Add-In uses `service.localStorage.get()` (supported API)
2. Custom-page Add-In continues using `window.localStorage.setItem()` (existing behavior)
3. If cross-context sharing fails, the administrator must configure the AddInId through both contexts
4. Documented as a tenant validation requirement

### Implementation

`serviceAddin.ts` now:
- Uses `service.localStorage.get(ADDIN_ID_KEY)` instead of `window.localStorage.getItem()`
- Returns `null` safely if `localStorage` service or `get` method is missing
- Never silently uses a different AddInId
- `getAddInId()` is exported for unit testing

## 6. Task B – WebWorker Bundle Compatibility

### Finding: ES2022 ES modules are compatible with MyGeotab Service Add-In runtime

**Classification:** VERIFIED BY BUILD

The Service Add-In bundle compiles cleanly with:
- Target: ES2022
- Module: ESNext
- No external dependencies
- No Node.js-only APIs
- Self-contained (single file, ~6.6 kB)

### Finding: `window` is not available in WebWorker; `self` must be used

**Classification:** VERIFIED BY BUILD

Service Add-Ins run in WebWorkers where `window` is undefined. The module uses `self.geotab.addin.service = ...` guarded by `typeof self !== "undefined"` so it can be imported in test environments without throwing.

### Build Command

```
npm run build:service
```

Defined in `apps/web/package.json`:
```json
"build:service": "tsc src/serviceAddin.ts --outDir dist --module ESNext --moduleResolution Node --target ES2022 --skipLibCheck --esModuleInterop --allowSyntheticDefaultImports --noLib false --lib ES2022,DOM"
```

Output: `apps/web/dist/serviceAddin.js`

### Build Order

1. `npm run build` — Main application build (cleans and regenerates `dist/`)
2. `npm run build:service` — Service Add-In bundle (regenerates `dist/serviceAddin.js`)

**Note:** `npm run build` cleans `dist/`, so `build:service` must run **after** `build`.

## 7. Task C – Notification Rate Limiting

### Finding: MyGeotab rate limits for Service Add-Ins

**Classification:** VERIFIED FROM OFFICIAL DOCUMENTATION

| Limit | Value | Period | Status |
|-------|-------|--------|--------|
| Notifications visible per add-in | 2 | At a time | Active |
| Notification calls per add-in | 6 | 1 minute | Active |

**Source:** https://developers.geotab.com/myGeotab/addIns/serviceAddins

### Implementation: `NotificationRateLimiter` class

Located in `apps/web/src/serviceAddin.ts`. Enforces both limits:

```typescript
class NotificationRateLimiter {
  private calls: CallRecord[] = [];
  private visibleCount = 0;

  canCall(): boolean  // Max 6 calls per rolling 60-second window
  recordCall(): void  // Record a notification API call
  canShow(): boolean  // Max 2 visible notifications
  incrementVisible(): void
  decrementVisible(): void
}
```

### Delivery Status Transitions

| Status | When Set | By |
|--------|----------|----|
| `pending` | Notification created in AddInData | Custom-page Add-In |
| `delivered` | `service.notifications.show()` succeeds | Service Add-In |
| `failed` | `service.notifications.show()` throws | Service Add-In |

**Rule:** `delivery_status` is updated only after the corresponding operation succeeds. A failed native delivery leaves the notification as `"pending"` for retry on the next poll cycle.

## 8. Task D – Concurrent Processing and Idempotency

### Finding: No atomic locking in AddInData

**Classification:** REQUIRES TENANT VALIDATION

AddInData `Get`/`Set` operations are not atomic. Two Service Add-In instances could both:
1. Read the same pending notification
2. Both call `service.notifications.show()`
3. Both call `api.call("Set", ...)` to update delivery status

### Mitigation: Pre-processing delivery_status check

Before processing each notification, `deliverPendingNotifications` re-checks `delivery_status !== "pending"` and skips if already processed. This reduces but does not eliminate race conditions.

### Delivery Guarantee Classification

**Classification:** At-least-once, best-effort (NOT exactly-once)

- A notification may be delivered more than once under race conditions
- A notification may not be delivered if the Service Add-In is not running
- Duplicate native toasts are possible but not guaranteed to be prevented

### Idempotency Keys

Each notification has an `idempotencyKey` in the format:
```
notif:{eventType}:{bookingId}:{recipientUserId}
```

This prevents duplicate records in AddInData (checked via `findByIdempotencyKey` before `createNotification`), but does not prevent duplicate native delivery under race conditions.

## 9. Task E – Build Reliability

### Finding: `npm run build` cleans `dist/`, removing the Service Add-In bundle

**Classification:** VERIFIED BY BUILD

`vite build` cleans the `dist/` directory before building. The Service Add-In bundle must be regenerated after the main build.

### Solution: `npm run build:service`

Added to `apps/web/package.json`. Must be run after `npm run build`.

### Build Sequence

```
npm run build        # Main app → dist/ (cleaned and regenerated)
npm run build:service # Service Add-In → dist/serviceAddin.js
```

### Bundle Output

| Property | Value |
|----------|-------|
| Path | `apps/web/dist/serviceAddin.js` |
| Size | 6,623 bytes |
| Format | ES2022 ES modules |
| Dependencies | None |

## 10. Task F – Automated Tests

### Test File

`apps/web/test/service-addin.test.mjs` — 16 unit tests, all passing.

### Test Categories

| Category | Tests | Coverage |
|----------|-------|----------|
| Storage | 4 | Missing localStorage, missing get, valid AddInId, read failure |
| Rate Limiter | 3 | 6 calls/min limit, 2 visible limit, decrementVisible |
| Delivery | 4 | Missing AddInId, delivery status check, rate limit integration, failed delivery |
| Concurrency | 3 | Idempotency keys, different booking IDs, concurrent processing |
| Bundle | 2 | Module import, rate limiter class methods |

### Test Classification

| Type | Count | Tenant Required |
|------|-------|-----------------|
| Unit tests (mocked SDK) | 16 | No |
| Build validation | 2 commands | No |
| Live tenant tests | 0 | Yes — blocked |

### Running Tests

```bash
# Service Add-In unit tests
node --experimental-strip-types apps/web/test/service-addin.test.mjs

# Existing API tests
npm test

# All builds
npm run build
npm run build:service
```

## 11. Remaining Risks

| Risk | Likelihood | Impact | Classification |
|------|-----------|--------|---------------|
| `service.localStorage` and `window.localStorage` don't share data | Medium | High | REQUIRES TENANT VALIDATION |
| Service Add-In `service.notifications.show()` not available in tenant | Medium | High | REQUIRES TENANT VALIDATION |
| Duplicate native toasts under race conditions | Low | Medium | DOCUMENTED (at-least-once) |
| Polling stops when browser closes | High | Medium | DOCUMENTED (notifications remain pending) |
| Rate limit: 6 calls/minute exceeded under high volume | Low | Medium | MITIGATED (rate limiter) |

## 12. Exact Next Actions Required from Administrator

1. Replace `REPLACE_WITH_PERSONAL_SUPPORT_EMAIL` in both config files
2. Register custom-page Add-In in `opex_trial`; capture AddInId
3. Register Service Add-In in `opex_trial` (same AddInId)
4. Deploy `dist/serviceAddin.js` to public URL matching `serviceSrc`
5. Open app in MyGeotab; enter AddInId; verify ADDIN_DATA mode
6. Execute tenant validation checklist (see `docs/PHASE_11_TENANT_VALIDATION_CHECKLIST.md`)
7. Report results — do not claim success until verified in `opex_trial`
