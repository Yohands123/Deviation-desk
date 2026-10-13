/**
 * Agent configs live in the database (agent_configs, with every version kept in
 * agent_config_versions). registry.ts holds the reviewed default definitions; `npm run agents:sync`
 * writes them to the database as a new version whenever one changes. Runs load configs from here.
 */
import type { Sql } from "@/db/client";
import { AgentConfig } from "./contract";

export interface LoadedAgent {
  config: AgentConfig;
  version: number;
}

export async function loadAgent(sql: Sql, id: string): Promise<LoadedAgent> {
  const [row] = await sql<{ config: unknown; version: number }[]>`select config, version from agent_configs where id = ${id}`;
  if (!row) throw new Error(`Agent ${id} is not configured. Run npm run agents:sync.`);
  return { config: AgentConfig.parse(row.config), version: row.version };
}

export async function loadAllAgents(sql: Sql): Promise<LoadedAgent[]> {
  const rows = await sql<{ config: unknown; version: number }[]>`select config, version from agent_configs order by id`;
  return rows.map((r) => ({ config: AgentConfig.parse(r.config), version: r.version }));
}

/**
 * Writes each definition that differs from the stored config as a new version.
 * Returns the ids that changed. Definitions are validated before anything is written.
 */
export async function syncAgentConfigs(sql: Sql, definitions: readonly AgentConfig[]): Promise<string[]> {
  const configs = definitions.map((d) => AgentConfig.parse(d));
  return sql.begin(async (tx) => {
    const changed: string[] = [];
    for (const config of configs) {
      const json = tx.json(config as unknown as Parameters<typeof tx.json>[0]);
      const [current] = await tx<{ version: number; same: boolean }[]>`
        select version, config = ${json}::jsonb as same from agent_configs where id = ${config.id} for update`;
      if (current?.same) continue;
      const version = (current?.version ?? 0) + 1;
      await tx`insert into agent_config_versions ${tx({ agentId: config.id, version, config: json })}`;
      await tx`
        insert into agent_configs (id, config, version, updated_at) values (${config.id}, ${json}, ${version}, now())
        on conflict (id) do update set config = excluded.config, version = excluded.version, updated_at = now()`;
      changed.push(config.id);
    }
    return changed;
  });
}
