/** Invite real users on a hosted Supabase; local stacks keep their demo logins. */
import "server-only";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { closeSql, getSql, type Sql } from "../src/db/client";

const InviteEntry = z.object({
  person: z.string().min(1).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
  email: z.email(),
});
export type InviteEntry = z.infer<typeof InviteEntry>;

const InviteEnvironment = z.object({
  DATABASE_URL: z.string().trim().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().trim().min(1),
  SUPABASE_SECRET_KEY: z.string().trim().min(1),
  APP_URL: z.string().trim().min(1),
});
export type InviteEnvironment = z.infer<typeof InviteEnvironment>;

class InviteUsersError extends Error {}

/** Quoted fields, escaped quotes, BOMs and Windows line endings need no CSV dependency. */
export function parseInviteCsv(source: string): InviteEntry[] {
  const text = source.replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  const finishField = () => {
    row.push(state === "plain" ? field.trim() : field);
    field = "";
    state = "plain";
  };
  const finishRow = () => {
    finishField();
    if (row.length > 1 || row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (state === "quoted") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else state = "closed";
      } else field += character;
    } else if (character === ",") finishField();
    else if (character === "\n") finishRow();
    else if (character === '"' && state === "plain" && field.trim() === "") {
      field = "";
      state = "quoted";
    } else if (character === '"' || (state === "closed" && character?.trim() !== "")) {
      throw new InviteUsersError("CSV contains a misplaced quote or text after a closing quote.");
    } else if (state === "plain") field += character;
  }
  if (state === "quoted") throw new InviteUsersError("CSV contains an unterminated quoted field.");
  if (field !== "" || row.length > 0 || state === "closed") finishRow();
  const header = rows.shift();
  if (header?.length !== 2 || header[0] !== "person" || header[1] !== "email") {
    throw new InviteUsersError("CSV must have exactly the header person,email.");
  }
  if (rows.length === 0) throw new InviteUsersError("CSV must include at least one invite row.");

  const names = new Set<string>();
  const emails = new Set<string>();
  return rows.map((cells, index) => {
    const entry = InviteEntry.safeParse({ person: cells[0], email: cells[1] });
    if (cells.length !== 2 || !entry.success) {
      throw new InviteUsersError(`CSV record ${index + 2} needs a person and a valid email, with exactly two columns.`);
    }
    const emailKey = entry.data.email.toLowerCase();
    if (names.has(entry.data.person) || emails.has(emailKey)) {
      throw new InviteUsersError(`CSV record ${index + 2} repeats a person or email; use one login per person.`);
    }
    names.add(entry.data.person);
    emails.add(emailKey);
    return entry.data;
  });
}

export function parseInviteArgs(args: string[]): { company: string; map: string; dryRun: boolean } {
  const options: { company?: string; map?: string; dryRun: boolean } = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run" && !options.dryRun) options.dryRun = true;
    else if (arg === "--company" || arg === "--map") {
      const key = arg === "--company" ? "company" : "map";
      const value = args[index + 1];
      if (options[key] || !value?.trim() || value.startsWith("--")) {
        throw new InviteUsersError(`Pass ${arg} once with a non-empty value.`);
      }
      options[key] = value;
      index += 1;
    } else throw new InviteUsersError("Usage: invite-users.ts --company <name> --map <csv> [--dry-run]");
  }
  if (!options.company || !options.map) {
    throw new InviteUsersError("Usage: invite-users.ts --company <name> --map <csv> [--dry-run]");
  }
  return { company: options.company, map: options.map, dryRun: options.dryRun };
}

function httpUrl(value: string, variable: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new InviteUsersError(`${variable} must be an absolute HTTP(S) URL.`); }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new InviteUsersError(`${variable} must be an HTTP(S) URL without credentials, query or fragment.`);
  }
  return url;
}

export function readInviteEnvironment(env: Record<string, string | undefined>): InviteEnvironment {
  const parsed = InviteEnvironment.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path[0]).join(", ");
    throw new InviteUsersError(`Required environment variables are missing or empty: ${missing}.`);
  }
  const config = parsed.data;
  const supabase = httpUrl(config.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const host = supabase.hostname.toLowerCase().replace(/\.$/u, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      !host.includes(".") || host === "host.docker.internal" || host.startsWith("127.") ||
      host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./u.test(host) || host === "0.0.0.0" || host.includes(":")) {
    throw new InviteUsersError("Local Supabase URLs are refused; the local stack keeps demo logins.");
  }
  if (supabase.protocol !== "https:") {
    throw new InviteUsersError("Hosted Supabase must use HTTPS.");
  }
  httpUrl(config.APP_URL, "APP_URL");
  try {
    const database = new URL(config.DATABASE_URL);
    if (!/^postgres(?:ql)?:$/u.test(database.protocol) || !database.hostname) throw new Error();
  } catch { throw new InviteUsersError("DATABASE_URL must be a PostgreSQL connection URL."); }
  return config;
}

