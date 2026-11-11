# Phase 1 review — OPEX Vehicle Booking Add-In

## Target

- MyGeotab database: `opex_trial`
- Tenant URL: `https://my.geotab.com/opex_trial/`
- Add-In frontend URL: `https://heppyh.github.io/opex-vehicle-booking/`
- Frontend: GitHub Pages
- API: Cloudflare Workers
- Database: PostgreSQL via Cloudflare Hyperdrive

## Changes made in this review

1. Replaced stale `sasa_inti` tenant references with `opex_trial` in the frontend label, Worker variables, environment example, README, deployment guide and tenant checklist.
2. Updated the frontend lifecycle registration to create the `geotab.addin.opexVehicleBooking` namespace and implement `initialize`, `focus`, and `blur`.
3. Added a lifecycle event bridge so the React app can react to host initialization/focus/blur events.
4. Kept standalone browser preview supported.
5. Removed the production fallback to `http://127.0.0.1:8787`; when no API URL is configured, the shell loads without attempting a localhost API request.
6. Added `VITE_GEOTAB_DATABASE=opex_trial` and `VITE_API_BASE_URL` examples.
7. Added `category: AddIns` to the Add-In menu item for the redesigned navigation menu while retaining `path: ActivityLink` for the classic menu placement.
8. Fixed the test command to use Node's native TypeScript stripping on Node 22.6+.

## Validation performed

- ZIP extraction: passed; 31 original project files were present.
- Add-In configuration JSON parse: passed.
- Root package JSON parse: passed.
- `npm test`: passed, 3 tests / 3 passed.
- Stale `sasa_inti` references: none remain in the reviewed source tree.

## Not yet verified / deployment blockers

- `npm install` did not complete within the available execution window; dependencies were not installed.
- Frontend production build and Worker TypeScript check were therefore not run.
- No Cloudflare account credentials or deployment authorization were supplied; nothing was deployed.
- DNS, HTTPS certificate, Pages project, Worker custom domain and Hyperdrive binding have not been verified.
- MyGeotab tenant registration and in-tenant rendering have not been tested. This requires an administrator to register the Add-In in `opex_trial` after the frontend is deployed.
- The API authentication adapter intentionally fails closed and is not implemented. Protected routes remain unavailable.
- MyGeotab API adapter is still a scaffold; no live Device/User/Trip/LogRecord calls have been tested.
- Booking UI, approvals, assignment and notifications are not implemented in this Phase 1 scope.

## Important hosting note

The externally hosted Add-In URL must be publicly reachable over HTTPS and must comply with Geotab's Add-In URL requirements. The proposed host `heppyh.github.io` contains no prohibited dash, `@`, or `#` characters. The final deployed HTML must load the JavaScript bundle that registers `geotab.addin.opexVehicleBooking`.

## Registration checklist

1. Deploy the frontend to `https://heppyh.github.io/opex-vehicle-booking/`.
2. Confirm the URL loads over HTTPS in a normal browser.
3. Sign in to `https://my.geotab.com/opex_trial/` with Add-In administration permission.
4. Open System → Settings → Add-Ins and add the JSON from `geotab/opex-vbm-config.json`.
5. Review the tenant's unverified Add-In policy; enable unverified Add-Ins only if permitted by the tenant administrator/security policy.
6. Save, refresh MyGeotab, and open **OPEX Vehicle Booking**.
7. Confirm the page renders, then inspect DevTools Console and Network for errors.

## Official references

- https://developers.geotab.com/myGeotab/addIns/developingAddIns/
- https://support.geotab.com/en-GB/software-integration/doc/tech-toolkit
