import { NextResponse } from "next/server";
import { genericAsUsda, searchGeneric } from "@/lib/generic";
import { rateLimited } from "@/lib/rate-limit";
import { offSearch, reportFromOff, reportFromUsda, SourceError, usdaSearch } from "@/lib/sources";

/* Name search for foods without a barcode: bundled USDA generic foods (with caffeine data for coffee, tea,
   chocolate…), plus packaged products from Open Food Facts, plus USDA branded foods when a key is set. */

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (query.length < 2) return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });
  if (rateLimited(request, "search", 20)) return NextResponse.json({ error: "Too many searches. Wait a minute and try again." }, { status: 429 });

  const generic = searchGeneric(query, 6).map((food) => reportFromUsda(genericAsUsda(food), "search"));
  const errors: string[] = [];
  const keep = (error: unknown) => { errors.push(error instanceof SourceError ? error.message : "A data source did not respond."); return []; };
  const [packaged, branded] = await Promise.all([
    offSearch(query, 5).catch(keep),
    // The shared DEMO_KEY runs out quickly, so branded USDA results are only added with a personal key.
    process.env.USDA_API_KEY ? usdaSearch(query, ["Branded"], 3).catch(keep) : Promise.resolve([]),
  ]);

  const results = [
    ...generic,
    ...packaged.map((product) => reportFromOff(product, null, "search")),
    ...branded.map((food) => reportFromUsda(food, "search")),
  ].filter((report, index, all) => all.findIndex((other) => other.id === report.id) === index);

  if (!results.length && errors.length) return NextResponse.json({ error: [...new Set(errors)].join(" ") }, { status: 502 });
  return NextResponse.json({ results, warnings: [...new Set(errors)] });
}