type Person = { id: string; name: string; authUserId: string | null };
export type InviteResult = InviteEntry & { status: string };

/** Validate the complete map before the first email is sent, within this live world only. */
export async function inviteUsers(
  sql: Sql, worldId: string, entries: InviteEntry[], config: InviteEnvironment, dryRun: boolean,
): Promise<InviteResult[]> {
  let people: Person[];
  try {
    people = await sql<Person[]>`select id, name, auth_user_id from people where world_id = ${worldId}`;
  } catch { throw new InviteUsersError("Could not read people. Check DATABASE_URL and applied migrations."); }
  const matched = entries.map((entry) => {
    const matches = people.filter((person) => person.name === entry.person);
    if (matches.length === 0) throw new InviteUsersError(`Unknown person ${JSON.stringify(entry.person)} in the company's live world.`);
    if (matches.length > 1) throw new InviteUsersError(`Person ${JSON.stringify(entry.person)} is ambiguous in the company's live world.`);
    const person = matches[0];
    if (!person) throw new InviteUsersError("Could not resolve the person.");
    return { entry, person };
  });
  const results = matched.map(({ entry, person }) => ({
    ...entry,
    status: person.authUserId ? "skipped (already linked)" : dryRun ? "would invite" : "not attempted",
  }));
  // Constructing an Auth client can initialize network work; dry runs never construct one.
  if (dryRun || matched.every(({ person }) => person.authUserId)) return results;
  const admin = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const redirectTo = `${config.APP_URL.replace(/\/+$/u, "")}/login`;
  for (const [index, { entry, person }] of matched.entries()) {
    const result = results[index];
    if (!result || person.authUserId) continue;
    let inviteSent = false;
    try {
      result.status = await sql.begin(async (transaction) => {
        // Each person's lock prevents simultaneous script runs from sending duplicate invites.
        const [current] = await transaction<Person[]>`
          select id, name, auth_user_id from people
          where world_id = ${worldId} and id = ${person.id} for update`;
        if (!current) throw new InviteUsersError("error: person disappeared; rerun the dry run");
        if (current.authUserId) return "skipped (already linked)";
        const { data, error } = await admin.auth.admin.inviteUserByEmail(entry.email, { redirectTo });
        if (error || !data.user) {
          const status = error?.status ? ` (HTTP ${error.status})` : "";
          throw new InviteUsersError(`error: Supabase invite failed${status}; check Auth before retrying`);
        }
        inviteSent = true;
        const updated = await transaction<{ id: string }[]>`
          update people set auth_user_id = ${data.user.id}
          where world_id = ${worldId} and id = ${person.id} and auth_user_id is null returning id`;
        if (updated.length !== 1) throw new Error("Person was not linked.");
        return "invited";
      });
    } catch (error) {
      result.status = inviteSent
        ? "error: invite sent but database link failed; review Supabase Auth before retrying"
        : error instanceof InviteUsersError ? error.message
          : "error: invite or database operation failed; check Auth before retrying";
      break;
    }
  }
  return results;
}

async function main(): Promise<void> {
  const { company, map, dryRun } = parseInviteArgs(process.argv.slice(2));
  const config = readInviteEnvironment(process.env);
  let csv: string;
  try { csv = map === "-" ? readFileSync(0, "utf8") : await readFile(map, "utf8"); }
  catch { throw new InviteUsersError("Could not read the CSV map. Check --map and file permissions."); }
  const entries = parseInviteCsv(csv);
  const sql = getSql();
  let worlds: Array<{ id: string }>;
  try {
    worlds = await sql<{ id: string }[]>`
      select w.id from companies c join worlds w on w.company_id = c.id
      where c.name = ${company} and w.kind = 'live' and w.status = 'active'`;
  } catch { throw new InviteUsersError("Could not find the company. Check DATABASE_URL and applied migrations."); }
  if (worlds.length !== 1 || !worlds[0]) {
    throw new InviteUsersError(`Company ${JSON.stringify(company)} needs exactly one active live world; found ${worlds.length}.`);
  }
  const results = await inviteUsers(sql, worlds[0].id, entries, config, dryRun);
  console.table(results);
  if (dryRun) console.log("Dry run: no Supabase requests or database writes.");
  if (results.some((result) => result.status.startsWith("error:"))) process.exitCode = 1;
}

// Unit tests import the pure parser and orchestration without starting the CLI.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof InviteUsersError ? error.message : "Invite script failed. Check configuration and connectivity.");
    process.exitCode = 1;
  }).finally(async () => {
    try { await closeSql(); }
    catch {
      console.error("Could not close the database connection.");
      process.exitCode = 1;
    }
  });
}
