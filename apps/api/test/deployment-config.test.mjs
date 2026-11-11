// Phase 2.4 — personal-testing deployment configuration checks.
// Local only: no network, no database, no Cloudflare/Neon/MyGeotab access.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "../src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const ACTIVE_FILES = [
  "apps/api/wrangler.toml",
  "apps/api/.dev.vars.example",
  "apps/api/src/env.ts",
  "apps/web/.env.example",
  ".github/workflows/deploy-pages.yml",
  "geotab/opex-vbm-config.json",
  "docs/DEPLOYMENT.md",
  "README.md",
];

// Active (uncommented) lines of wrangler.toml.
const toml = read("apps/api/wrangler.toml");
const activeToml = toml.split("\n").filter(l => !l.trim().startsWith("#")).join("\n");
const tomlVar = name => {
  const m = activeToml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : undefined;
};

test("no company domains in active deployment config or docs", () => {
  for (const f of ACTIVE_FILES) {
    const text = read(f);
    assert.doesNotMatch(text, /opexcg\.com/i, `${f} mentions opexcg.com`);
    assert.doesNotMatch(text, /\bopex\.com\b/i, `${f} mentions opex.com`);
    assert.doesNotMatch(text, /vbm\.opex|api-vbm\./i, `${f} mentions a company hostname`);
  }
});

test("wrangler.toml: personal-testing values", () => {
  assert.equal(tomlVar("name"), "opex-vbm-api");
  assert.equal(tomlVar("ALLOWED_ORIGIN"), "https://heppyh.github.io");
  assert.equal(tomlVar("GEOTAB_DATABASE"), "opex_trial");
  assert.notEqual(tomlVar("APP_ENV"), "development", "deployed default must not expose error messages");
  assert.match(activeToml, /^workers_dev\s*=\s*true/m);
});

test("ALLOWED_ORIGIN is a bare lowercase origin (no path, no trailing slash)", () => {
  const origin = tomlVar("ALLOWED_ORIGIN");
  assert.equal(new URL(origin).origin, origin);
  assert.equal(origin, origin.toLowerCase());
});

test("wrangler.toml holds no secrets and does not enable identity", () => {
  assert.doesNotMatch(toml, /postgres(ql)?:\/\//i);
  assert.doesNotMatch(activeToml, /IDENTITY_ADAPTER_CONFIGURED/);
  assert.doesNotMatch(activeToml, /DATABASE_URL|PASSWORD|TOKEN|SESSION/i);
});

test("wrangler.toml: Hyperdrive binding is either absent or a real DB binding", () => {
  if (!/\[\[hyperdrive\]\]/.test(activeToml)) return; // still commented out: expected before Hyperdrive exists
  assert.match(activeToml, /binding\s*=\s*"DB"/);
  assert.doesNotMatch(activeToml, /REPLACE_WITH/);
});

test("environment examples contain placeholders only and keep identity off", () => {
  const dev = read("apps/api/.dev.vars.example");
  assert.match(dev, /^IDENTITY_ADAPTER_CONFIGURED=false$/m);
  assert.match(dev, /^GEOTAB_DATABASE=opex_trial$/m);
  assert.match(dev, /USER:PASSWORD@HOST/);
  const web = read("apps/web/.env.example");
  assert.doesNotMatch(web, /^VITE_\w*(SECRET|TOKEN|PASSWORD|KEY)\w*=/im);
  assert.match(web, /^VITE_GEOTAB_DATABASE=opex_trial$/m);
});

test("Add-In config: valid JSON, personal host, tenant untouched", () => {
  const cfg = JSON.parse(read("geotab/opex-vbm-config.json"));
  assert.equal(new URL(cfg.items[0].url).host, "heppyh.github.io");
  assert.doesNotMatch(cfg.supportEmail, /opex/i);
});

test("workflow reads the API URL from a repository variable, not a secret", () => {
  const wf = read(".github/workflows/deploy-pages.yml");
  assert.match(wf, /VITE_API_BASE_URL:\s*\$\{\{\s*vars\.VITE_API_BASE_URL\s*\}\}/);
  assert.doesNotMatch(wf, /secrets\./);
});

// ---- Behaviour of the real Worker app, using the values parsed from wrangler.toml ----
const env = {
  APP_ENV: tomlVar("APP_ENV"),
  ALLOWED_ORIGIN: tomlVar("ALLOWED_ORIGIN"),
  GEOTAB_DATABASE: tomlVar("GEOTAB_DATABASE"),
};

test("CORS preflight from the GitHub Pages origin is allowed with the Geotab headers", async () => {
  const res = await app.request("/api/bookings", {
    method: "OPTIONS",
    headers: {
      Origin: "https://heppyh.github.io",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,idempotency-key,x-geotab-session-id,x-geotab-user-name",
    },
  }, env);
  assert.ok(res.status === 200 || res.status === 204, `status ${res.status}`);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://heppyh.github.io");
  const allowed = (res.headers.get("access-control-allow-headers") || "").toLowerCase();
  for (const h of ["content-type", "authorization", "idempotency-key", "x-geotab-session-id", "x-geotab-user-name"]) {
    assert.ok(allowed.includes(h), `missing allow-header ${h}`);
  }
});

test("other origins are rejected, including the full Pages URL with a path", async () => {
  for (const origin of ["https://example.com", "https://heppyh.github.io/opex-vehicle-booking", "http://heppyh.github.io"]) {
    const res = await app.request("/api/health", { headers: { Origin: origin } }, env);
    assert.equal(res.status, 403, origin);
    assert.deepEqual(await res.json(), { error: "ORIGIN_NOT_ALLOWED" });
  }
});

test("health reports tenant opex_trial and identity disabled", async () => {
  const res = await app.request("/api/health", { headers: { Origin: "https://heppyh.github.io" } }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.tenantTarget, "opex_trial");
  assert.equal(body.authConfigured, false);
});

test("protected routes fail closed (503) while identity is not configured, even with session headers", async () => {
  for (const [method, url] of [["GET", "/api/me"], ["GET", "/api/vehicles"], ["GET", "/api/bookings"], ["POST", "/api/bookings"]]) {
    const res = await app.request(url, {
      method,
      headers: {
        Origin: "https://heppyh.github.io",
        "x-geotab-session-id": "not-a-real-session",
        "x-geotab-user-name": "someone@example.com",
        "content-type": "application/json",
      },
      body: method === "POST" ? "{}" : undefined,
    }, env);
    assert.equal(res.status, 503, `${method} ${url}`);
    assert.equal((await res.json()).error, "AUTH_ADAPTER_NOT_CONFIGURED");
  }
});
