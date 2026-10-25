import { NextResponse } from "next/server";

/* Live product lookup: Open Food Facts first, USDA FoodData Central as a fallback and second opinion. */

type OffProduct = {
  product_name?: string; brands?: string; quantity?: string; serving_size?: string; image_front_url?: string;
  nutriscore_grade?: string; nova_group?: number; ingredients_text?: string; allergens_tags?: string[];
  categories_tags?: string[]; product_quantity?: number | string; product_quantity_unit?: string;
  nutriments?: Record<string, number | string | undefined>;
};
type UsdaFood = {
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
  allergens: string[];
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
};

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

const cache = new Map<string, { at: number; body: FoodReport | null }>();
const TTL = 30 * 60 * 1000;
const recentRequests = new Map<string, number[]>();

function rateLimited(key: string) {
  const now = Date.now();
  const recent = (recentRequests.get(key) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  recentRequests.set(key, recent);
  if (recentRequests.size > 5000) recentRequests.clear();
  return recent.length > 40;
}

const num = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};
const round = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;

async function fetchOff(code: string) {
  const fields = "product_name,brands,quantity,serving_size,image_front_url,nutriscore_grade,nova_group,ingredients_text,allergens_tags,categories_tags,product_quantity,product_quantity_unit,nutriments";
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`, {
    headers: { "User-Agent": "portfolio-food-scanner/1.0 (https://github.com/eliegussin)" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const data = await response.json() as { status?: number; product?: OffProduct };
  return data.status === 1 && data.product ? data.product : null;
}

async function fetchUsda(code: string) {
  const key = process.env.USDA_API_KEY || "DEMO_KEY";
  const upc = code.length === 13 && code.startsWith("0") ? code.slice(1) : code;
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}&dataType=Branded&pageSize=1&query=gtinUpc:${upc}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const data = await response.json() as { foods?: UsdaFood[] };
  const food = data.foods?.[0];
  return food && food.gtinUpc?.replace(/^0+/, "") === upc.replace(/^0+/, "") ? food : null;
}

function buildReport(code: string, off: OffProduct | null, usda: UsdaFood | null): FoodReport | null {
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
    allergens: (off?.allergens_tags ?? []).map((tag) => tag.replace(/^\w+:/, "").replace(/-/g, " ")),
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

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("barcode")?.replace(/\D/g, "") ?? "";
  if (!/^\d{8,14}$/.test(code)) {
    return NextResponse.json({ error: "Enter an 8–14 digit barcode (EAN, UPC, or GTIN)." }, { status: 400 });
  }
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(client)) return NextResponse.json({ error: "Too many lookups. Wait a minute and try again." }, { status: 429 });

  const cached = cache.get(code);
  if (cached && Date.now() - cached.at < TTL) {
    return cached.body ? NextResponse.json(cached.body) : NextResponse.json({ error: "Product not found in Open Food Facts or USDA FoodData Central." }, { status: 404 });
  }

  const [off, usda] = await Promise.all([
    fetchOff(code).then((product) => product ?? (code.length === 12 ? fetchOff(`0${code}`) : null)).catch(() => null),
    fetchUsda(code).catch(() => null),
  ]);
  const report = buildReport(code, off, usda);
  cache.set(code, { at: Date.now(), body: report });
  if (cache.size > 2000) cache.clear();
  if (!report) return NextResponse.json({ error: "Product not found in Open Food Facts or USDA FoodData Central." }, { status: 404 });
  return NextResponse.json(report);
}
