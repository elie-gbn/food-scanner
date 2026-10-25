import { describe, expect, it } from "vitest";
import { FOODS } from "../data/foods";
import generic from "../data/generic-foods.json";
import embeddings from "../public/food-embeddings.json";
import { ALLERGENS } from "./diet";
import { MODEL_ID } from "./recognize-config";

describe("photo food list", () => {
  it("uses only allergen names the verdict engine knows", () => {
    const unknown = FOODS.flatMap(([, , allergens]) => allergens).filter((name) => !ALLERGENS.includes(name));
    expect(unknown).toEqual([]);
  });

  it("has unique names", () => {
    expect(new Set(FOODS.map(([name]) => name)).size).toBe(FOODS.length);
  });

  it("matches the pre-computed embeddings (run `npm run embeddings` after editing data/foods.ts)", () => {
    expect(embeddings.model).toBe(MODEL_ID);
    expect(FOODS.map(([name]) => name).filter((name) => !embeddings.labels.includes(name))).toEqual([]);
  });

  it("points exact USDA names at foods that exist in the bundled data", () => {
    const names = new Set((generic as { name: string }[]).map((food) => food.name.toLowerCase()));
    const exact = FOODS.filter(([, query]) => /[A-Z,]/.test(query));
    expect(exact.length).toBeGreaterThan(50);
    expect(exact.filter(([, query]) => !names.has(query.toLowerCase())).map(([name]) => name)).toEqual([]);
  });
});
