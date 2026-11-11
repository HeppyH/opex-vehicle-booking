# Deployment guide — Cloudflare + PostgreSQL + MyGeotab

## 0. Confirm tenant and domain

This implementation targets MyGeotab database `opex_trial`. Verify the tenant and administrator context before registration. Proposed Add-In URL: `https://vbm.opexcg.com/`.

The domain must be owned/controlled by OPEX and its DNS must be editable. The sample JSON is not live until the app is deployed and the domain resolves to the correct Pages project.

## 1. Provision PostgreSQL

Use a managed PostgreSQL service approved by OPEX/IT. Create a dedicated database and application role with only the privileges needed by VBM. Enable TLS, backups and point-in-time recovery where available.

Apply migrations from the project root:
```bash
export DATABASE_URL='postgres://...'
npm install
npm run db:migrate
```
Never commit DATABASE_URL. For production, use Cloudflare Hyperdrive to connect the Worker to PostgreSQL. Hyperdrive is not the database itself; it provides a managed connection path/pooling configuration.

## 2. Deploy frontend to Cloudflare Pages

1. Push this repository to an approved Git provider.
2. In Cloudflare dashboard, create a Pages project from the repository.
3. Set root directory to `apps/web` only if deploying frontend as an independent project; because this is an npm workspace, configure the build root/repository root appropriately.
4. Build command: `npm install && npm --workspace apps/web run build`.
5. Build output directory: `apps/web/dist`.
6. Add custom domain `vbm.opexcg.com` and complete DNS validation.
7. Set `VITE_API_BASE_URL` to the deployed API origin (for example `https://api-vbm.opexcg.com`).
8. Redeploy after environment variable changes.

## 3. Deploy API Worker

1. Install dependencies from repository root.
2. Configure `apps/api/wrangler.toml` with a Hyperdrive binding named `DB` and the actual Hyperdrive config ID. Do not put database credentials in wrangler.toml.
3. Set Worker variables/secrets using Cloudflare dashboard or Wrangler secrets:
   - `APP_ENV=production`
   - `ALLOWED_ORIGIN=https://vbm.opexcg.com`
   - `GEOTAB_DATABASE=opex_trial`
   - `IDENTITY_ADAPTER_CONFIGURED=false` until verified identity code is implemented.
4. Deploy:
   ```bash
   cd apps/api
   npx wrangler deploy
   ```
5. Verify `GET https://<worker-host>/api/health`.
6. Configure the API custom domain/route (recommended `api-vbm.opexcg.com`) and update the Pages environment variable.
7. Do not set identity flag true until the real adapter is implemented, tested and reviewed. The included adapter intentionally returns no principal and protected routes stay disabled.

## 4. MyGeotab Add-In registration

1. Sign in to the confirmed tenant `opex_trial` using an account with permission to administer Add-Ins and change System Settings.
2. Open System Settings → Add-Ins → Add-In.
3. Paste the JSON from `geotab/opex-vbm-config.json` into Configuration.
4. Ensure the `url` is exactly the deployed HTTPS URL `https://vbm.opexcg.com/`.
5. Save/Done and then save System Settings.
6. Review verification status and tenant security prompts. An unverified Add-In must be reviewed/approved under company policy; do not bypass security warnings.
7. Refresh MyGeotab and verify the menu entry `OPEX Vehicle Booking`.
8. If menu placement is not correct, validate supported `path`/category options for the current MyGeotab version; do not guess undocumented values.
9. Assign the required Add-In view clearance to pilot users if the tenant requires it.

## 5. Production security gates

- Verified server-side identity and role lookup implemented; no client-supplied role/user ID trust.
- Least-privilege Geotab API identity configured and tested.
- Database credentials stored in Hyperdrive/secret manager, rotated and never logged.
- CORS exact allowlist; CSP and other security headers reviewed.
- RBAC and record-level authorization tests pass.
- PostgreSQL backups and restore test completed.
- Monitoring, alerts, incident contact and retention policy approved.
- Concurrency tests prove no double booking.
- HR/legal approves location visibility and retention.

## 6. Rollback

1. Remove/disable Add-In from the tenant or revert its URL to the last known-good version.
2. Keep database intact unless an approved rollback migration is required.
3. Roll back Worker/Pages to previous deployment version.
4. Reconcile any bookings created during partial outage from the audit table and controlled manual register.
5. Record incident timeline and notify GA/management.
