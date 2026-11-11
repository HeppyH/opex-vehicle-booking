# MyGeotab tenant validation — opex_trial

## Tenant selection

This implementation request explicitly selects `opex_trial`. Confirm the browser is connected to this tenant before registering. The Worker variable `GEOTAB_DATABASE` is a label only; it does not connect or authenticate to MyGeotab by itself.

## Checklist

- [ ] Confirm the browser URL is `https://my.geotab.com/opex_trial/` and the tenant owner approves this target.
- [ ] Confirm this is a test/pilot database or obtain production change approval.
- [ ] Confirm Add-In administration permission and view-security clearance behavior.
- [ ] Validate Add-In JSON schema and `path` value with current tenant release.
- [ ] Create least-privilege MyGeotab API identity; do not use a human admin password in Worker secrets.
- [ ] Test Device reads for the eight actual vehicles.
- [ ] Test User reads and establish stable user mapping.
- [ ] Test Trip and LogRecord/location reads with bounded dates and device filters.
- [ ] Record unavailable entities/fields per device; design UI fallback.
- [ ] Confirm data access is constrained to approved device/user groups.
- [ ] Confirm employee location privacy and retention policy with HR/legal.
- [ ] Record API rate/latency behavior and retry/backoff limits.

## Proof-of-concept evidence

For each API test, record: date, tenant, authenticated API identity, method/entity, search/filter, sample fields (redacted), response time, result count, clearance, and pass/fail. Do not place passwords or session tokens in this document.
