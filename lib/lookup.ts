import type { Profile } from "./verdict";

/* What to show when a barcode lookup does not produce a product. */

export type LookupFailure = {
  kind: "not-found" | "unreachable" | "busy" | "invalid";
  code: string;
  /** The server's own explanation, when it gave one. */
  detail: string | null;
  /** Worth offering a "try again" button. */
  retry: boolean;
};

/** status is null when the request itself failed (offline, server down). */
export function classifyLookup(status: number | null, code: string, detail: string | null = null): LookupFailure {
  if (status === 404) return { kind: "not-found", code, detail, retry: false };
  if (status === 400) return { kind: "invalid", code, detail, retry: false };
  if (status === 429) return { kind: "busy", code, detail, retry: true };
  return { kind: "unreachable", code, detail, retry: true };
}

const DIET_WORDS: Record<string, string[]> = {
  "pork-free": ["pork", "lard", "bacon", "ham", "gelatin"],
  halal: ["pork", "gelatin", "alcohol", "wine", "rennet"],
  vegetarian: ["meat", "fish", "gelatin", "lard"],
  vegan: ["milk", "egg", "honey", "meat", "fish", "gelatin"],
};

/** Words to look for on a printed label when the app has no data, taken from the person's own choices. */
export function watchFor(profile: Profile): string[] {
  const words = [...profile.diets.flatMap((id) => DIET_WORDS[id] ?? []), ...profile.allergens, ...profile.custom];
  return [...new Set(words)];
}
