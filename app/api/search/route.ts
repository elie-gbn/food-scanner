import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { offSearch, reportFromOff, reportFromUsda, SourceError, usdaSearch } from "@/lib/sources";

/* Name search for foods without a barcode: USDA generic foods (which carry caffeine data for coffee, tea, chocolate…) plus packaged products. */

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (query.length < 2) return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });
  if (rateLimited(request, "search", 20)) return NextResponse.json({ error: "Too many searches. Wait a minute and try again." }, { status: 429 });

  const errors: string[] = [];
  const keep = (error: unknown) => { errors.push(error instanceof SourceError ? error.message : "A data source did not respond."); return []; };
  const [generic, branded, packaged] = await Promise.all([
    usdaSearch(query, undefined, 6).catch(keep),
    usdaSearch(query, ["Branded"], 3).catch(keep),
    offSearch(query, 5).catch(keep),
  ]);

  const results = [
    ...generic.map((food) => reportFromUsda(food, "search")),
    ...packaged.map((product) => reportFromOff(product, null, "search")),
    ...branded.map((food) => reportFromUsda(food, "search")),
  ].filter((report, index, all) => all.findIndex((other) => other.id === report.id) === index);

  if (!results.length && errors.length) return NextResponse.json({ error: [...new Set(errors)].join(" ") }, { status: 502 });
  return NextResponse.json({ results, warnings: [...new Set(errors)] });
}
