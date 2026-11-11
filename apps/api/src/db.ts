import postgres from "postgres";
import type { Env } from "./env";

export function sqlFor(env: Env) {
  const connectionString = env.DB?.connectionString || env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_CONNECTION_NOT_CONFIGURED");
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
}
