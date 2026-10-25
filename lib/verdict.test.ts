import { describe, expect, it } from "vitest";
import { buildGenericReport, buildReport, type FoodReport, type OffProduct } from "./report";
import { assessData, evaluate, headline, type Profile } from "./verdict";
import fixtures from "./fixtures/products.json";

const products = fixtures as unknown as Record<string, OffProduct & { code: string }>;
const report = (name: string, patch: Partial<FoodReport> = {}): FoodReport => ({ ...buildReport(products[name].code, products[name], null)!, ...patch });
const profile = (p: Partial<Profile>): Profile => ({ allergens: [], diets: [], custom: [], language: "en", ...p });
const find = (r: FoodReport, p: Partial<Profile>, id: string) => evaluate(r, profile(p)).find((f) => f.restriction === id)!;

describe("evaluate: real products", () => {
  it("pork-free: lard and pork rind in the ingredients contain pork", () => {
    const f = find(report("lentils-pork-lard"), { diets: ["pork-free"] }, "pork-free");
    expect(f.status).toBe("contains");
    expect(f.evidence).toContain("lard (in ingredients)");
  });

  it("pork-free: gelatin is may-contain because its source is not stated", () => {
    expect(find(report("gummy-worms"), { diets: ["pork-free"] }, "pork-free").status).toBe("may-contain");
  });

  it("vegetarian: the same gelatin is a certain hit", () => {
    expect(find(report("gummy-worms"), { diets: ["vegetarian"] }, "vegetarian").status).toBe("contains");
  });

  it("a halal label does not lower the gelatin finding; it only adds a note", () => {
    const f = find(report("halal-damla"), { diets: ["halal"] }, "halal");
    expect(f.status).toBe("may-contain");
    expect(f.notes).toContain("Labelled halal (not verified)");
  });

  it("a label never overrides a certain hit", () => {
    const labelled = report("lentils-pork-lard", { labels: ["en:halal"] });
    expect(find(labelled, { diets: ["halal"] }, "halal").status).toBe("contains");
  });

  it("an allergen declared by the database is a hit", () => {
    expect(find(report("cream-cheese"), { allergens: ["milk"] }, "milk").status).toBe("contains");
  });

  it("an allergen only in the trace warnings is may-contain", () => {
    const r = report("vegan-almond-drink", { allergens: [], ingredients: "water, oat", ingredientsEn: null, ingredientTags: ["en:water", "en:oat", "en:salt"], traces: ["en:peanuts"] });
    expect(find(r, { allergens: ["peanuts"] }, "peanuts").status).toBe("may-contain");
  });

  it("a plain product with a full ingredient list is clear", () => {
    expect(find(report("coca-cola"), { diets: ["pork-free"] }, "pork-free").status).toBe("clear");
  });

  it("a vegan drink with only plant ingredients is clear for vegan, with a note about the flavouring", () => {
    const f = find(report("vegan-almond-drink"), { diets: ["vegan"] }, "vegan");
    expect(f.status).toBe("clear");
    expect(f.notes).toContain("Flavourings are listed without saying what they come from.");
  });

  it("Open Food Facts calling a product non-vegan is a hit even when no rule matched", () => {
    const r = report("coca-cola", { analysis: ["en:non-vegan"] });
    expect(find(r, { diets: ["vegan"] }, "vegan").status).toBe("contains");
  });
});

