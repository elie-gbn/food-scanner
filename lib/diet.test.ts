import { describe, expect, it } from "vitest";
import { customRule, highlightTerms, matchRule, ruleById } from "./diet";

const run = (id: string, text: string, tags: string[] = []) => matchRule(ruleById(id)!, { text, tags });
const strengths = (id: string, text: string, tags: string[] = []) => run(id, text, tags).map((m) => `${m.strength}:${m.term}`);

describe("pork-free", () => {
  it("does not read porcini as pork", () => {
    expect(run("pork-free", "porcini mushrooms, salt")).toEqual([]);
  });
  it("treats lard as pork", () => {
    expect(strengths("pork-free", "wheat flour, lard, salt")).toContain("contains:lard");
  });
  it("treats gelatin as possible pork, not certain", () => {
    expect(strengths("pork-free", "sugar, gelatin")).toEqual(["possible:gelatin"]);
  });
  it("maps E441 to possible pork, however it is written", () => {
    expect(strengths("pork-free", "stabiliser (E441)")).toContain("possible:E441");
    expect(strengths("pork-free", "stabiliser E-441")).toContain("possible:E441");
    expect(strengths("pork-free", "stabiliser e 441")).toContain("possible:E441");
  });
  it("does not match E441 inside a longer number", () => {
    expect(run("pork-free", "colour E4410")).toEqual([]);
  });
  it("finds pork by taxonomy tag", () => {
    expect(run("pork-free", "", ["en:pork"])).toEqual([{ strength: "contains", term: "pork", source: "tag" }]);
  });
  it("finds pork written in other languages", () => {
    expect(strengths("pork-free", "couenne de porc, saindoux")).toEqual(expect.arrayContaining(["contains:porc", "contains:couenne", "contains:saindoux"]));
    expect(strengths("pork-free", "Schweinefleisch")).toContain("contains:schweinefleisch");
  });
  it("finds Thai and Japanese terms as substrings", () => {
    expect(strengths("pork-free", "เนื้อหมูบด")).toContain("contains:หมู");
    expect(strengths("pork-free", "豚肉、塩")).toContain("contains:豚");
  });
  it("does not match 'ham' inside 'hamburger bun'", () => {
    expect(run("pork-free", "hamburger bun")).toEqual([]);
  });
  it("notes natural flavours as origin not stated", () => {
    expect(strengths("pork-free", "sugar, natural flavours")).toEqual(["note:natural flavours"]);
  });
  it("handles empty text and tags", () => {
    expect(run("pork-free", "")).toEqual([]);
  });
});

describe("halal", () => {
  it("flags mirin and wine", () => {
    expect(strengths("halal", "soy sauce, mirin")).toContain("contains:mirin");
    expect(strengths("halal", "white wine")).toContain("contains:wine");
  });
  it("does not read sugar alcohol as alcohol", () => {
    expect(run("halal", "sweetener (sugar alcohol), alcool de sucre de canne")).toEqual([]);
  });
  it("flags vanilla extract and ethanol as possible", () => {
    expect(strengths("halal", "vanilla extract")).toEqual(["possible:vanilla extract"]);
    expect(strengths("halal", "flavour carrier: ethanol")).toContain("possible:ethanol");
  });
  it("flags rennet as possible", () => {
    expect(strengths("halal", "milk, rennet")).toEqual(["possible:rennet"]);
  });
});

describe("vegetarian and vegan", () => {
  it("treats gelatin as certain for vegetarian", () => {
    expect(strengths("vegetarian", "sugar, gelatin")).toContain("contains:gelatin");
  });
  it("flags rennet as possible for vegetarian", () => {
    expect(strengths("vegetarian", "cheese cultures, rennet")).toEqual(["possible:rennet"]);
  });
  it("flags milk for vegan but not for vegetarian", () => {
    expect(strengths("vegan", "oat flakes, skimmed milk powder")).toContain("contains:milk");
    expect(run("vegetarian", "oat flakes, skimmed milk powder")).toEqual([]);
  });
  it("does not read cocoa butter or coconut milk as dairy", () => {
    expect(run("vegan", "cocoa butter, coconut milk, cream of tartar, eggplant")).toEqual([]);
  });
});

describe("allergens", () => {
  it("finds an allergen by its Open Food Facts tag", () => {
    expect(run("milk", "", ["en:milk"])).toEqual([{ strength: "contains", term: "milk", source: "tag" }]);
  });
  it("maps a multi-word allergen to its hyphenated tag", () => {
    expect(run("sesame seeds", "", ["en:sesame-seeds"])).toHaveLength(1);
  });
  it("does not read peanut butter as milk", () => {
    expect(run("milk", "peanut butter")).toEqual([]);
  });
});

describe("custom words", () => {
  it("matches the word as a whole word", () => {
    const rule = customRule("alcohol");
    expect(matchRule(rule, { text: "water, alcohol", tags: [] })).toHaveLength(1);
    expect(matchRule(rule, { text: "nonalcoholic", tags: [] })).toEqual([]);
  });
  it("escapes regex characters instead of running them", () => {
    expect(() => matchRule(customRule("(a+)+$["), { text: "aaaaaaaaaaaaaaaaaaaaaaaa!", tags: [] })).not.toThrow();
    expect(matchRule(customRule("a.c"), { text: "abc", tags: [] })).toEqual([]);
    expect(matchRule(customRule("a.c"), { text: "a.c", tags: [] })).toHaveLength(1);
  });
  it("matches a Thai word as a substring", () => {
    expect(matchRule(customRule("หมู"), { text: "เนื้อหมูบด", tags: [] })).toHaveLength(1);
  });
});

describe("highlightTerms", () => {
  it("splits text into plain and matched pieces", () => {
    expect(highlightTerms("flour, Lard, salt", ["lard"])).toEqual([{ text: "flour, ", hit: false }, { text: "Lard", hit: true }, { text: ", salt", hit: false }]);
  });
  it("does not highlight inside other words", () => {
    expect(highlightTerms("hamburger bun", ["ham"])).toEqual([{ text: "hamburger bun", hit: false }]);
  });
  it("highlights Thai terms as substrings", () => {
    expect(highlightTerms("เนื้อหมูบด", ["หมู"]).filter((piece) => piece.hit)).toEqual([{ text: "หมู", hit: true }]);
  });
  it("returns the whole text when there is nothing to highlight", () => {
    expect(highlightTerms("water", [])).toEqual([{ text: "water", hit: false }]);
  });
});
