import { z } from "zod";
import { getSql } from "@/db/client";
import { resolveSubject } from "./subject";
import type { AgentTool } from "./types";

const input = z
  .object({
    subjectTable: z.enum(["rooms", "equipment", "production_lines", "batches", "material_lots", "shipments"]),
    subjectId: z.string().optional(),
    subjectCode: z.string().optional().describe('Or its name/code, e.g. "Fill Room 3", "Filler 3", "A-2231".'),
    recordType: z.enum(["maintenance", "cleaning", "test_result", "batch_record"]).optional(),
    limit: z.number().int().min(1).max(60).default(40),
  })
  .refine((v) => v.subjectId || v.subjectCode, "Give subjectId or subjectCode.");

export const getRecords: AgentTool<typeof input> = {
  name: "get_records",
  description:
    'Get maintenance logs, cleaning records, test results and batch records for one object, newest first, with full text. Cite each as table "records".',
  input,
  async run({ subjectTable, subjectId, subjectCode, recordType, limit }, ctx) {
    const sql = getSql();
    const id = await resolveSubject(sql, ctx.worldId, subjectTable, { id: subjectId, code: subjectCode });
    const records = await sql`
      select id, record_type, title, body, recorded_at from records
      where world_id = ${ctx.worldId} and subject_id = ${id}
        ${recordType ? sql`and record_type = ${recordType}` : sql``}
      order by recorded_at desc limit ${limit}`;
    return { citeAs: "records", subject: { table: subjectTable, id }, records };
  },
};
