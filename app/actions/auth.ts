"use server";

import { createClient } from "@/lib/supabase/server";

export async function loginAction(email: string, password: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data.user) {
      return { success: false, error: "Đăng nhập thất bại" };
    }

    // Generate unique session token for single-session enforcement
    const sessionToken = crypto.randomUUID();

    // Save session token to profiles table
    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert({ id: data.user.id, active_session_id: sessionToken }, { onConflict: "id" });

    if (upsertError) {
      console.error("Lỗi cập nhật active_session_id:", upsertError);
    }

    return {
      success: true,
      user: data.user,
      sessionToken,
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Lỗi hệ thống" };
  }
}

export async function registerAction(email: string, password: string, displayName: string) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName.trim(),
        },
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Lỗi hệ thống" };
  }
}

export async function signOutAction() {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Lỗi hệ thống" };
  }
}

export async function getProfileStateAction() {
  try {
    const supabase = await createClient();

    // Fetch app settings and current user in parallel
    const [settingsResult, userResult] = await Promise.all([
      supabase.from("app_settings").select("key, value").in("key", ["free_mode", "admin_model_enabled"]),
      supabase.auth.getUser(),
    ]);

    const settingsData = settingsResult.data || [];
    const freeMode = settingsData.find((s) => s.key === "free_mode")?.value === "true";
    const adminModelEnabled = settingsData.find((s) => s.key === "admin_model_enabled")?.value !== "false";

    const user = userResult.data?.user;
    let profile = null;

    if (user) {
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (data) {
        profile = { ...data, email: data.email || user.email };
        // Auto-heal missing display_name from auth metadata
        if (!data.display_name && user.user_metadata?.display_name) {
          const healedName = user.user_metadata.display_name;
          const { error: healError } = await supabase
            .from("profiles")
            .update({ display_name: healedName })
            .eq("id", user.id);
          if (!healError) {
            profile.display_name = healedName;
          }
        }
      } else if (profileError && (profileError.code === "PGRST116" || profileError.message.includes("0 rows"))) {
        // Auto-create missing profile row
        const defaultName = user.user_metadata?.display_name || user.email?.split("@")[0] || "Người dùng";
        const { data: newProfile, error: insertError } = await supabase
          .from("profiles")
          .insert({
            id: user.id,
            email: user.email,
            display_name: defaultName,
          })
          .select()
          .single();

        if (!insertError && newProfile) {
          profile = { ...newProfile, email: newProfile.email || user.email };
        }
      }
    }

    return {
      success: true,
      freeMode,
      adminModelEnabled,
      profile,
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Lỗi tải thông tin" };
  }
}

export async function checkActiveSessionAction(userId: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("active_session_id")
      .eq("id", userId)
      .single();

    if (error) {
      return { success: false, error: { code: error.code, message: error.message } };
    }

    return { success: true, active_session_id: data?.active_session_id };
  } catch (err: any) {
    return { success: false, error: { message: err.message || "Lỗi hệ thống" } };
  }
}

export async function checkIsVipStandaloneAction() {
  try {
    const supabase = await createClient();
    const [settingsResult, userResult] = await Promise.all([
      supabase.from("app_settings").select("key, value").eq("key", "free_mode").maybeSingle(),
      supabase.auth.getUser(),
    ]);

    if (settingsResult.data?.value === "true") return { isVip: true };

    const user = userResult.data?.user;
    if (!user) return { isVip: false };

    const email = user.email?.toLowerCase() || "";
    if (email === "nthanhnam@gmail.com") return { isVip: true };

    const { data } = await supabase
      .from("profiles")
      .select("vip_until")
      .eq("id", user.id)
      .single();

    if (!data?.vip_until) return { isVip: false };
    return { isVip: new Date(data.vip_until) > new Date() };
  } catch (e) {
    return { isVip: false };
  }
}

export async function updateAvatarAction(avatarUrl: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Chưa đăng nhập" };

    const { error, status } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", user.id);

    if (error) {
      return { success: false, error: error.message, code: error.code, status };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Lỗi hệ thống" };
  }
}

export async function updateProfileAction(displayName: string, avatarUrl: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Chưa đăng nhập" };

    const { error, status } = await supabase
      .from("profiles")
      .update({ 
        display_name: displayName.trim(),
        avatar_url: avatarUrl 
      })
      .eq("id", user.id);

    if (error) {
      return { success: false, error: error.message, code: error.code, status };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Lỗi hệ thống" };
  }
}
