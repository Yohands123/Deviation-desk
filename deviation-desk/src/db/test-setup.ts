/** Vitest global setup for the db project: bring the local database and agent configs up to date. */
import { join } from "node:path";
import { syncAgentConfigs } from "../agents/configs";
import { defaultAgents } from "../agents/registry";
import { closeSql, getSql } from "./client";
import { migrate } from "./migrate";

export default async function setup() {
  const sql = getSql();
  await migrate(sql, join(__dirname, "..", "..", "db", "migrations"));
  await syncAgentConfigs(sql, defaultAgents);
  await closeSql();
}
