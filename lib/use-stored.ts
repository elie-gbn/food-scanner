"use client";

import { useCallback, useEffect, useState } from "react";

/** State persisted in localStorage. Reads after mount so server and client render the same first frame. */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Storage can be blocked (private mode); fall back to in-memory state.
    }
    setLoaded(true);
  }, [key]);

  const update = useCallback((next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Quota exceeded or storage blocked; keep the in-memory value.
      }
      return resolved;
    });
  }, [key]);

  return [value, update, loaded] as const;
}
