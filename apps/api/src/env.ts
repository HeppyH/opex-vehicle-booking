/**
 * Worker environment. Where each value comes from:
 *
 *  APP_ENV, ALLOWED_ORIGIN, GEOTAB_DATABASE
 *      Plain, non-secret [vars] in wrangler.toml (override locally in .dev.vars).
 *  DB
 *      Cloudflare Hyperdrive binding (`[[hyperdrive]] binding = "DB"`), created
 *      only after the Neon database and Hyperdrive config exist.
 *  DATABASE_URL
 *      Local development / migration tooling ONLY (.dev.vars or shell). It is
 *      never set on the deployed Worker.
 *  IDENTITY_ADAPTER_CONFIGURED
 *      Fail-closed switch. Leave unset or "false" until MyGeotab session
 *      verification has been validated against GEOTAB_DATABASE.
 */
export type Env = {
  /** "personal-test" when deployed; "development" locally (exposes error messages). */
  APP_ENV: string;
  /** Exact frontend origin (scheme + lowercase host, no path), e.g. https://heppyh.github.io */
  ALLOWED_ORIGIN: string;
  /** MyGeotab database sessions are accepted for: opex_trial. Never taken from the client. */
  GEOTAB_DATABASE: string;
  /** Local development only; the deployed Worker uses the Hyperdrive binding. */
  DATABASE_URL?: string;
  /** Hyperdrive binding named "DB". */
  DB?: { connectionString: string };
  /** Must remain unset or "false" until identity verification is validated. */
  IDENTITY_ADAPTER_CONFIGURED?: string;
};
