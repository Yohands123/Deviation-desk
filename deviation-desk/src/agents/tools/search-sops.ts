import { z } from "zod";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

const input = z.object({
  query: z.string().min(2).describe('Keywords, e.g. "cleaning record cleanroom".'),
  limit: z.number().int().min(1).max(10).default(5),
});

export const searchSops: AgentTool<typeof input> = {
  name: "search_sops",
  description:
    'Search the company\'s standard operating procedures by keyword. Returns matching SOPs with their full text; cite them as table "records".',
  input,
  async run({ query, limit }, ctx) {
    // Postgres full-text search where any keyword may match. Keywords are reduced to plain words.
    const words = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 12);
    if (words.length === 0) return { citeAs: "records", sops: [] };
    const sql = getSql();
    const sops = await sql`
      select r.id, r.title, r.body
      from records r, to_tsquery('english', ${words.join(" | ")}) q
      where r.world_id = ${ctx.worldId} and r.record_type = 'sop'
        and to_tsvector('english', r.title || ' ' || r.body) @@ q
      order by ts_rank(to_tsvector('english', r.title || ' ' || r.body), q) desc, r.title
      limit ${limit}`;
    return { citeAs: "records", sops };
  },
};
