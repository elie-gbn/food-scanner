import { ALLERGENS, DIETS } from "./diet";
import { LANGUAGES } from "./translate";
import type { Profile } from "./verdict";

/* The profile lives only in this browser's localStorage. It is never sent to the server. */

export const PROFILE_KEY = "labelens-profile";
/** Where allergens were saved before diets existed. */
export const LEGACY_ALLERGEN_KEY = "labelens-my-allergens";
export const EMPTY_PROFILE: Profile = { allergens: [], diets: [], custom: [], language: "en" };

const MAX_CUSTOM = 20;
const MAX_WORD = 40;

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const unique = (items: string[]) => [...new Set(items)];

export function cleanProfile(value: unknown): Profile {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const dietIds = DIETS.map((diet) => diet.id);
  return {
    allergens: unique(strings(raw.allergens)).filter((name) => ALLERGENS.includes(name)),
    diets: unique(strings(raw.diets)).filter((id) => dietIds.includes(id)),
    custom: unique(strings(raw.custom).map((word) => word.trim()).filter((word) => word && word.length <= MAX_WORD)).slice(0, MAX_CUSTOM),
    language: LANGUAGES.some((entry) => entry.code === raw.language) ? (raw.language as string) : "en",
  };
}

function parse(text: string | null): unknown {
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Reads the saved profile, falling back to the old allergen-only list. Bad or missing data gives an empty profile. */
export function loadProfile(current: string | null, legacy: string | null): Profile {
  const saved = parse(current);
  if (saved && typeof saved === "object") return cleanProfile(saved);
  return cleanProfile({ allergens: parse(legacy) });
}

export const isEmptyProfile = (profile: Profile) => !profile.allergens.length && !profile.diets.length && !profile.custom.length;
