/*
 * Builds data/generic-foods.json from USDA's free FNDDS ("Survey Foods") bulk download, so generic-food
 * search and photo nutrition need no API key and no network calls.
 *
 *   1. Download and unzip the JSON release from https://fdc.nal.usda.gov/download-datasets/
 *      (FoodData_Central_survey_food_json_<date>.zip)
 *   2. npm run usda -- path/to/surveyDownload.json
 */
import { readFileSync, writeFileSync } from "node:fs";

type SurveyFood = {
  fdcId: number;
  description: string;
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
  foodNutrients: { nutrient: { id: number }; amount?: number }[];
  foodPortions: { portionDescription: string; gramWeight: number; sequenceNumber?: number }[];
};

/* Nutrient ids the app displays (see lib/sources.ts). */
const KEEP = new Set([1008, 1004, 1258, 1257, 1253, 1005, 2000, 1235, 1079, 1003, 1093, 1092, 1087, 1089, 1162, 1175, 1178, 1057]);

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run usda -- path/to/surveyDownload.json");
  process.exit(1);
}

const foods = (JSON.parse(readFileSync(path, "utf8")) as { SurveyFoods: SurveyFood[] }).SurveyFoods;
const out = foods.map((food) => {
  const n: Record<number, number> = {};
  for (const item of food.foodNutrients) {
    if (KEEP.has(item.nutrient.id) && typeof item.amount === "number") n[item.nutrient.id] = Math.round(item.amount * 1000) / 1000;
  }
  // "Quantity not specified" is FNDDS's typical serving; list it first, then the household measures.
  const portions = food.foodPortions
    .filter((portion) => portion.gramWeight > 0)
    .sort((a, b) => Number(/quantity not specified/i.test(b.portionDescription)) - Number(/quantity not specified/i.test(a.portionDescription)) || (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .slice(0, 4)
    .map((portion): [string, number] => [/quantity not specified/i.test(portion.portionDescription) ? "typical serving" : portion.portionDescription, portion.gramWeight]);
  return { id: food.fdcId, name: food.description, category: food.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? "", n, portions };
});

writeFileSync("data/generic-foods.json", JSON.stringify(out));
console.log(`Wrote ${out.length} foods (${out.filter((food) => food.n[1057] > 0).length} with caffeine) to data/generic-foods.json.`);
