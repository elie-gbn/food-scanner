"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPTY_PROFILE, LEGACY_ALLERGEN_KEY, PROFILE_KEY, cleanProfile, loadProfile } from "@/lib/profile";
import type { Profile } from "@/lib/verdict";

/* localStorage can be blocked or full; the choice then still applies until the page closes. */
export function useProfile() {
  const [profile, setProfileState] = useState<Profile>(EMPTY_PROFILE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let current: string | null = null;
    let legacy: string | null = null;
    try {
      current = localStorage.getItem(PROFILE_KEY);
      legacy = localStorage.getItem(LEGACY_ALLERGEN_KEY);
    } catch {
      // Storage unavailable: start empty.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    setProfileState(loadProfile(current, legacy));
    setReady(true);
  }, []);

  const setProfile = useCallback((next: Profile) => {
    const clean = cleanProfile(next);
    setProfileState(clean);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(clean));
    } catch {
      // Not persisted.
    }
  }, []);

  return { profile, setProfile, ready };
}
