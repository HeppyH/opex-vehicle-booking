# Phase 12 – Tenant Registration

**Repository:** `C:\04. Project 2026\Geotab\Book Vehicle\opex-vehicle-booking-clone`
**Branch:** `feature/vehicle-booking-phase-2`
**Target Tenant:** `opex_trial` (test database only)
**Status:** BLOCKED — Administrator access to `opex_trial` not available in this environment

## 1. Prerequisites (Not Met)

| Prerequisite | Status | Notes |
|-------------|--------|-------|
| Administrator access to `opex_trial` MyGeotab database | NOT AVAILABLE | Required for Add-In registration |
| Real support email (replacing placeholder) | NOT CONFIGURED | Must edit both config files |
| Publicly hosted `serviceAddin.js` bundle | NOT DEPLOYED | Bundle built locally at `apps/web/dist/serviceAddin.js` |
| AddInId from registration | NOT OBTAINED | Generated during Add-In registration |

## 2. Manual Registration Steps (To Be Executed by Administrator)

### Step 1: Replace Support Email Placeholders

**File:** `geotab/opex-vbm-config.json`
```json
"supportEmail": "REPLACE_WITH_PERSONAL_SUPPORT_EMAIL"
```
→ Replace with a real support email address.

**File:** `geotab/opex-vbm-service-config.json`
```json
"supportEmail": "REPLACE_WITH_PERSONAL_SUPPORT_EMAIL"
```
→ Replace with a real support email address.

### Step 2: Host the Service Add-In Bundle

The compiled bundle is at:
- **Local path:** `apps/web/dist/serviceAddin.js` (6,623 bytes)
- **Required URL:** `https://heppyh.github.io/opexassetbooking/serviceAddin.js` (as specified in `geotab/opex-vbm-service-config.json`)

**Action:** Deploy `serviceAddin.js` to a publicly accessible HTTPS URL matching the `serviceSrc` field in the service config.

### Step 3: Register Custom-Page Add-In

1. Open MyGeotab `opex_trial` database
2. Navigate to System Settings → Add-Ins
3. Click "New Add-In"
4. Upload `geotab/opex-vbm-config.json`
5. Replace support email placeholder in the form
6. Save the registration
7. **Record the generated AddInId** (required for next steps)

### Step 4: Register Service Add-In

1. Verify hosted bundle URL is accessible
2. Navigate to System Settings → Add-Ins
3. Click "New Add-In"
4. Upload `geotab/opex-vbm-service-config.json`
5. Replace support email placeholder
6. Use the **same AddInId** as the custom-page Add-In
7. Save the registration
8. Confirm MyGeotab accepts the registration

### Step 5: Configure the Application

1. Open OPEX Vehicle Booking Add-In from MyGeotab menu
2. Enter the AddInId in the AddInId field
3. Click Save
4. Verify the app switches to ADDIN_DATA mode (footer shows "LIVE · Bookings: MyGeotab AddInData")

## 3. Registration Readiness Checklist

| Item | Status |
|------|--------|
| Custom-page config JSON valid | Ready |
| Service config JSON valid | Ready |
| Support email replaced | NOT DONE |
| Bundle hosted at public URL | NOT DONE |
| AddInId obtained | NOT DONE |
| Both Add-Ins registered | NOT DONE |
| AddInId configured in app | NOT DONE |

## 4. Classification

| Item | Classification |
|------|---------------|
| Pre-registration audit | VERIFIED IN LOCAL CODE |
| Build preparation | VERIFIED BY BUILD |
| Custom-page registration | BLOCKED — ADMINISTRATOR ACTION REQUIRED |
| Service Add-In registration | BLOCKED — ADMINISTRATOR ACTION REQUIRED |
| AddInId configuration | BLOCKED — ADMINISTRATOR ACTION REQUIRED |
| Cross-context storage sharing | REQUIRES TENANT VALIDATION |

## 5. Handoff to Administrator

The following items require administrator action in the `opex_trial` tenant:

1. Replace `REPLACE_WITH_PERSONAL_SUPPORT_EMAIL` in both `geotab/opex-vbm-config.json` and `geotab/opex-vbm-service-config.json`
2. Host `apps/web/dist/serviceAddin.js` at a publicly accessible HTTPS URL
3. Register both Add-Ins through MyGeotab System Settings > Add-Ins
4. Record and communicate the generated AddInId
5. Verify the app activates in ADDIN_DATA mode when opened in MyGeotab
