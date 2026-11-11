# GitHub Pages deployment (Phase 1.3)

**Repository:** https://github.com/HeppyH/opex-vehicle-booking  
**Branch:** `main`  
**Target tenant:** `opex_trial`  
**Target URL:** https://HeppyH.github.io/opex-vehicle-booking/  
**Hosting:** GitHub Pages (static only)

GitHub Pages serves the frontend only. Cloudflare Workers and PostgreSQL are **not** run on GitHub Pages; backend integration remains ready for a future Cloudflare Workers deployment via `VITE_API_BASE_URL`.

## Build configuration

- Vite base path: `/opex-vehicle-booking/` (`apps/web/vite.config.ts`)
- Build command: `npm install && npm --workspace apps/web run build`
- Output: `apps/web/dist`
- SPA fallback: workflow copies `dist/index.html` to `dist/404.html` for GitHub Pages
- No backend credentials or secrets are stored in frontend code. API URL is an optional build-time env var (`VITE_API_BASE_URL`); when unset/unavailable the UI shows a clear "Backend not connected" status and does not fabricate booking or vehicle data.

## GitHub Actions workflow

Workflow: `.github/workflows/deploy-pages.yml`

On push to `main` (or manual dispatch) it:
1. Checks out code
2. Sets up Node.js 22 with npm cache
3. Installs dependencies (`npm install`)
4. Runs tests (`npm test`)
5. Builds `apps/web` (`npm --workspace apps/web run build`) with `VITE_GEOTAB_DATABASE=opex_trial`
6. Creates SPA fallback (`404.html`)
7. Uploads `apps/web/dist` as a Pages artifact
8. Deploys to GitHub Pages

## Exact GitHub Pages activation instructions

Perform these steps in the GitHub repository (requires admin/maintainer permissions). **Do not deploy without approval.**

1. **Push/merge to `main`**  
   Ensure the Phase 1.3 changes (including `.github/workflows/deploy-pages.yml`, Vite base config, and docs) are on the `main` branch of `https://github.com/HeppyH/opex-vehicle-booking`.

2. **Enable GitHub Pages with Actions as the source**
   - Go to: `https://github.com/HeppyH/opex-vehicle-booking/settings/pages`
   - Under **Build and deployment → Source**, select **GitHub Actions**.
   - Save if prompted. (No branch/folder selection is needed when using Actions.)

3. **Allow Actions to deploy Pages (if required by org/repo policy)**
   - Go to: `https://github.com/HeppyH/opex-vehicle-booking/settings/actions`
   - Ensure Actions are enabled and workflow permissions allow the Pages deployment (the workflow requests `pages: write` and `id-token: write`).
   - If your organization restricts Pages deployments, approve/allow GitHub Actions deployments in org/repo policies as applicable.

4. **Run the workflow**
   - Go to: `https://github.com/HeppyH/opex-vehicle-booking/actions/workflows/deploy-pages.yml`
   - Click **Run workflow** → select branch `main` → **Run workflow** (or push a commit to `main` to trigger automatically).
   - Wait for the **build** and **deploy** jobs to complete successfully.

5. **Verify the site**
   - Open: https://HeppyH.github.io/opex-vehicle-booking/
   - Confirm assets load (no 404s in browser console), the UI renders, and the status shows **Backend not connected** when no API is configured.
   - If you later deploy a Cloudflare Worker API, set `VITE_API_BASE_URL` as a repository/environment variable or rebuild with it configured (do not store credentials in frontend code).

6. **MyGeotab Add-In (when ready)**
   - `geotab/opex-vbm-config.json` is configured with the GitHub Pages URL for this phase.
   - Validate the Add-In JSON schema/path and security prompts in the target tenant (`opex_trial`) before registration. See `docs/TENANT-VALIDATION.md`.

## Local verification

```bash
npm install
npm test
npm --workspace apps/web run build
```

Confirm built assets in `apps/web/dist` reference `/opex-vehicle-booking/` (e.g. `/opex-vehicle-booking/assets/...`). You can preview locally with:
```bash
npm --workspace apps/web run preview
```
(Note: preview serves from the configured base path.)

## Backend integration readiness

- Frontend reads `VITE_API_BASE_URL` for future Cloudflare Workers API calls.
- Protected flows remain fail-closed; no fake booking/vehicle data is generated.
- Deploy Cloudflare Worker + PostgreSQL separately per `docs/DEPLOYMENT.md` when ready; then configure `VITE_API_BASE_URL` and redeploy Pages.

## Phase 2.4 — API URL for personal testing

`VITE_API_BASE_URL` is read in CI from the GitHub Actions **variable** of the same name (a public, non-secret value). Set it to `https://opex-vbm-api.<account-subdomain>.workers.dev` only after the Worker exists; see `docs/DEPLOYMENT.md`, sections 7 and 8. The Worker's CORS origin for this site is `https://heppyh.github.io` (origin only, lowercase, no path).
