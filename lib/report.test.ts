import { describe, expect, it } from "vitest";
import { buildReport, type OffProduct, type UsdaFood } from "./report";
import fixtures from "./fixtures/products.json";

const products = fixtures as unknown as Record<string, OffProduct & { code: string }>;

describe("buildReport", () => {
  it("carries the ingredient, trace, label and analysis tags through", () => {
    const report = buildReport("3017620422003", products["nutella"], null)!;
    expect(report.ingredientTags).toContain("en:palm-oil");
    expect(report.labels).toContain("en:vegetarian");
    expect(report.analysis).toContain("en:maybe-vegan");
    expect(report.allergens).toEqual(["milk", "nuts", "soybeans"]);
    expect(report.lang).toBe("en");
    expect(report.ingredientsEn).toBe("sugar, palm oil");
  });

  it("keeps traces, including ones written in another language", () => {
    const report = buildReport("5411188112709", products["vegan-almond-drink"], null)!;
    expect(report.traces).toEqual(["de:Schalenfrüchte (keine Erdnüsse)"]);
  });

  it("reads whether the ingredient list is finished", () => {
    expect(buildReport("1", { ...products["nutella"], states_tags: ["en:ingredients-completed"] }, null)!.ingredientsComplete).toBe(true);
    expect(buildReport("1", { ...products["nutella"], states_tags: ["en:ingredients-to-be-completed"] }, null)!.ingredientsComplete).toBe(false);
    expect(buildReport("1", { ...products["nutella"], states_tags: [] }, null)!.ingredientsComplete).toBeNull();
  });

  it("returns empty arrays, never undefined, when a product has no tags", () => {
    const report = buildReport("6111099005495", products["no-ingredients"], null)!;
    expect(report.ingredients).toBeNull();
    for (const list of [report.ingredientTags, report.traces, report.labels, report.analysis, report.allergens]) expect(list).toEqual([]);
  });

  it("builds a USDA-only report with the USDA ingredient text and empty tags", () => {
    const usda: UsdaFood = { fdcId: 1, description: "GUMMY BEARS", ingredients: "CORN SYRUP, GELATIN", foodNutrients: [] };
    const report = buildReport("0123456789012", null, usda)!;
    expect(report.ingredients).toBe("CORN SYRUP, GELATIN");
    expect(report.ingredientTags).toEqual([]);
    expect(report.ingredientsComplete).toBeNull();
    expect(report.sources.map((s) => s.name)).toEqual(["USDA FoodData Central"]);
  });

  it("returns null when neither source knows the product", () => {
    expect(buildReport("1", null, null)).toBeNull();
  });
});
