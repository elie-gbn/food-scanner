/* The 14 major allergens (EU list, which covers the US "Big 9"), with how each is detected. */

export type AllergenId =
  | "milk" | "eggs" | "peanuts" | "tree-nuts" | "gluten" | "soy" | "fish" | "crustaceans"
  | "molluscs" | "sesame" | "mustard" | "celery" | "lupin" | "sulphites";

/** contains: declared by the label data · traces: "may contain" · ingredient: matched in the ingredient text · likely: inferred from a photo */
export type AllergenStatus = "contains" | "traces" | "ingredient" | "likely";
export type AllergenFinding = { id: AllergenId; status: AllergenStatus; evidence?: string };

export const ALLERGENS: { id: AllergenId; label: string; offTags: string[]; pattern: RegExp }[] = [
  { id: "milk", label: "Milk", offTags: ["en:milk"], pattern: /\bmilk|\blait\b|cream|butter|cheese|whey|casein|lactose|yog(h)?urt|\bghee\b/i },
  { id: "eggs", label: "Eggs", offTags: ["en:eggs"], pattern: /\beggs?\b|albumin|\bovo|mayonnaise/i },
  { id: "peanuts", label: "Peanuts", offTags: ["en:peanuts"], pattern: /peanut|groundnut|arachis/i },
  { id: "tree-nuts", label: "Tree nuts", offTags: ["en:nuts"], pattern: /almond|hazelnut|walnut|cashew|pecan|pistachio|macadamia|brazil nut|praline|\bnuts?\b/i },
  { id: "gluten", label: "Gluten", offTags: ["en:gluten"], pattern: /wheat|gluten|barley|\brye\b|spelt|\bmalt|semolina|couscous|farro|\boats?\b/i },
  { id: "soy", label: "Soy", offTags: ["en:soybeans"], pattern: /\bsoy|soja|soya|edamame|tofu/i },
  { id: "fish", label: "Fish", offTags: ["en:fish"], pattern: /\bfish|anchov|salmon|tuna|\bcod\b|sardine|tilapia|trout|mackerel/i },
  { id: "crustaceans", label: "Crustaceans", offTags: ["en:crustaceans"], pattern: /shrimp|prawn|crab|lobster|crayfish|crustacean/i },
  { id: "molluscs", label: "Molluscs", offTags: ["en:molluscs"], pattern: /mussel|oyster|\bclams?\b|scallop|squid|calamari|octopus|mollus/i },
  { id: "sesame", label: "Sesame", offTags: ["en:sesame-seeds"], pattern: /sesame|tahini/i },
  { id: "mustard", label: "Mustard", offTags: ["en:mustard"], pattern: /mustard/i },
  { id: "celery", label: "Celery", offTags: ["en:celery"], pattern: /celery|celeriac/i },
  { id: "lupin", label: "Lupin", offTags: ["en:lupin"], pattern: /lupin/i },
  { id: "sulphites", label: "Sulphites", offTags: ["en:sulphur-dioxide-and-sulphites"], pattern: /sulph?ites?|sulfur dioxide|sulphur dioxide|\bE ?22[0-8]\b/i },
];

export const ALLERGEN_IDS = ALLERGENS.map((allergen) => allergen.id);
export const allergenLabel = (id: AllergenId) => ALLERGENS.find((allergen) => allergen.id === id)?.label ?? id;

/** Combine declared tags, "may contain" tags, ingredient-text matches, and photo guesses; the strongest status wins. */
export function detectAllergens({ tags = [], traces = [], ingredients, likely = [] }: { tags?: string[]; traces?: string[]; ingredients?: string | null; likely?: AllergenId[] }) {
  const findings: AllergenFinding[] = [];
  for (const allergen of ALLERGENS) {
    if (allergen.offTags.some((tag) => tags.includes(tag))) {
      findings.push({ id: allergen.id, status: "contains" });
      continue;
    }
    const match = ingredients?.match(allergen.pattern);
    if (match) {
      findings.push({ id: allergen.id, status: "ingredient", evidence: match[0].toLowerCase() });
      continue;
    }
    if (allergen.offTags.some((tag) => traces.includes(tag))) findings.push({ id: allergen.id, status: "traces" });
    else if (likely.includes(allergen.id)) findings.push({ id: allergen.id, status: "likely" });
  }
  return findings;
}
