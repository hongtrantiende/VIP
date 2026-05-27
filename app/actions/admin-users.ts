"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/utils";
import { createClient as createAdminClient } from "@supabase/supabase-js";

/**
 * Giải quyết biến môi trường cho cả localhost (process.env)
 * và Cloudflare Workers (getCloudflareContext).
 */
function resolveEnv() {
  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // Trên Cloudflare Workers, process.env chỉ có NEXT_PUBLIC_*
  // Các secret (SUPABASE_SERVICE_ROLE_KEY) phải lấy qua getCloudflareContext()
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    if (ctx?.env) {
      const env = ctx.env as any;
      supabaseUrl = supabaseUrl || env.NEXT_PUBLIC_SUPABASE_URL || "";
      serviceKey = serviceKey || env.SUPABASE_SERVICE_ROLE_KEY || "";
      anonKey = anonKey || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    }
  } catch {
    // Không phải Cloudflare — bỏ qua
  }

  return { supabaseUrl, serviceKey, anonKey };
}

export async function getAllProfilesAction() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !isAdmin(user.email)) {
      return { success: false, error: "Unauthorized" };
    }

    const { supabaseUrl, serviceKey, anonKey } = resolveEnv();

    const adminDb = createAdminClient(
      supabaseUrl,
      serviceKey || anonKey
    );

    const { data, error } = await adminDb
      .from("profiles")
      .select("*")
      .order("email");

    if (error) {
      console.error("Lỗi khi fetch profiles:", error);
      return { success: false, error: error.message };
    }
    
    console.log(`getAllProfilesAction: Fetched ${data?.length} profiles. Using Service Key: ${!!serviceKey}`);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function saveUserAdminAction(updatedData: {
  id: string;
  display_name: string;
  vip_until: string | null;
  admin_model_quota: number;
  admin_daily_quota_limit: number;
  admin_assigned_model: string | null;
  admin_quota_last_reset: string;
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !isAdmin(user.email)) {
      return { success: false, error: "Unauthorized" };
    }

    const { supabaseUrl, serviceKey, anonKey } = resolveEnv();

    const adminDb = createAdminClient(
      supabaseUrl,
      serviceKey || anonKey
    );

    const { error } = await adminDb
      .from("profiles")
      .update({
        display_name: updatedData.display_name.trim(),
        vip_until: updatedData.vip_until,
        admin_model_quota: updatedData.admin_model_quota,
        admin_daily_quota_limit: updatedData.admin_daily_quota_limit,
        admin_quota_last_reset: updatedData.admin_quota_last_reset,
        admin_assigned_model: updatedData.admin_assigned_model,
      })
      .eq("id", updatedData.id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
