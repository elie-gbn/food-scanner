import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { offByBarcode, reportFromOff, reportFromUsda, SourceError, usdaByBarcode } from "@/lib/sources";
import type { FoodReport } from "@/lib/types";

/* Barcode lookup: Open Food Facts first, USDA FoodData Central as a fallback and second opinion. */

const cache = new Map<string, { at: number; body: FoodReport | null }>();
const TTL = 30 * 60 * 1000;
const NOT_FOUND = "Product not found in Open Food Facts or USDA FoodData Central. Try searching by name instead.";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("barcode")?.replace(/\D/g, "") ?? "";
  if (!/^\d{8,14}$/.test(code)) {
    return NextResponse.json({ error: "Enter an 8–14 digit barcode (EAN, UPC, or GTIN)." }, { status: 400 });
  }
  if (rateLimited(request, "barcode", 40)) return NextResponse.json({ error: "Too many lookups. Wait a minute and try again." }, { status: 429 });

  const cached = cache.get(code);
  if (cached && Date.now() - cached.at < TTL) {
    return cached.body ? NextResponse.json(cached.body) : NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  const errors: string[] = [];
  const keep = (error: unknown) => { errors.push(error instanceof SourceError ? error.message : "A data source did not respond."); return null; };
  const [off, usda] = await Promise.all([
    offByBarcode(code).then((product) => product ?? (code.length === 12 ? offByBarcode(`0${code}`) : null)).catch(keep),
    usdaByBarcode(code).catch(keep),
  ]);

  const report = off ? reportFromOff(off, usda, "barcode") : usda ? { ...reportFromUsda(usda, "barcode"), barcode: code } : null;
  if (!report && errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 502 });
  cache.set(code, { at: Date.now(), body: report });
  if (cache.size > 2000) cache.clear();
  if (!report) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  return NextResponse.json(report);
}
