import { z } from "zod";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

const libraryInput = z.object({
  query: z.string().optional().describe('Keywords, e.g. "distributed defect" or "trial site". Omit to list every rule.'),
  appliesTo: z.enum(["all", "biologic", "device", "clinical", "distribution"]).optional(),
});

export const searchRegulatoryLibrary: AgentTool<typeof libraryInput> = {
  name: "search_regulatory_library",
  description:
    'Search the company\'s regulatory library: reporting rules with when they apply, the deadline in hours, when the clock starts, and required documents. Rules marked fictional are a demo library. Cite rules as table "regulatory_rules". Deadlines are computed by the system, never by you.',
  input: libraryInput,
  async run({ query, appliesTo }, ctx) {
    const words = (query?.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 12);
    const sql = getSql();
    const rules = await sql`
      select r.id, r.code, r.authority, r.title, r.applies_to, r.applies_when, r.deadline_hours, r.clock_starts,
        r.required_documents, r.body, r.fictional
      from regulatory_rules r
      where r.world_id = ${ctx.worldId}
        ${appliesTo ? sql`and r.applies_to in (${appliesTo}, 'all')` : sql``}
        ${
          words.length > 0
            ? sql`and to_tsvector('english', r.title || ' ' || r.applies_when || ' ' || r.body) @@ to_tsquery('english', ${words.join(" | ")})`
            : sql``
        }
      order by r.code
      limit 20`;
    return { citeAs: "regulatory_rules", rules };
  },
};

const contactsInput = z.object({
  kind: z.enum(["customer", "trial_site", "supplier", "internal", "regulator"]).optional(),
  organization: z.string().optional().describe("Part of an organization name, e.g. a customer, trial site or supplier."),
});

export const getContacts: AgentTool<typeof contactsInput> = {
  name: "get_contacts",
  description:
    'List the people messages can go to: customers, trial sites, suppliers, internal staff and the regulator, with their organization and role. Address messages by contact name or organization exactly as returned. Cite contacts as table "contacts".',
  input: contactsInput,
  async run({ kind, organization }, ctx) {
    const sql = getSql();
    const contacts = await sql`
      select c.id, c.name, c.organization, c.kind, c.role
      from contacts c
      where c.world_id = ${ctx.worldId}
        ${kind ? sql`and c.kind = ${kind}` : sql``}
        ${organization ? sql`and c.organization ilike ${`%${organization}%`}` : sql``}
      order by c.kind, c.organization, c.name
      limit 40`;
    return { citeAs: "contacts", contacts };
  },
};

const obligationsInput = z.object({});

export const listObligations: AgentTool<typeof obligationsInput> = {
  name: "list_obligations",
  description:
    'This incident\'s reporting obligations: those Regulatory Affairs confirmed (with the computed due time and whether a submission was approved) and those still awaiting a decision. Cite confirmed ones as table "regulatory_obligations".',
  input: obligationsInput,
  async run(_input, ctx) {
    if (!ctx.incidentId) return { confirmed: [], awaitingDecision: [] };
    const sql = getSql();
    const confirmed = await sql`
      select o.id, r.code as rule_code, r.title, o.clock_started_at, o.due_at, o.submitted_message_id is not null as submission_approved
      from regulatory_obligations o
      join regulatory_rules r on r.world_id = o.world_id and r.id = o.rule_id
      where o.world_id = ${ctx.worldId} and o.incident_id = ${ctx.incidentId}
      order by o.due_at`;
    const awaitingDecision = await sql`
      select d.id as decision_record_id, d.record -> 'answer' -> 'proposedAction' -> 'params' ->> 'ruleCode' as rule_code
      from decision_records d
      where d.world_id = ${ctx.worldId} and d.incident_id = ${ctx.incidentId}
        and d.record -> 'answer' -> 'proposedAction' ->> 'type' = 'confirm_reporting_obligation'
        and not exists (select 1 from approvals a where a.world_id = d.world_id and a.decision_record_id = d.id and a.outcome <> 'more_evidence')`;
    return { citeAs: "regulatory_obligations", confirmed, awaitingDecision };
  },
};
