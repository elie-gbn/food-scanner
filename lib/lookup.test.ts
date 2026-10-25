import { describe, expect, it } from "vitest";
import { classifyLookup, watchFor } from "./lookup";

describe("classifyLookup", () => {
  it("404 is a product the databases do not have, with no retry", () => {
    expect(classifyLookup(404, "123")).toMatchObject({ kind: "not-found", retry: false });
  });
  it("502 and a failed request are 'unreachable', and can be retried", () => {
    expect(classifyLookup(502, "123")).toMatchObject({ kind: "unreachable", retry: true });
    expect(classifyLookup(null, "123")).toMatchObject({ kind: "unreachable", retry: true });
  });
  it("429 is busy and can be retried", () => {
    expect(classifyLookup(429, "123")).toMatchObject({ kind: "busy", retry: true });
  });
  it("400 is an invalid barcode", () => {
    expect(classifyLookup(400, "abc")).toMatchObject({ kind: "invalid", retry: false });
  });
  it("never confuses a failed lookup with not found", () => {
    for (const status of [null, 500, 502, 503]) expect(classifyLookup(status, "1").kind).not.toBe("not-found");
  });
});

describe("watchFor", () => {
  it("lists label words for each diet, allergen and custom word, once each", () => {
    const words = watchFor({ diets: ["pork-free", "halal"], allergens: ["milk"], custom: ["shellfish"], language: "en" });
    expect(words).toEqual(["pork", "lard", "bacon", "ham", "gelatin", "alcohol", "wine", "rennet", "milk", "shellfish"]);
  });
  it("is empty for an empty profile", () => {
    expect(watchFor({ diets: [], allergens: [], custom: [], language: "en" })).toEqual([]);
  });
});
