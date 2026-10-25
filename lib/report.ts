/* Turns raw Open Food Facts / USDA records into the report the app shows. Pure: no network. */

export type OffProduct = {
  product_name?: string; brands?: string; quantity?: string; serving_size?: string; image_front_url?: string;
  nutriscore_grade?: string; nova_group?: number; ingredients_text?: string; allergens_tags?: string[];
  categories_tags?: string[]; product_quantity?: number | string; product_quantity_unit?: string;
  nutriments?: Record<string, number | string | undefined>;
  ingredients_text_en?: string; ingredients_tags?: string[]; traces_tags?: string[]; labels_tags?: string[];
  ingredients_analysis_tags?: string[]; states_tags?: string[]; lang?: string;
};
export type UsdaFood = {
  fdcId: number; description: string; brandOwner?: string; brandName?: string; gtinUpc?: string; ingredients?: string;
  servingSize?: number; servingSizeUnit?: string; householdServingFullText?: string;
  foodNutrients: { nutrientId: number; nutrientName: string; value: number; unitName: string }[];
};

export type Nutrient = { key: string; label: string; unit: string; per100: number | null; perServing: number | null };
export type FoodReport = {
  barcode: string;
  name: string;
  brand: string | null;
  image: string | null;
  quantity: string | null;
  servingSize: string | null;
  basis: "100 g" | "100 ml";
  nutriscore: string | null;
  nova: number | null;
  ingredients: string | null;
  /** English text of the ingredients when the database has it. */
  ingredientsEn: string | null;
  /** Language-neutral Open Food Facts ingredient ids, e.g. "en:pork". Empty when only USDA knew the product. */
  ingredientTags: string[];
  allergens: string[];
  /** "May contain" tags, as Open Food Facts spells them (some keep their original language). */
  traces: string[];
  labels: string[];
  /** Open Food Facts' own vegan / vegetarian guesses, e.g. "en:maybe-vegan". */
  analysis: string[];
  /** Whether Open Food Facts says the ingredient list is finished. null when it does not say. */
  ingredientsComplete: boolean | null;
  /** Language the product label is written in. */
  lang: string | null;
  caffeine: {
    per100: number | null;
    perServing: number | null;
    perContainer: number | null;
    /** Ingredients that usually contain caffeine, found in the ingredient list. */
    signals: string[];
  };
  nutrients: Nutrient[];
  sources: { name: string; url: string }[];
  checkedAt: string;
  /** Stable id for saving: `off:<barcode>`, `usda:<fdcId>` or `photo:<fdcId>`. Older saved reports may lack it. */
  id?: string;
  /** How the food was found. Missing means a barcode scan. */
  origin?: "barcode" | "search" | "photo";
  /** Set for USDA generic foods (a typical recipe, not a labelled product): there is no ingredient list. */
  generic?: { description: string; typicalAllergens: string[] };
  /** Set when the food was recognized from a photo. "picked" means the person chose it from the alternatives. */
  photo?: { confidence: "high" | "medium" | "low" | "picked" };
};

/** A USDA FNDDS generic food as bundled in data/generic-foods.json (nutrient values per 100 g, keyed by USDA nutrient id). */
export type GenericFood = { id: number; name: string; category: string; n: Record<string, number>; portions: [string, number][] };

/* [key, label, unit shown, multiplier from the source's grams] */
const OFF_NUTRIENTS: [string, string, string, number][] = [
  ["energy-kcal", "Energy", "kcal", 1],
  ["fat", "Fat", "g", 1],
  ["saturated-fat", "Saturated fat", "g", 1],
  ["trans-fat", "Trans fat", "g", 1],
  ["cholesterol", "Cholesterol", "mg", 1000],
  ["carbohydrates", "Carbohydrates", "g", 1],
  ["sugars", "Sugars", "g", 1],
  ["added-sugars", "Added sugars", "g", 1],
  ["fiber", "Fiber", "g", 1],
  ["proteins", "Protein", "g", 1],
  ["salt", "Salt", "g", 1],
  ["sodium", "Sodium", "mg", 1000],
  ["potassium", "Potassium", "mg", 1000],
  ["calcium", "Calcium", "mg", 1000],
  ["iron", "Iron", "mg", 1000],
  ["vitamin-c", "Vitamin C", "mg", 1000],
  ["vitamin-b6", "Vitamin B6", "mg", 1000],
  ["vitamin-b12", "Vitamin B12", "µg", 1_000_000],
  ["taurine", "Taurine", "mg", 1000],
];

