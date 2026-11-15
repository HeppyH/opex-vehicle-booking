# Phase 11.1 – Build Guide – OPEX Asset Booking MyGeotab Integration

**Repository:** `C:\04. Project 2026\Geotab\Book Vehicle\opex-vehicle-booking-clone`
**Branch:** `feature/vehicle-booking-phase-2`
**Date:** 2026-11-14

## 1. Build Commands

| Command | Purpose | Workspace |
|---------|---------|-----------|
| `npm run build` | Main application production build | `apps/web/` |
| `npm run build:service` | Service Add-In standalone bundle | `apps/web/` |
| `npm run build` | API typecheck | `apps/api/` |
| `npm test` | API automated tests | `apps/api/` |

## 2. Build Order (Important)

**The `npm run build` command cleans `dist/` before building.** The Service Add-In bundle must be generated **after** the main build:

```bash
# Step 1: Main application build
npm run build

# Step 2: Service Add-In bundle
npm run build:service
```

Running `build:service` before `build` will result in the bundle being deleted when `build` runs.

## 3. Build Outputs

### Main Application

| Path | Description |
|------|-------------|
| `apps/web/dist/index.html` | Entry HTML |
| `apps/web/dist/assets/index-*.js` | Application JavaScript |
| `apps/web/dist/assets/index-*.css` | Application CSS |

### Service Add-In Bundle

| Path | Size | Description |
|------|------|-------------|
| `apps/web/dist/serviceAddin.js` | ~6.6 kB | Standalone Service Add-In |

## 4. Service Add-In Build Details

### Command

```json
"build:service": "tsc src/serviceAddin.ts --outDir dist --module ESNext --moduleResolution Node --target ES2022 --skipLibCheck --esModuleInterop --allowSyntheticDefaultImports --noLib false --lib ES2022,DOM"
```

### Requirements

- No external dependencies
- No Node.js-only APIs
- Self-contained ES2022 ES modules
- Compatible with MyGeotab Service Add-In WebWorker runtime

### Deployment

The bundle must be hosted at the URL specified in `geotab/opex-vbm-service-config.json`:

```json
"serviceSrc": "https://heppyh.github.io/opexassetbooking/serviceAddin.js"
```

## 5. Verification

### TypeScript Check

```bash
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: Clean (no output)

### Service Add-In Unit Tests

```bash
node --experimental-strip-types apps/web/test/service-addin.test.mjs
```

Expected: 16/16 pass

### Existing API Tests

```bash
npm test
```

Expected: 65/65 pass

### Full Build

```bash
npm run build
npm run build:service
```

Expected: Both commands complete without errors; `dist/serviceAddin.js` exists

## 6. Build Artifacts (Do Not Commit)

The following are build outputs and should not be committed to git:

- `apps/web/dist/` (entire directory)
- `apps/web/dist/serviceAddin.js` (Service Add-In bundle)

## 7. Troubleshooting

### `build:service` fails with "Cannot find module"

Ensure you're running from `apps/web/` directory:
```bash
cd apps/web
npm run build:service
```

### Service Add-In bundle missing after `npm run build`

Remember to run `build:service` **after** `build`:
```bash
npm run build && npm run build:service
```

### TypeScript errors in serviceAddin.ts

Ensure `--lib ES2022,DOM` is included. The `self` global is guarded by `typeof self !== "undefined"` for test compatibility.
