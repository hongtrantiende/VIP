"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/utils";

export async function saveAdminSettingsAction(url: string, apiKey: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user || !isAdmin(user.email)) {
    return { success: false, error: "Unauthorized" };
  }

  // Save URL
  const { error: err1 } = await supabase
    .from("app_settings")
    .upsert({ key: "admin_proxy_url", value: url }, { onConflict: "key" });
    
  if (err1) return { success: false, error: err1.message };

  // Save Key
  const { error: err2 } = await supabase
    .from("app_settings")
    .upsert({ key: "admin_proxy_key", value: apiKey }, { onConflict: "key" });

  if (err2) return { success: false, error: err2.message };

  return { success: true };
}