/* USDA nutrient id → OFF key; USDA branded values are already per 100 g/ml in their own unit. */
const USDA_IDS: Record<number, string> = {
  1008: "energy-kcal", 1004: "fat", 1258: "saturated-fat", 1257: "trans-fat", 1253: "cholesterol", 1005: "carbohydrates",
  2000: "sugars", 1235: "added-sugars", 1079: "fiber", 1003: "proteins", 1093: "sodium", 1092: "potassium",
  1087: "calcium", 1089: "iron", 1162: "vitamin-c", 1175: "vitamin-b6", 1178: "vitamin-b12", 1057: "caffeine",
};

const CAFFEINE_WORDS: [RegExp, string][] = [
  [/caf+e[ií]n|koffein|cafe[íi]na/i, "caffeine"],
  [/coffee|caf[eé](?![a-zà-ÿ])|espresso|kaffee/i, "coffee"],
  [/guaran[aá]/i, "guarana"],
  [/matcha/i, "matcha"],
  [/yerba|mat[eé] extract/i, "yerba mate"],
  [/green tea|black tea|tea extract|\bt[eé] (verde|negro)/i, "tea"],
  [/\bkola\b|cola nut/i, "kola nut"],
  [/coco(a|a powder)|cacao|chocolate/i, "cocoa"],
];

const num = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};
const round = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;

function ingredientsComplete(states: string[] | undefined) {
  if (states?.includes("en:ingredients-completed")) return true;
  if (states?.includes("en:ingredients-to-be-completed")) return false;
  return null;
}

export function buildReport(code: string, off: OffProduct | null, usda: UsdaFood | null): FoodReport | null {
  if (!off && !usda) return null;
  const n = off?.nutriments ?? {};
  const liquid = /ml|cl|l\b/i.test(String(off?.product_quantity_unit ?? off?.quantity ?? "")) || /ml/i.test(usda?.servingSizeUnit ?? "");
  const usdaValues = new Map<string, number>();
  for (const item of usda?.foodNutrients ?? []) {
    const key = USDA_IDS[item.nutrientId];
    if (key) usdaValues.set(key, item.value);
  }
  const usdaServing = usda?.servingSize && /^(g|ml|grm|mlt)$/i.test(usda.servingSizeUnit ?? "") ? usda.servingSize : null;

  function value(key: string, multiplier: number) {
    const off100 = num(n[`${key}_100g`]);
    const offServing = num(n[`${key}_serving`]);
    if (off100 !== null || offServing !== null) {
      return { per100: off100 === null ? null : off100 * multiplier, perServing: offServing === null ? null : offServing * multiplier };
    }
    const usda100 = usdaValues.get(key);
    if (usda100 === undefined) return { per100: null, perServing: null };
    // USDA reports mg/µg for minerals and vitamins; OFF multipliers assume grams, so use USDA values as-is.
    return { per100: usda100, perServing: usdaServing ? usda100 * usdaServing / 100 : null };
  }

  const nutrients = OFF_NUTRIENTS
    .map(([key, label, unit, multiplier]) => {
      const { per100, perServing } = value(key, multiplier);
      return { key, label, unit, per100: round(per100), perServing: round(perServing) };
    })
    .filter((item) => item.per100 !== null || item.perServing !== null);

  const caffeineValue = value("caffeine", 1000);
  const containerSize = num(off?.product_quantity);
  const ingredients = off?.ingredients_text?.trim() || usda?.ingredients?.trim() || null;
  const haystack = `${ingredients ?? ""} ${(off?.categories_tags ?? []).join(" ")} ${off?.product_name ?? usda?.description ?? ""}`;
  const signals = CAFFEINE_WORDS.filter(([pattern]) => pattern.test(haystack)).map(([, label]) => label);

  const sources = [];
  if (off) sources.push({ name: "Open Food Facts", url: `https://world.openfoodfacts.org/product/${code}` });
  if (usda) sources.push({ name: "USDA FoodData Central", url: `https://fdc.nal.usda.gov/food-details/${usda.fdcId}/nutrients` });

  return {
    barcode: code,
    name: off?.product_name?.trim() || usda?.description || "Unnamed product",
    brand: off?.brands?.split(",")[0]?.trim() || usda?.brandName || usda?.brandOwner || null,
    image: off?.image_front_url ?? null,
    quantity: off?.quantity ?? null,
    servingSize: off?.serving_size ?? usda?.householdServingFullText ?? (usdaServing ? `${usdaServing} ${usda?.servingSizeUnit?.toLowerCase()}` : null),
    basis: liquid ? "100 ml" : "100 g",
    nutriscore: off?.nutriscore_grade && /^[a-e]$/.test(off.nutriscore_grade) ? off.nutriscore_grade : null,
    nova: num(off?.nova_group),
    ingredients,
    ingredientsEn: off?.ingredients_text_en?.trim() || null,
    ingredientTags: off?.ingredients_tags ?? [],
    allergens: (off?.allergens_tags ?? []).map((tag) => tag.replace(/^\w+:/, "").replace(/-/g, " ")),
    traces: off?.traces_tags ?? [],
    labels: off?.labels_tags ?? [],
    analysis: off?.ingredients_analysis_tags ?? [],
    ingredientsComplete: ingredientsComplete(off?.states_tags),
    lang: off?.lang ?? null,
    caffeine: {
      per100: round(caffeineValue.per100),
      perServing: round(caffeineValue.perServing),
      perContainer: caffeineValue.per100 !== null && containerSize ? round(caffeineValue.per100 * containerSize / 100) : null,
      signals,
    },
    nutrients,
    sources,
    checkedAt: new Date().toISOString(),
  };
}

