import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function createClient() {
  const cookieStore = await cookies();

  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  try {
    const ctx = getCloudflareContext();
    if (ctx && ctx.env) {
      supabaseUrl = supabaseUrl || (ctx.env.NEXT_PUBLIC_SUPABASE_URL as string) || "";
      supabaseKey = supabaseKey || (ctx.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) || "";
    }
  } catch (err) {}

  return createServerClient(
    supabaseUrl || "https://dummy.supabase.co",
    supabaseKey || "dummy-anon-key",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}
