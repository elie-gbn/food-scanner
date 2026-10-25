import { describe, expect, it } from "vitest";
import { buildGenericReport, buildReport, type OffProduct, type UsdaFood } from "./report";
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

describe("buildGenericReport", () => {
  const coffee = { id: 2710375, name: "Coffee, brewed", category: "Coffee", n: { 1008: 1, 1057: 40, 1093: 2 }, portions: [["typical serving", 360]] as [string, number][] };

  it("scales caffeine and nutrients to the typical serving", () => {
    const r = buildGenericReport(coffee);
    expect(r.caffeine).toMatchObject({ per100: 40, perServing: 144 });
    expect(r.servingSize).toBe("typical serving (360 g)");
    expect(r.basis).toBe("100 ml");
    expect(r.nutrients.find((n) => n.key === "salt")?.per100).toBe(0.01);
  });

  it("uses the display name, keeps the USDA name for matching, and has no ingredient list", () => {
    const r = buildGenericReport(coffee, { name: "Black coffee", typicalAllergens: [], origin: "photo" });
    expect(r).toMatchObject({ name: "Black coffee", origin: "photo", id: "photo:2710375", ingredients: null, generic: { description: "Coffee, brewed" } });
  });
});
