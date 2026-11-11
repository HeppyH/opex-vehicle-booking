import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL in your shell. Do not commit credentials.");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  await sql`create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())`;
  const dir = path.resolve("db/migrations");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    const already = await sql`select filename from schema_migrations where filename = ${file}`;
    if (already.length) { console.log(`skip ${file}`); continue; }
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    await sql.begin(async tx => {
      await tx.unsafe(content);
      await tx`insert into schema_migrations(filename) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
} finally {
  await sql.end();
}
