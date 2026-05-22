import { useState, useEffect, useRef, useCallback } from "react";
import { getProfileStateAction, checkIsVipStandaloneAction } from "@/app/actions/auth";

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
let _cachedAdminModelEnabled = true;
let _loadingPromise: Promise<void> | null = null;
let _lastLoadTime = 0;
const CACHE_TTL = 30_000; // 30 seconds
let _hasMountedGlobal = false;

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    return typeof window !== "undefined" && _hasMountedGlobal ? _cachedProfile : null;
  });
  const [freeMode, setFreeMode] = useState(() => {
    return typeof window !== "undefined" && _hasMountedGlobal ? _cachedFreeMode : false;
  });
  const [adminModelEnabled, setAdminModelEnabled] = useState(() => {
    return typeof window !== "undefined" && _hasMountedGlobal ? _cachedAdminModelEnabled : true;
  });
  const [loading, setLoading] = useState(() => {
    return typeof window !== "undefined" && _hasMountedGlobal ? !_cachedProfile : true;
  });
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
        setAdminModelEnabled(_cachedAdminModelEnabled);
        setLoading(false);
      }
      return;
    }

    setLoading(true);

    _loadingPromise = (async () => {
      try {
        const res = await getProfileStateAction();
        if (res.success) {
          _cachedFreeMode = !!res.freeMode;
          _cachedAdminModelEnabled = !!res.adminModelEnabled;
          if (res.profile) {
            _cachedProfile = res.profile as UserProfile;
          } else {
            _cachedProfile = null;
          }
        }
        _lastLoadTime = Date.now();
      } catch (err) {
        console.error("Lỗi getProfileStateAction:", err);
      } finally {
        _loadingPromise = null;
      }
    })();

    await _loadingPromise;

    if (mountedRef.current) {
      setProfile(_cachedProfile);
      setFreeMode(_cachedFreeMode);
      setAdminModelEnabled(_cachedAdminModelEnabled);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    _hasMountedGlobal = true;
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

  return { profile, loading, isVip: isVip(), isAdmin: isUserAdmin(), freeMode, adminModelEnabled, loadProfile: () => loadProfile(true) };
}

export async function checkIsVipStandalone(): Promise<boolean> {
  if (_cachedProfile !== null) {
    if (_cachedFreeMode) return true;
    const email = _cachedProfile.email?.toLowerCase() || "";
    if (email === "nthanhnam2005@gmail.com" || email === "thanhxnam2005@gmail.com") return true;
    if (!_cachedProfile.vip_until) return false;
    return new Date(_cachedProfile.vip_until) > new Date();
  }

  // Fetch directly from server action
  const res = await checkIsVipStandaloneAction();
  return !!res.isVip;
}
