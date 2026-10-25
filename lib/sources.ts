import { detectAllergens, type AllergenId } from "@/lib/allergens";
import type { FoodReport, Nutrient } from "@/lib/types";

/* Live lookups against Open Food Facts and USDA FoodData Central, normalized into one FoodReport shape. */

export type OffProduct = {
  code?: string; product_name?: string; brands?: string; quantity?: string; serving_size?: string; image_front_url?: string;
  nutriscore_grade?: string; nova_group?: number; ingredients_text?: string; allergens_tags?: string[]; traces_tags?: string[];
  categories_tags?: string[]; product_quantity?: number | string; product_quantity_unit?: string;
  nutriments?: Record<string, number | string | undefined>;
};
export type UsdaFood = {
  fdcId: number; description: string; dataType: string; brandOwner?: string; brandName?: string; gtinUpc?: string; ingredients?: string;
  servingSize?: number; servingSizeUnit?: string; householdServingFullText?: string;
  foodMeasures?: { disseminationText?: string; gramWeight?: number }[];
  foodNutrients: { nutrientId: number; nutrientName: string; value: number; unitName: string }[];
};

export class SourceError extends Error {}

const OFF_FIELDS = "code,product_name,brands,quantity,serving_size,image_front_url,nutriscore_grade,nova_group,ingredients_text,allergens_tags,traces_tags,categories_tags,product_quantity,product_quantity_unit,nutriments";
const OFF_HEADERS = { "User-Agent": "labelens-food-scanner/1.0 (https://github.com/elie-gbn/food-scanner)" };
const GENERIC_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];

/* [key, label, unit shown, multiplier from OFF grams, USDA nutrient ids in preference order] */
const NUTRIENTS: [string, string, string, number, number[]][] = [
  ["energy-kcal", "Energy", "kcal", 1, [1008, 2047, 2048]],
  ["fat", "Fat", "g", 1, [1004]],
  ["saturated-fat", "Saturated fat", "g", 1, [1258]],
  ["trans-fat", "Trans fat", "g", 1, [1257]],
  ["cholesterol", "Cholesterol", "mg", 1000, [1253]],
  ["carbohydrates", "Carbohydrates", "g", 1, [1005]],
  ["sugars", "Sugars", "g", 1, [2000, 1063]],
  ["added-sugars", "Added sugars", "g", 1, [1235]],
  ["fiber", "Fiber", "g", 1, [1079]],
  ["proteins", "Protein", "g", 1, [1003]],
  ["salt", "Salt", "g", 1, []],
  ["sodium", "Sodium", "mg", 1000, [1093]],
  ["potassium", "Potassium", "mg", 1000, [1092]],
  ["calcium", "Calcium", "mg", 1000, [1087]],
  ["iron", "Iron", "mg", 1000, [1089]],
  ["vitamin-c", "Vitamin C", "mg", 1000, [1162]],
  ["vitamin-b6", "Vitamin B6", "mg", 1000, [1175]],
  ["vitamin-b12", "Vitamin B12", "µg", 1_000_000, [1178]],
  ["taurine", "Taurine", "mg", 1000, []],
];
const USDA_CAFFEINE = 1057;

const CAFFEINE_WORDS: [RegExp, string][] = [
  [/caf+e[ií]n|koffein|cafe[íi]na/i, "caffeine"],
  [/coffee|caf[eé](?![a-zà-ÿ])|espresso|kaffee|latte|cappuccino/i, "coffee"],
  [/guaran[aá]/i, "guarana"],
  [/matcha/i, "matcha"],
  [/yerba|mat[eé] extract/i, "yerba mate"],
  [/green tea|black tea|\btea\b|tea extract|\bt[eé] (verde|negro)/i, "tea"],
  [/\bkola\b|cola nut|\bcola\b/i, "cola"],
  [/coco(a|a powder)|cacao|chocolate/i, "cocoa"],
];

const num = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};
const round = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;
const usdaKey = () => process.env.USDA_API_KEY || "DEMO_KEY";
const caffeineSignals = (text: string) => CAFFEINE_WORDS.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);

async function getJson<T>(url: string, init: RequestInit, source: string): Promise<T | null> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(9000) });
  if (response.status === 429) throw new SourceError(`${source} rate limit reached${source === "USDA" ? " (set USDA_API_KEY for a higher limit)" : ""}.`);
  if (response.status === 404) return null;
  if (!response.ok) throw new SourceError(`${source} returned ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function offByBarcode(code: string) {
  const data = await getJson<{ status?: number; product?: OffProduct }>(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`, { headers: OFF_HEADERS }, "Open Food Facts");
  return data?.status === 1 && data.product ? { ...data.product, code } : null;
}