describe("evaluate: never clear on thin data", () => {
  it("no ingredient data: everything is unknown", () => {
    const findings = evaluate(report("no-ingredients"), profile({ diets: ["pork-free", "vegan"], allergens: ["milk"], custom: ["alcohol"] }));
    expect(findings.map((f) => f.status)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
  });

  it("Nutella lists two ingredients but declares milk, nuts and soy: not clear for pork-free or vegan", () => {
    const r = report("nutella");
    const quality = assessData(r);
    expect(quality.state).toBe("incomplete");
    expect(quality.reasons.join(" ")).toMatch(/milk is declared/);
    expect(find(r, { diets: ["pork-free"] }, "pork-free").status).toBe("unknown");
    expect(find(r, { diets: ["vegan"] }, "vegan").status).toBe("unknown");
  });

  it("but the declared allergen on that same product is still a hit", () => {
    expect(find(report("nutella"), { allergens: ["milk"] }, "milk").status).toBe("contains");
  });

  it("an unfinished ingredient list is incomplete even when it looks long enough", () => {
    expect(find(report("coca-cola", { ingredientsComplete: false }), { diets: ["pork-free"] }, "pork-free").status).toBe("unknown");
  });

  it("one-ingredient products are treated as too short to trust", () => {
    const r = report("coca-cola", { ingredients: "water", ingredientsEn: null, ingredientTags: ["en:water"] });
    expect(find(r, { diets: ["pork-free"] }, "pork-free").status).toBe("unknown");
  });

  it("a non-English list that Open Food Facts did not analyse is incomplete", () => {
    const r = report("coca-cola", { lang: "th", ingredientTags: [], ingredientsEn: null, ingredients: "น้ำตาล, น้ำ, เกลือ" });
    expect(assessData(r).state).toBe("incomplete");
  });

  it("a hit on thin data is still reported as a hit", () => {
    const r = report("coca-cola", { ingredients: "lard", ingredientsEn: null, ingredientTags: ["en:lard"] });
    expect(find(r, { diets: ["pork-free"] }, "pork-free").status).toBe("contains");
  });
});

describe("evaluate: custom words, order and empty profile", () => {
  it("a custom word is matched in the ingredients", () => {
    expect(find(report("lentils-pork-lard"), { custom: ["saindoux"] }, "custom:saindoux").status).toBe("contains");
  });

  it("an empty profile returns no findings", () => {
    expect(evaluate(report("coca-cola"), profile({}))).toEqual([]);
  });

  it("findings are ordered contains, may-contain, unknown, clear", () => {
    const order = ["contains", "may-contain", "unknown", "clear"];
    const statuses = evaluate(report("cream-cheese"), profile({ diets: ["pork-free", "vegetarian", "vegan"], allergens: ["milk", "nuts"] })).map((f) => f.status);
    expect(statuses).toEqual([...statuses].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(statuses[0]).toBe("contains");
  });
});

describe("headline", () => {
  const head = (name: string, p: Partial<Profile>) => headline(evaluate(report(name), profile(p)));

  it("says what it contains, worst status first", () => {
    expect(head("lentils-pork-lard", { diets: ["pork-free"], allergens: ["nuts"] })).toEqual({ status: "contains", text: "Contains pork" });
  });
  it("joins several hits", () => {
    expect(head("lentils-pork-lard", { diets: ["pork-free"], allergens: ["milk"] })?.text).toBe("Contains pork and milk");
  });
  it("says may contain when the source is not stated", () => {
    expect(head("gummy-worms", { diets: ["pork-free"] })).toEqual({ status: "may-contain", text: "May contain pork" });
  });
  it("says it cannot tell when the data is thin, never 'safe'", () => {
    expect(head("nutella", { diets: ["vegan"] })).toEqual({ status: "unknown", text: "Can't tell: check the label" });
  });
  it("says 'not found in the listed ingredients' for a clean full list, never 'safe'", () => {
    const text = head("coca-cola", { diets: ["pork-free"] })?.text ?? "";
    expect(text).toBe("Not found in the listed ingredients");
    expect(text).not.toMatch(/safe/i);
  });
  it("has no headline for an empty profile", () => {
    expect(head("coca-cola", {})).toBeNull();
  });
});

describe("evaluate: generic foods (search and photo results)", () => {
  const generic = (name: string, typicalAllergens: string[]): FoodReport =>
    buildGenericReport({ id: 1, name, category: "", n: { 1008: 250 }, portions: [["typical serving", 100]] }, { typicalAllergens, origin: "photo" });

  it("a usual-recipe allergen is may-contain, never contains", () => {
    const f = find(generic("Pizza, cheese", ["gluten", "milk"]), { allergens: ["milk"] }, "milk");
    expect(f.status).toBe("may-contain");
    expect(f.evidence).toContain("milk (usually in this food)");
  });

  it("a forbidden word in the food name is may-contain from the usual recipe", () => {
    const f = find(generic("Bacon, NS as to type of meat, cooked", []), { diets: ["pork-free"] }, "pork-free");
    expect(f.status).toBe("may-contain");
    expect(f.evidence).toContain("bacon (usual recipe)");
  });

  it("animal allergens in the usual recipe flag vegan, and fish flags vegetarian", () => {
    expect(find(generic("Omelet", ["eggs"]), { diets: ["vegan"] }, "vegan").status).toBe("may-contain");
    expect(find(generic("Sushi, NFS", ["fish"]), { diets: ["vegetarian"] }, "vegetarian").status).toBe("may-contain");
    expect(find(generic("Omelet", ["eggs"]), { diets: ["vegetarian"] }, "vegetarian").status).toBe("unknown");
  });

  it("with nothing found it is unknown, because there is no ingredient list", () => {
    const r = generic("Banana, raw", []);
    expect(find(r, { allergens: ["milk"] }, "milk").status).toBe("unknown");
    expect(assessData(r).reasons[0]).toMatch(/typical recipe/);
  });
});

describe("evaluate: pepperoni", () => {
  it("is may-contain for pork-free, since pepperoni is usually but not always pork", () => {
    const pizza = buildGenericReport({ id: 2, name: "Pizza with pepperoni, stuffed crust", category: "", n: {}, portions: [] }, { origin: "photo" });
    expect(find(pizza, { diets: ["pork-free"] }, "pork-free").status).toBe("may-contain");
  });
});
