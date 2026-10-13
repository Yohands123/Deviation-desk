/**
 * Seed the Helix Biologics demo company into its live world (docs/DOMAIN.md §Seed), with a local
 * demo login for each person. Refuses to seed twice; run `npm run db:reset` to start over.
 */
import { closeSql, getSql } from "../src/db/client";
import { createDemoLogins, DEMO_PASSWORD } from "../src/db/seed/demo-logins";
import { HELIX_COMPANY_NAME, seedHelixBiologics } from "../src/db/seed/helix-biologics";
import { seedReferenceData } from "../src/db/seed/reference-data";
import { readScenarioFiles, seedScenarioLibrary } from "../src/sim/library";
import { join } from "node:path";

const scenarioFiles = () => readScenarioFiles(join(__dirname, "..", "evals", "scenarios"));

async function main() {
  const sql = getSql();
  const existing = await sql<{ id: string; companyId: string }[]>`
    select w.id, c.id as company_id from companies c join worlds w on w.company_id = c.id and w.kind = 'live'
    where c.name = ${HELIX_COMPANY_NAME}`;
  if (existing[0]) {
    console.log(`${HELIX_COMPANY_NAME} is already seeded (live world ${existing[0].id}). Run npm run db:reset to start over.`);
    // Data added in later phases is safe to top up: rows already there are skipped.
    const added = await seedScenarioLibrary(sql, existing[0].companyId, scenarioFiles());
    if (added.length > 0) console.log(`Added to the drill scenario library: ${added.join(", ")}`);
    const reference = await seedReferenceData(sql, existing[0].id, existing[0].companyId);
    if (reference.contacts + reference.rules + reference.capacity > 0) {
      console.log(`Added ${reference.contacts} contacts, ${reference.rules} regulatory rules and ${reference.capacity} capacity resources.`);
    }
    return;
  }
  const { companyId, worldId } = await seedHelixBiologics(sql);
  console.log(`Seeded ${HELIX_COMPANY_NAME}: company ${companyId}, live world ${worldId}`);
  const library = await seedScenarioLibrary(sql, companyId, scenarioFiles());
  console.log(`Drill scenario library: ${library.join(", ")}`);
  // Demo logins share one password, so they exist only on a local Supabase. Hosted projects invite
  // real people instead (scripts/invite-users.ts).
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    console.log("Hosted Supabase: no demo logins. Invite people with scripts/invite-users.ts.");
    return;
  }
  const logins = await createDemoLogins(sql, worldId);
  console.log(`Demo logins (local only, password "${DEMO_PASSWORD}"):`);
  console.table(logins);
}

main().then(closeSql, async (err) => {
  console.error(err);
  await closeSql();
  process.exit(1);
});