/** Uses Open Food Facts' search service (the legacy search.pl endpoint is frequently overloaded). */
export async function offSearch(query: string, limit = 5) {
  const params = new URLSearchParams({ q: query, page_size: String(limit), sort_by: "-unique_scans_n", fields: `${OFF_FIELDS},ingredients_text_en` });
  const data = await getJson<{ hits?: (Omit<OffProduct, "brands"> & { brands?: string | string[]; ingredients_text_en?: string })[] }>(`https://search.openfoodfacts.org/search?${params}`, { headers: OFF_HEADERS }, "Open Food Facts");
  return (data?.hits ?? [])
    .filter((product) => product.code && product.product_name)
    .map(({ brands, ingredients_text_en, ...product }): OffProduct => ({
      ...product,
      brands: Array.isArray(brands) ? brands.join(", ") : brands,
      ingredients_text: product.ingredients_text || ingredients_text_en,
    }));
}

export async function usdaByBarcode(code: string) {
  const upc = code.length === 13 && code.startsWith("0") ? code.slice(1) : code;
  const foods = await usdaSearch(`gtinUpc:${upc}`, ["Branded"], 1);
  const food = foods[0];
  return food && food.gtinUpc?.replace(/^0+/, "") === upc.replace(/^0+/, "") ? food : null;
}

export async function usdaSearch(query: string, dataTypes: string[] = GENERIC_TYPES, limit = 5) {
  const params = new URLSearchParams({ api_key: usdaKey(), query, pageSize: String(limit), dataType: dataTypes.join(",") });
  const data = await getJson<{ foods?: UsdaFood[] }>(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, {}, "USDA");
  return data?.foods ?? [];
}

const usdaUrl = (fdcId: number) => `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`;
const offUrl = (code: string) => `https://world.openfoodfacts.org/product/${code}`;

function usdaValues(food: UsdaFood | null) {
  const values = new Map<number, number>();
  for (const item of food?.foodNutrients ?? []) values.set(item.nutrientId, item.value);
  return values;
}

/** USDA serving in grams/ml: branded label serving, else the first household measure. */
function usdaServing(food: UsdaFood | null): { grams: number; label: string } | null {
  if (!food) return null;
  if (food.servingSize && /^(g|ml|grm|mlt)$/i.test(food.servingSizeUnit ?? "")) {
    return { grams: food.servingSize, label: food.householdServingFullText ? `${food.householdServingFullText} (${food.servingSize} ${food.servingSizeUnit?.toLowerCase().replace(/^grm$/, "g").replace(/^mlt$/, "ml")})` : `${food.servingSize} ${food.servingSizeUnit?.toLowerCase()}` };
  }
  const measure = food.foodMeasures?.find((item) => item.gramWeight && item.disseminationText && !/quantity not specified/i.test(item.disseminationText));
  return measure?.gramWeight ? { grams: measure.gramWeight, label: `${measure.disseminationText} (${Math.round(measure.gramWeight)} g)` } : null;
}

