/** Vitest global setup for the db project: bring the local database up to date first. */
import { join } from "node:path";
import { closeSql, getSql } from "./client";
import { migrate } from "./migrate";

export default async function setup() {
  await migrate(getSql(), join(__dirname, "..", "..", "db", "migrations"));
  await closeSql();
}