const DRINK = /beverage|coffee|tea|juice|soda|soft drink|milk|drink|water|beer|wine|cocktail|smoothie|shake|kombucha|lemonade/i;

/** Report for a USDA generic food. `name` replaces the USDA description (e.g. the photo label), and
 *  `typicalAllergens` lists what the usual recipe contains, as diet.ts allergen names. */
export function buildGenericReport(food: GenericFood, extra: { name?: string; typicalAllergens?: string[]; origin?: "search" | "photo" } = {}): FoodReport {
  const serving = food.portions[0] ?? null;
  const per100 = (id: number) => food.n[id] ?? null;
  const nutrients: Nutrient[] = OFF_NUTRIENTS.map(([key, label, unit]) => {
    const id = Number(Object.entries(USDA_IDS).find(([, name]) => name === key)?.[0]);
    const sodium = per100(1093);
    const value = key === "salt" ? (sodium === null ? null : sodium * 2.5 / 1000) : Number.isNaN(id) ? null : per100(id);
    return { key, label, unit, per100: round(value), perServing: value === null || !serving ? null : round(value * serving[1] / 100) };
  }).filter((item) => item.per100 !== null);
  const caffeine100 = per100(1057);
  const name = extra.name ?? food.name;
  const signals = CAFFEINE_WORDS.filter(([pattern]) => pattern.test(`${food.name} ${food.category}`)).map(([, label]) => label);

  return {
    id: `${extra.origin === "photo" ? "photo" : "usda"}:${food.id}`,
    origin: extra.origin ?? "search",
    barcode: "",
    name,
    brand: null,
    image: null,
    quantity: null,
    servingSize: serving ? `${serving[0]} (${Math.round(serving[1])} g)` : null,
    basis: DRINK.test(`${food.name} ${food.category}`) ? "100 ml" : "100 g",
    nutriscore: null,
    nova: null,
    ingredients: null,
    ingredientsEn: null,
    ingredientTags: [],
    allergens: [],
    traces: [],
    labels: [],
    analysis: [],
    ingredientsComplete: null,
    lang: null,
    caffeine: {
      per100: round(caffeine100),
      perServing: caffeine100 === null || !serving ? null : round(caffeine100 * serving[1] / 100),
      perContainer: null,
      signals,
    },
    nutrients,
    sources: [{ name: "USDA FoodData Central (FNDDS)", url: `https://fdc.nal.usda.gov/food-details/${food.id}/nutrients` }],
    checkedAt: new Date().toISOString(),
    generic: { description: food.name, typicalAllergens: extra.typicalAllergens ?? [] },
  };
}

/** Saving key for a report; barcode results built before ids existed fall back to the barcode. */
export const reportId = (report: FoodReport) => report.id ?? `off:${report.barcode}`;
