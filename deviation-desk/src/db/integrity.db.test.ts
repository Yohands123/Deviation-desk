/** Database-level guarantees behind CLAUDE.md §2 (principles 1, 4, 5) and §11. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "./client";
import { createDrillWorld } from "./create-drill-world";
import { seedHelixBiologics, type SeededCompany } from "./seed/helix-biologics";

const sql = getSql();
let helix: SeededCompany;
let drillWorldId: string;

/** Opens an incident with one decision record in the given world. */
async function incidentWithDecision(worldId: string) {
  const base = { worldId, companyId: helix.companyId };
  const [incident] = await sql<{ id: string }[]>`
    insert into incidents ${sql({
      ...base,
      code: `DEV-${crypto.randomUUID().slice(0, 6)}`,
      title: "Integrity test",
      incidentType: "quality",
      severity: "warning",
    })}
    returning id`;
  if (!incident) throw new Error("Failed to create incident");
  const [decision] = await sql<{ id: string }[]>`
    insert into decision_records ${sql({
      ...base,
      incidentId: incident.id,
      agentId: "test_agent",
      record: sql.json({}),
      requiresApproval: true,
    })}
    returning id`;
  if (!decision) throw new Error("Failed to create decision record");
  return { incidentId: incident.id, decisionId: decision.id };
}

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  drillWorldId = (await createDrillWorld(sql, helix.worldId, 7)).id;
});
afterAll(closeSql);

describe("append-only audit tables", () => {
  it("rejects updates and deletes on incident_events and decision_records", async () => {
    const { incidentId, decisionId } = await incidentWithDecision(drillWorldId);
    await sql`insert into incident_events ${sql({
      worldId: drillWorldId,
      companyId: helix.companyId,
      incidentId,
      actorType: "system",
      actorId: "test",
      eventType: "opened",
    })}`;
    await expect(
      sql`update incident_events set event_type = 'edited' where world_id = ${drillWorldId} and incident_id = ${incidentId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      sql`delete from incident_events where world_id = ${drillWorldId} and incident_id = ${incidentId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      sql`update decision_records set requires_approval = false where world_id = ${drillWorldId} and id = ${decisionId}`,
    ).rejects.toThrow(/append-only/);
    await expect(sql`delete from decision_records where world_id = ${drillWorldId} and id = ${decisionId}`).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("approvals", () => {
  const approval = (worldId: string, decisionRecordId: string) => ({
    worldId,
    companyId: helix.companyId,
    decisionRecordId,
    seat: "qa_director",
    personId: null,
    outcome: "approved",
  });

  it("require a person in a live world", async () => {
    const { decisionId } = await incidentWithDecision(helix.worldId);
    await expect(sql`insert into approvals ${sql(approval(helix.worldId, decisionId))}`).rejects.toThrow(
      /must be made by a person/,
    );
  });

  it("may come from an AI seat in a drill world", async () => {
    const { decisionId } = await incidentWithDecision(drillWorldId);
    await sql`insert into approvals ${sql(approval(drillWorldId, decisionId))}`;
  });
});

describe("tenancy", () => {
  it("rejects a row whose company does not own its world", async () => {
    const [other] = await sql<{ id: string }[]>`insert into companies ${sql({ name: "Other Co (test)" })} returning id`;
    await expect(
      sql`insert into sites ${sql({ worldId: helix.worldId, companyId: other?.id ?? null, name: "Rogue site" })}`,
    ).rejects.toThrow(/foreign key/);
  });

  it("has row level security enabled on every public table", async () => {
    const rows = await sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`;
    expect(rows).toEqual([]);
  });
});
