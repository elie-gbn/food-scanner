import { NextResponse } from "next/server";
import { FOODS } from "@/data/foods";
import { findGeneric } from "@/lib/generic";
import { buildGenericReport } from "@/lib/report";

/* Nutrition for a food recognized on-device from a photo. The photo itself never reaches the server:
   the browser sends only the recognized food's name, which must be one of the known foods.
   The data comes from the bundled USDA FNDDS file, so this needs no API key and no network. */

const FOOD_BY_NAME = new Map(FOODS.map(([name, query, allergens]) => [name, { query, allergens }]));
const CONFIDENCE = ["high", "medium", "low", "picked"] as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get("food") ?? "";
  const confidence = CONFIDENCE.find((value) => value === params.get("confidence"));
  const food = FOOD_BY_NAME.get(name);
  if (!food) return NextResponse.json({ error: "Unknown food." }, { status: 400 });
  if (!confidence) return NextResponse.json({ error: "Invalid confidence." }, { status: 400 });

  const match = findGeneric(food.query);
  if (!match) return NextResponse.json({ error: `No nutrition data found for ${name}.` }, { status: 404 });
  return NextResponse.json({ ...buildGenericReport(match, { name, typicalAllergens: food.allergens, origin: "photo" }), photo: { confidence } });
}
