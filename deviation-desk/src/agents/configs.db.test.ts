import { afterAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/db/client";
import { loadAgent, syncAgentConfigs } from "./configs";
import { getDefaultAgent } from "./registry";

const sql = getSql();
afterAll(closeSql);

describe("agent configs in the database", () => {
  // A throwaway agent id so this test never touches the real configs.
  const base = { ...getDefaultAgent("signal_watcher"), id: `test_agent_${crypto.randomUUID().slice(0, 8).replace(/-/g, "")}` };

  it("versions a config only when it changes, keeping every version", async () => {
    expect(await syncAgentConfigs(sql, [base])).toEqual([base.id]);
    expect(await syncAgentConfigs(sql, [base])).toEqual([]);
    expect((await loadAgent(sql, base.id)).version).toBe(1);

    const edited = { ...base, systemPrompt: `${base.systemPrompt}\nBe brief.` };
    await syncAgentConfigs(sql, [edited]);
    const loaded = await loadAgent(sql, base.id);
    expect(loaded.version).toBe(2);
    expect(loaded.config.systemPrompt).toBe(edited.systemPrompt);

    const history = await sql<{ version: number }[]>`select version from agent_config_versions where agent_id = ${base.id} order by version`;
    expect(history.map((h) => h.version)).toEqual([1, 2]);
  });

  it("never rewrites history", async () => {
    await expect(sql`update agent_config_versions set config = '{}' where agent_id = ${base.id}`).rejects.toThrow(/append-only/);
  });

  it("fails loudly for an agent that was never synced", async () => {
    await expect(loadAgent(sql, "no_such_agent")).rejects.toThrow(/agents:sync/);
  });
});
