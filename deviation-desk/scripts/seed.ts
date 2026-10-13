/**
 * Seed the Helix Biologics demo company into its live world (docs/DOMAIN.md §Seed), with a local
 * demo login for each person. Refuses to seed twice; run `npm run db:reset` to start over.
 */
import { closeSql, getSql } from "../src/db/client";
import { createDemoLogins, DEMO_PASSWORD } from "../src/db/seed/demo-logins";
import { HELIX_COMPANY_NAME, seedHelixBiologics } from "../src/db/seed/helix-biologics";

async function main() {
  const sql = getSql();
  const existing = await sql`
    select w.id from companies c join worlds w on w.company_id = c.id and w.kind = 'live'
    where c.name = ${HELIX_COMPANY_NAME}`;
  if (existing.length > 0) {
    console.log(`${HELIX_COMPANY_NAME} is already seeded (live world ${String(existing[0]?.id)}). Run npm run db:reset to start over.`);
    return;
  }
  const { companyId, worldId } = await seedHelixBiologics(sql);
  console.log(`Seeded ${HELIX_COMPANY_NAME}: company ${companyId}, live world ${worldId}`);
  const logins = await createDemoLogins(sql, worldId);
  console.log(`Demo logins (local only, password "${DEMO_PASSWORD}"):`);
  console.table(logins);
}

main().then(closeSql, async (err) => {
  console.error(err);
  await closeSql();
  process.exit(1);
});
