/**
 * Local demo sign-in for the seeded company: one Supabase Auth user per person, linked through
 * people.auth_user_id. Local development only; the shared password is printed by the seed script.
 */
import { createClient } from "@supabase/supabase-js";
import type { Sql } from "../client";

export const DEMO_PASSWORD = "helix-demo";

/** "Tomás Reyes" → "tomas.reyes@helix.example" (example.* is reserved for documentation). */
export function demoEmail(name: string, domain = "helix.example"): string {
  const plain = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z]+/g, ".");
  return `${plain}@${domain}`;
}

export async function createDemoLogins(sql: Sql, worldId: string, domain?: string): Promise<Array<{ name: string; role: string; email: string }>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are needed to create demo logins.");
  // A shared password is local-only unless the owner explicitly opts in for a private demo.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url) && process.env.ALLOW_HOSTED_DEMO_LOGINS !== "yes") {
    throw new Error("Demo logins share one password and are only created against a local Supabase (set ALLOW_HOSTED_DEMO_LOGINS=yes to override for a private demo).");
  }
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const people = await sql<{ id: string; name: string; role: string }[]>`
    select id, name, role from people where world_id = ${worldId} order by name`;
  const created: Array<{ name: string; role: string; email: string }> = [];
  for (const person of people) {
    const email = demoEmail(person.name, domain);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { name: person.name },
    });
    if (error || !data.user) throw new Error(`Could not create login for ${person.name}: ${error?.message ?? "no user"}`);
    await sql`update people set auth_user_id = ${data.user.id} where world_id = ${worldId} and id = ${person.id}`;
    created.push({ name: person.name, role: person.role, email });
  }
  return created;
}
