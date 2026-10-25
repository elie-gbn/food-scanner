import { describe, expect, it } from "vitest";
import { buildReport, type FoodReport, type OffProduct } from "./report";
import { ingredientView, translateUrl } from "./translate";
import fixtures from "./fixtures/products.json";

const products = fixtures as unknown as Record<string, OffProduct & { code: string }>;
const report = (name: string, patch: Partial<FoodReport> = {}): FoodReport => ({ ...buildReport(products[name].code, products[name], null)!, ...patch });

describe("ingredientView", () => {
  it("offers an English version when it differs from the original", () => {
    const view = ingredientView(report("lentils-pork-lard", { ingredientsEn: "water, lentils, pork rind, lard" }));
    expect(view.english).toBe("water, lentils, pork rind, lard");
    expect(view.original).toMatch(/couenne de porc/);
  });
  it("drops the English version when it is the same text", () => {
    const view = ingredientView(report("nutella"));
    expect(view.english).toBeNull();
    expect(view.original).toBe("sugar, palm oil");
  });
  it("ignores case and spacing when comparing", () => {
    expect(ingredientView(report("coca-cola", { ingredients: "Water,  Sugar", ingredientsEn: "water, sugar" })).english).toBeNull();
  });
  it("handles a product with no ingredients", () => {
    const view = ingredientView(report("no-ingredients"));
    expect(view.original).toBeNull();
    expect(view.english).toBeNull();
  });
});

describe("translateUrl", () => {
  it("builds a translator link with the text encoded", () => {
    const parsed = new URL(translateUrl("couenne de porc & saindoux", "es")!);
    expect(parsed.hostname).toBe("translate.google.com");
    expect(parsed.searchParams.get("tl")).toBe("es");
    expect(parsed.searchParams.get("text")).toBe("couenne de porc & saindoux");
  });
  it("gives no link for English, an unknown language, or empty text", () => {
    expect(translateUrl("lard", "en")).toBeNull();
    expect(translateUrl("lard", "xx")).toBeNull();
    expect(translateUrl("  ", "es")).toBeNull();
    expect(translateUrl(null, "es")).toBeNull();
  });
  it("cuts very long lists so the link stays usable", () => {
    const text = new URL(translateUrl("a".repeat(5000), "fr")!).searchParams.get("text")!;
    expect(text).toHaveLength(1500);
  });
});
