import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  vip_until: string | null;
  avatar_url: string | null;
  admin_model_quota?: number;
  admin_assigned_model?: string | null;
}

// Module-level cache to prevent redundant Supabase calls across components
let _cachedProfile: UserProfile | null = null;
let _cachedFreeMode = false;
let _loadingPromise: Promise<void> | null = null;
let _lastLoadTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(_cachedProfile);
  const [freeMode, setFreeMode] = useState(_cachedFreeMode);
  const [loading, setLoading] = useState(!_cachedProfile);
  const mountedRef = useRef(true);

  const loadProfile = useCallback(async (force = false) => {
    // Use cache if fresh enough and not forced
    if (!force && _cachedProfile && Date.now() - _lastLoadTime < CACHE_TTL) {
      setProfile(_cachedProfile);
      setFreeMode(_cachedFreeMode);
      setLoading(false);
      return;
    }

    // Deduplicate concurrent calls
    if (_loadingPromise && !force) {
      await _loadingPromise;
      if (mountedRef.current) {
        setProfile(_cachedProfile);
        setFreeMode(_cachedFreeMode);
        setLoading(false);
      }
      return;
    }

    setLoading(true);

    _loadingPromise = (async () => {
      try {
        const supabase = createClient();

        // Fetch both in parallel for speed
        const [settingsResult, userResult] = await Promise.all([
          supabase.from("app_settings").select("value").eq("key", "free_mode").single(),
          supabase.auth.getUser(),
        ]);

        const fm = settingsResult.data?.value === "true";
        _cachedFreeMode = fm;

        const user = userResult.data?.user;
        if (user) {
          const { data } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();

          if (data) {
            _cachedProfile = { ...data, email: data.email || user.email } as UserProfile;
          }
        }

        _lastLoadTime = Date.now();
      } finally {
        _loadingPromise = null;
      }
    })();

    await _loadingPromise;

    if (mountedRef.current) {
      setProfile(_cachedProfile);
      setFreeMode(_cachedFreeMode);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadProfile();
    return () => { mountedRef.current = false; };
  }, [loadProfile]);

  const isUserAdmin = () => {
    const email = profile?.email?.toLowerCase();
    const admins = [
      "nthanhnam2005@gmail.com",
      "thanhxnam2005@gmail.com"
    ];
    return admins.includes(email || "");
  };

  const isVip = () => {
    if (freeMode) return true;
    if (isUserAdmin()) return true;
    if (!profile?.vip_until) return false;
    return new Date(profile.vip_until) > new Date();
  };

  return { profile, loading, isVip: isVip(), isAdmin: isUserAdmin(), freeMode, loadProfile: () => loadProfile(true) };
}
