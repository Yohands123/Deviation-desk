import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicEnv } from "./env";

/** Supabase client for server components and server actions, carrying the user's session cookies. */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  const { url, key } = supabasePublicEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server components cannot set cookies. That is fine: src/proxy.ts refreshes the session
          // on every request, so only server actions need to write cookies here.
        }
      },
    },
  });
}
