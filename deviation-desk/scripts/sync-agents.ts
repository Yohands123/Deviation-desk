/**
 * Write the agent definitions in src/agents/registry.ts to the database as new config versions.
 * Unchanged agents are left alone. Run after editing a prompt: npm run agents:sync
 */
import { syncAgentConfigs } from "../src/agents/configs";
import { defaultAgents } from "../src/agents/registry";
import { closeSql, getSql } from "../src/db/client";

async function main() {
  const changed = await syncAgentConfigs(getSql(), defaultAgents);
  console.log(changed.length > 0 ? `Updated: ${changed.join(", ")}` : "Agent configs are up to date.");
}

main().then(closeSql, async (err) => {
  console.error(err);
  await closeSql();
  process.exit(1);
});
