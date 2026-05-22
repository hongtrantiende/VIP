import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Server-side guard to enforce VIP/Admin access on pages.
 * If the user is not authenticated, redirects to /login.
 * If the user is authenticated but does not have VIP status, redirects to /dashboard.
 */
export async function enforceVipAccess() {
  const supabase = await createClient();

  // 1. Get the current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // 2. Check Admin status
  const email = user.email?.toLowerCase() || "";
  const isAdmin = email === "nthanhnam2005@gmail.com" || email === "thanhxnam2005@gmail.com";

  if (isAdmin) {
    return { user, isVip: true };
  }

  // 3. Check App Settings (free_mode) and Profile's vip_until date in parallel
  const [settingsResult, profileResult] = await Promise.all([
    supabase.from("app_settings").select("key, value").eq("key", "free_mode").maybeSingle(),
    supabase.from("profiles").select("vip_until").eq("id", user.id).maybeSingle()
  ]);

  const isFreeMode = settingsResult.data?.value === "true";
  const vipUntil = profileResult.data?.vip_until;
  const hasVipActive = vipUntil && new Date(vipUntil) > new Date();
  const isVip = isFreeMode || !!hasVipActive;

  // 4. Redirect if unauthorized
  if (!isVip) {
    redirect("/dashboard");
  }

  return { user, isVip: true };
}
