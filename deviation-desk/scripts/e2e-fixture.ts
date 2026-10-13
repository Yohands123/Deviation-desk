/**
 * Fixture for the Playwright test: a separate throwaway company with its own logins, one incident,
 * and one proposal waiting for the QA Director. No model calls. Prints the details as JSON.
 */
import { closeSql, getSql } from "../src/db/client";
import { resolveRef } from "../src/db/resolve-ref";
import { createDemoLogins, DEMO_PASSWORD } from "../src/db/seed/demo-logins";
import { seedHelixBiologics } from "../src/db/seed/helix-biologics";

async function main() {
  const sql = getSql();
  const id = crypto.randomUUID().slice(0, 8);
  const { worldId, companyId } = await seedHelixBiologics(sql, `Helix Biologics (e2e ${id})`);
  const logins = await createDemoLogins(sql, worldId, `e2e-${id}.example`);
  const qa = logins.find((l) => l.role === "QA Director");
  const plantManager = logins.find((l) => l.role === "Plant Manager");
  if (!qa || !plantManager) throw new Error("Seed is missing the QA Director or Plant Manager");

  const code = `E2E-${id.slice(0, 4).toUpperCase()}`;
  const [incident] = await sql<{ id: string }[]>`
    insert into incidents ${sql({ worldId, companyId, code, title: "Sterility failure on batch A-2235 (test)", incidentType: "quality", severity: "critical" })}
    returning id`;
  if (!incident) throw new Error("setup");
  await sql`insert into incident_events ${sql({
    worldId,
    companyId,
    incidentId: incident.id,
    actorType: "system",
    actorId: "workflow",
    eventType: "opened",
    payload: sql.json({ objects: [{ table: "batches", code: "A-2235", id: await resolveRef(sql, worldId, { table: "batches", code: "A-2235" }) }] }),
  })}`;

  const batchId = await resolveRef(sql, worldId, { table: "batches", code: "A-2235" });
  const answer = {
    kind: "proposal",
    summary: "Hold batch A-2235 while the sterility failure is investigated.",
    reasoning: "A-2235 shares gasket lot G-77 with the failed batch.",
    sources: [{ table: "batches", rowId: batchId, note: "Batch A-2235, in production on Line 3" }],
    confidence: "medium",
    alternatives: [],
    requiresApproval: true,
    approvalSeat: "qa_director",
    proposedAction: { type: "hold_batch", params: { batches: ["A-2235"], reason: "Shares gasket lot G-77" } },
  };
  await sql`insert into decision_records ${sql({
    worldId,
    companyId,
    incidentId: incident.id,
    agentId: "quarantine_officer",
    record: sql.json({ agentId: "quarantine_officer", incidentId: incident.id, worldId, answer, rejectedSources: [] }),
    requiresApproval: true,
  })}`;

  console.log(JSON.stringify({ email: qa.email, plantManagerEmail: plantManager.email, password: DEMO_PASSWORD, code }));
}

main().then(closeSql, async (err) => {
  console.error(err);
  await closeSql();
  process.exit(1);
});
