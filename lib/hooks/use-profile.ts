import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  vip_until: string | null;
  avatar_url: string | null;
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [freeMode, setFreeMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const loadProfile = async () => {
    setLoading(true);
    
    // Fetch global free mode setting
    const { data: settingsData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "free_mode")
      .single();
      
    if (settingsData && settingsData.value === "true") {
      setFreeMode(true);
    } else {
      setFreeMode(false);
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      
      if (data) {
        setProfile(data as UserProfile);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const isVip = () => {
    if (freeMode) return true;
    if (profile?.email === "nthanhnam2005@gmail.com" || profile?.email === "thanhxnam2005@gmail.com") return true;
    if (!profile?.vip_until) return false;
    return new Date(profile.vip_until) > new Date();
  };

  return { profile, loading, isVip: isVip(), freeMode, loadProfile };
}
