import { NextResponse } from "next/server";
import { searchGeneric } from "@/lib/generic";
import { rateLimited } from "@/lib/rate-limit";
import { buildGenericReport, buildReport, type FoodReport } from "@/lib/report";
import { offSearch, SourceError, usdaBrandedSearch } from "@/lib/search-sources";

/* Name search for foods without a barcode: bundled USDA generic foods (with caffeine data for coffee, tea,
   energy drinks, chocolate…), packaged products from Open Food Facts, and USDA branded foods when a key is set. */

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (query.length < 2) return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });
  if (rateLimited(request, "search", 20)) return NextResponse.json({ error: "Too many searches. Wait a minute and try again." }, { status: 429 });

  const generic = searchGeneric(query, 6).map((food) => buildGenericReport(food));
  const errors: string[] = [];
  const keep = (error: unknown) => { errors.push(error instanceof SourceError ? error.message : "A data source did not respond."); return []; };
  const key = process.env.USDA_API_KEY;
  const [packaged, branded] = await Promise.all([
    offSearch(query, 5).catch(keep),
    // The shared DEMO_KEY runs out quickly, so branded USDA results are only added with a personal key.
    key ? usdaBrandedSearch(query, key).catch(keep) : Promise.resolve([]),
  ]);

  const results: FoodReport[] = [
    ...generic,
    ...packaged.map((product) => ({ ...buildReport(product.code, product, null)!, id: `off:${product.code}`, origin: "search" as const })),
    ...branded.map((food) => ({ ...buildReport(food.gtinUpc ?? "", null, food)!, id: `usda:${food.fdcId}`, origin: "search" as const })),
  ].filter((report, index, all) => all.findIndex((other) => other.id === report.id) === index);

  if (!results.length && errors.length) return NextResponse.json({ error: [...new Set(errors)].join(" ") }, { status: 502 });
  return NextResponse.json({ results, warnings: [...new Set(errors)] });
}
