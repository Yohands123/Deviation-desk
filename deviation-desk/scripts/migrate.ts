/**
 * Apply pending migrations from db/migrations to DATABASE_URL.
 */
import { join } from "node:path";
import { closeSql, getSql } from "../src/db/client";
import { migrate } from "../src/db/migrate";

async function main() {
  const ran = await migrate(getSql(), join(__dirname, "..", "db", "migrations"));
  console.log(ran.length > 0 ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
}

main().then(closeSql, async (err) => {
  console.error(err);
  await closeSql();
  process.exit(1);
});
