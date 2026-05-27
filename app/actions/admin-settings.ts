"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/utils";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Tạo Supabase admin client dùng Service Role Key (bypass RLS).
 */
function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY. Vui lòng thêm biến này vào Cloudflare Settings > Variables and Secrets.");
  if (serviceKey === anonKey) {
    throw new Error("LỖI CẤU HÌNH CLOUDFLARE: Biến SUPABASE_SERVICE_ROLE_KEY đang bị trùng y hệt với ANON_KEY. Bạn đã copy nhầm khóa rồi! Hãy vào Supabase > Settings > API, copy đúng dòng 'service_role (secret)' và dán lại vào Cloudflare nhé.");
  }

  return createAdminClient(supabaseUrl, serviceKey);
}

export async function saveAdminSettingsAction(url: string, apiKey: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    return { success: false, error: "Unauthorized" };
  }

  // Create admin client to bypass RLS for app_settings
  const adminDb = createServiceRoleClient();

  // Clean strings
  const cleanUrl = url.trim().replace(/[^\x20-\x7E]/g, '');
  const cleanKey = apiKey.trim().replace(/[^\x20-\x7E]/g, '');

  // Save URL
  const { error: err1 } = await adminDb
    .from("app_settings")
    .upsert({ key: "admin_proxy_url", value: cleanUrl }, { onConflict: "key" });

  if (err1) return { success: false, error: err1.message };

  // Save Key
  const { error: err2 } = await adminDb
    .from("app_settings")
    .upsert({ key: "admin_proxy_key", value: cleanKey }, { onConflict: "key" });

  if (err2) return { success: false, error: err2.message };

  return { success: true };
}

export async function getAutoClassifySettingAction() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "admin_auto_classify_new_novels")
      .single();

    if (error) return { success: true, value: false };
    return { success: true, value: data?.value === "true" };
  } catch (e) {
    return { success: true, value: false };
  }
}

export async function saveAutoClassifySettingAction(enabled: boolean) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !isAdmin(user.email)) {
      return { success: false, error: "Unauthorized" };
    }

    const adminDb = createServiceRoleClient();

    const { error } = await adminDb
      .from("app_settings")
      .upsert({ key: "admin_auto_classify_new_novels", value: enabled ? "true" : "false" }, { onConflict: "key" });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
