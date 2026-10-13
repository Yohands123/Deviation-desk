/**
 * Who is looking: the signed-in user, their person record, company and live world.
 * Every page and server action starts here; nothing trusts a company or world id from the browser.
 */
import "server-only";
import { redirect } from "next/navigation";
import { getSql } from "@/db/client";
import { createServerSupabase } from "@/lib/supabase/server";

export interface Viewer {
  userId: string;
  personId: string;
  name: string;
  role: string;
  companyId: string;
  companyName: string;
  /** Phase 4 shows the live world only; drills come with Phase 6. */
  worldId: string;
}

export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const [row] = await getSql()<Omit<Viewer, "userId">[]>`
    select p.id as person_id, p.name, p.role, p.company_id, c.name as company_name, w.id as world_id
    from people p
    join worlds w on w.id = p.world_id and w.kind = 'live' and w.status = 'active'
    join companies c on c.id = p.company_id
    where p.auth_user_id = ${userId}
    limit 1`;
  return row ? { userId, ...row } : null;
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}
