import { NextResponse } from "next/server";
import { FOODS } from "@/data/foods";
import { findGeneric, genericAsUsda } from "@/lib/generic";
import { reportFromUsda } from "@/lib/sources";

/* Nutrition for a food recognized on-device from a photo. The photo itself never reaches the server:
   the browser sends only the recognized food's name, which must be one of the known foods.
   The data comes from the bundled USDA FNDDS file, so this needs no API key and no network. */

const FOOD_BY_NAME = new Map(FOODS.map(([name, query, allergens]) => [name, { query, allergens }]));

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get("food") ?? "";
  const confidence = params.get("confidence");
  const food = FOOD_BY_NAME.get(name);
  if (!food) return NextResponse.json({ error: "Unknown food." }, { status: 400 });
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low" && confidence !== "picked") return NextResponse.json({ error: "Invalid confidence." }, { status: 400 });

  const match = findGeneric(food.query);
  if (!match) return NextResponse.json({ error: `No nutrition data found for ${name}.` }, { status: 404 });
  const report = reportFromUsda(genericAsUsda(match), "photo", { name, likelyAllergens: food.allergens });
  const grams = report.servingSize?.match(/\(([\d.]+) g\)/)?.[1];
  return NextResponse.json({
    ...report,
    id: `photo:${match.id}`,
    photo: { portion: report.servingSize ?? "100 g", grams: grams ? Number(grams) : 100, confidence },
  });
}
