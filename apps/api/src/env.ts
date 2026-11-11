export type Env = {
  APP_ENV: string;
  ALLOWED_ORIGIN: string;
  GEOTAB_DATABASE: string;
  DATABASE_URL?: string; // local development only; use Hyperdrive binding in Cloudflare
  DB?: { connectionString: string };
  IDENTITY_ADAPTER_CONFIGURED?: string;
};