/** Build a report from an Open Food Facts product, filling gaps from a matching USDA record. */
export function reportFromOff(off: OffProduct, usda: UsdaFood | null, origin: FoodReport["origin"]): FoodReport {
  const code = off.code ?? usda?.gtinUpc ?? "";
  const n = off.nutriments ?? {};
  const fallback = usdaValues(usda);
  const serving = usdaServing(usda);
  const liquid = /ml|cl|\bl\b/i.test(String(off.product_quantity_unit ?? off.quantity ?? "")) || /ml/i.test(usda?.servingSizeUnit ?? "");

  function value(key: string, multiplier: number, ids: number[]) {
    const off100 = num(n[`${key}_100g`]);
    const offServing = num(n[`${key}_serving`]);
    if (off100 !== null || offServing !== null) {
      return { per100: off100 === null ? null : off100 * multiplier, perServing: offServing === null ? null : offServing * multiplier };
    }
    // USDA already reports in the display unit (mg, µg, kcal, g).
    const usda100 = ids.map((id) => fallback.get(id)).find((item) => item !== undefined);
    if (usda100 === undefined) return { per100: null, perServing: null };
    return { per100: usda100, perServing: serving ? usda100 * serving.grams / 100 : null };
  }

  const nutrients = NUTRIENTS
    .map(([key, label, unit, multiplier, ids]) => ({ key, label, unit, ...value(key, multiplier, ids) }))
    .map((item) => ({ ...item, per100: round(item.per100), perServing: round(item.perServing) }))
    .filter((item) => item.per100 !== null || item.perServing !== null);

  const caffeine = value("caffeine", 1000, [USDA_CAFFEINE]);
  const containerSize = num(off.product_quantity);
  const ingredients = off.ingredients_text?.trim() || usda?.ingredients?.trim() || null;
  const name = off.product_name?.trim() || usda?.description || "Unnamed product";

  return {
    id: code ? `off:${code}` : `usda:${usda?.fdcId}`,
    origin,
    barcode: code || null,
    name,
    brand: off.brands?.split(",")[0]?.trim() || usda?.brandName || usda?.brandOwner || null,
    image: off.image_front_url ?? null,
    quantity: off.quantity ?? null,
    servingSize: off.serving_size ?? serving?.label ?? null,
    basis: liquid ? "100 ml" : "100 g",
    nutriscore: off.nutriscore_grade && /^[a-e]$/.test(off.nutriscore_grade) ? off.nutriscore_grade : null,
    nova: num(off.nova_group),
    ingredients,
    allergens: detectAllergens({ tags: off.allergens_tags, traces: off.traces_tags, ingredients }),
    caffeine: {
      per100: round(caffeine.per100),
      perServing: round(caffeine.perServing),
      perContainer: caffeine.per100 !== null && containerSize ? round(caffeine.per100 * containerSize / 100) : null,
      signals: caffeineSignals(`${ingredients ?? ""} ${(off.categories_tags ?? []).join(" ")} ${name}`),
    },
    nutrients,
    sources: [{ name: "Open Food Facts", url: offUrl(code) }, ...(usda ? [{ name: "USDA FoodData Central", url: usdaUrl(usda.fdcId) }] : [])],
    checkedAt: new Date().toISOString(),
  };
}

/** Build a report from a USDA record alone. `portion` overrides the serving (used for photo estimates). */
export function reportFromUsda(food: UsdaFood, origin: FoodReport["origin"], extra: { portion?: { grams: number; label: string }; likelyAllergens?: AllergenId[]; name?: string } = {}): FoodReport {
  const values = usdaValues(food);
  const serving = extra.portion ?? usdaServing(food);
  const liquid = /ml/i.test(food.servingSizeUnit ?? "") || /beverage|coffee|tea|juice|soda|milk\b|drink|water/i.test(food.description);
  const scale = (per100: number | null) => per100 === null || !serving ? null : round(per100 * serving.grams / 100);

  const nutrients: Nutrient[] = NUTRIENTS.map(([key, label, unit, , ids]) => {
    let per100 = ids.map((id) => values.get(id)).find((item) => item !== undefined) ?? null;
    if (key === "salt") {
      const sodium = values.get(1093);
      per100 = sodium === undefined ? null : sodium * 2.5 / 1000;
    }
    return { key, label, unit, per100: round(per100), perServing: scale(per100) };
  }).filter((item) => item.per100 !== null);

  const caffeine100 = values.get(USDA_CAFFEINE) ?? null;
  const ingredients = food.ingredients?.trim() || null;
  const name = extra.name ?? food.description;

  return {
    id: `usda:${food.fdcId}`,
    origin,
    barcode: food.gtinUpc ?? null,
    name,
    brand: food.brandName || food.brandOwner || null,
    image: null,
    quantity: null,
    servingSize: serving?.label ?? null,
    basis: liquid ? "100 ml" : "100 g",
    nutriscore: null,
    nova: null,
    ingredients,
    allergens: detectAllergens({ ingredients: ingredients ?? (food.dataType === "Branded" ? null : food.description), likely: extra.likelyAllergens }),
    caffeine: {
      per100: round(caffeine100),
      perServing: scale(caffeine100),
      perContainer: null,
      signals: caffeineSignals(`${ingredients ?? ""} ${food.description}`),
    },
    nutrients,
    sources: [{ name: food.dataType === "Branded" ? "USDA FoodData Central (branded)" : `USDA FoodData Central (${food.dataType})`, url: usdaUrl(food.fdcId) }],
    checkedAt: new Date().toISOString(),
  };
}
