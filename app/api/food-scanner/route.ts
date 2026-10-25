import { NextResponse } from "next/server";
import { buildReport, type FoodReport, type OffProduct, type UsdaFood } from "@/lib/report";

/* Live product lookup: Open Food Facts first, USDA FoodData Central as a fallback and second opinion. */

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

/* Both fetchers return null only when the source answered "no such product", and throw when it could not be asked. */
async function fetchOff(code: string) {
  const fields = "product_name,brands,quantity,serving_size,image_front_url,nutriscore_grade,nova_group,ingredients_text,ingredients_text_en,ingredients_tags,allergens_tags,traces_tags,labels_tags,ingredients_analysis_tags,states_tags,lang,categories_tags,product_quantity,product_quantity_unit,nutriments";
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`, {
    headers: { "User-Agent": "portfolio-food-scanner/1.0 (https://github.com/eliegussin)" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Open Food Facts answered ${response.status}`);
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
  if (!response.ok) throw new Error(`USDA answered ${response.status}`);
  const data = await response.json() as { foods?: UsdaFood[] };
  const food = data.foods?.[0];
  return food && food.gtinUpc?.replace(/^0+/, "") === upc.replace(/^0+/, "") ? food : null;
}

const NOT_FOUND = { error: "Product not found in Open Food Facts or USDA FoodData Central." };

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("barcode")?.replace(/\D/g, "") ?? "";
  if (!/^\d{8,14}$/.test(code)) {
    return NextResponse.json({ error: "Enter an 8–14 digit barcode (EAN, UPC, or GTIN)." }, { status: 400 });
  }
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(client)) return NextResponse.json({ error: "Too many lookups. Wait a minute and try again." }, { status: 429 });

  const cached = cache.get(code);
  if (cached && Date.now() - cached.at < TTL) {
    return cached.body ? NextResponse.json(cached.body) : NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const [off, usda] = await Promise.allSettled([
    fetchOff(code).then((product) => product ?? (code.length === 12 ? fetchOff(`0${code}`) : null)),
    fetchUsda(code),
  ]);
  const report = buildReport(code, off.status === "fulfilled" ? off.value : null, usda.status === "fulfilled" ? usda.value : null);
  // Only remember answers where both sources replied; a timeout must not turn into "not found" for half an hour.
  if (off.status === "fulfilled" && usda.status === "fulfilled") {
    cache.set(code, { at: Date.now(), body: report });
    if (cache.size > 2000) cache.clear();
  }
  if (!report) {
    if (off.status === "rejected") return NextResponse.json({ error: "Could not reach Open Food Facts. Try again in a moment." }, { status: 502 });
    // USDA is only the second source (and its shared demo key is rate-limited), so say what was actually checked.
    if (usda.status === "rejected") return NextResponse.json({ error: "Not found in Open Food Facts. USDA FoodData Central could not be checked right now." }, { status: 404 });
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
  return NextResponse.json(report);
}
