"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/utils";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Tạo Supabase admin client dùng Service Role Key (bypass RLS).
 * Sử dụng getEnv() để lấy biến môi trường đúng cách trên cả
 * localhost (process.env) và Cloudflare Workers (runtime context).
 */
function createServiceRoleClient() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createAdminClient(supabaseUrl, serviceKey || anonKey);
}

export async function getAllProfilesAction() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !isAdmin(user.email)) {
      return { success: false, error: "Unauthorized" };
    }

    const adminDb = createServiceRoleClient();

    const { data, error } = await adminDb
      .from("profiles")
      .select("*")
      .order("email");

    if (error) {
      console.error("Lỗi khi fetch profiles:", error);
      return { success: false, error: error.message };
    }
    
    console.log(`getAllProfilesAction: Fetched ${data?.length} profiles.`);
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

    const adminDb = createServiceRoleClient();

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
