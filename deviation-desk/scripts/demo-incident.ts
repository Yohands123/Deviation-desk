/**
 * Puts a realistic incident into the live Helix world for demos: QC records a sterility failure on
 * A-2231 and reports it, and the agent chain runs (real Claude calls, about $0.50). The live world
 * cannot auto-approve, so the chain stops with proposals waiting for people in the Incident Room.
 * Run once after `npm run db:reset`. Needs the optimizer only if holds are later approved.
 */
import { closeSql, getSql } from "../src/db/client";
import { resolveRef } from "../src/db/resolve-ref";
import { HELIX_COMPANY_NAME } from "../src/db/seed/helix-biologics";
import { runLocally } from "../src/workflows/local-runner";

async function main() {
  const sql = getSql();
  const [world] = await sql<{ worldId: string; companyId: string }[]>`
    select w.id as world_id, w.company_id from worlds w join companies c on c.id = w.company_id
    where c.name = ${HELIX_COMPANY_NAME} and w.kind = 'live'`;
  if (!world) throw new Error("Seed Helix Biologics first (npm run db:seed).");
  const [existing] = await sql`select 1 from incidents where world_id = ${world.worldId}`;
  if (existing) {
    console.log("The live world already has incidents; nothing to do. Use npm run db:reset to start over.");
    return;
  }

  const batchId = await resolveRef(sql, world.worldId, { table: "batches", code: "A-2231" });
  await sql`insert into records ${sql({
    worldId: world.worldId,
    companyId: world.companyId,
    recordType: "test_result",
    subjectTable: "batches",
    subjectId: batchId,
    title: "A-2231 sterility test: FAIL",
    body: "14-day sterility incubation per SOP-QC-021 completed. Growth observed in 2 of 20 test units. Organism identification pending. Analyst: Kwame Mensah.",
    recordedAt: new Date(),
  })}`;

  console.log("Running the agent chain (Claude calls; a few minutes)…");
  const events = await runLocally({
    name: "report/submitted",
    data: {
      ...world,
      reportedBy: "Kwame Mensah (QC Microbiologist)",
      text: "Sterility test for batch A-2231 failed: growth in 2 of 20 units after 14 days. Result recorded in QC today.",
    },
  });
  console.log(events.map((e) => e.name).join(" → "));
  const [incident] = await sql<{ code: string }[]>`select code from incidents where world_id = ${world.worldId} order by opened_at limit 1`;
  console.log(incident ? `Open http://localhost:3000/incidents/${incident.code}` : "No incident was opened; see the log above.");
}

main().then(closeSql, async (err) => {
  console.error(err);
  await closeSql();
  process.exit(1);
});
