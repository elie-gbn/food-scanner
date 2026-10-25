import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, cleanProfile, isEmptyProfile, loadProfile } from "./profile";

describe("loadProfile", () => {
  it("returns an empty profile when nothing is saved", () => {
    expect(loadProfile(null, null)).toEqual(EMPTY_PROFILE);
  });
  it("keeps the allergens saved before diets existed", () => {
    expect(loadProfile(null, '["milk","eggs"]').allergens).toEqual(["milk", "eggs"]);
  });
  it("prefers the new profile over the old list", () => {
    const profile = loadProfile('{"allergens":["fish"],"diets":["halal"],"custom":[],"language":"en"}', '["milk"]');
    expect(profile).toEqual({ allergens: ["fish"], diets: ["halal"], custom: [], language: "en" });
  });
  it("survives broken JSON in either place", () => {
    expect(loadProfile("{not json", "also not json")).toEqual(EMPTY_PROFILE);
  });
  it("survives JSON of the wrong shape", () => {
    expect(loadProfile('"hello"', "42")).toEqual(EMPTY_PROFILE);
    expect(loadProfile('{"allergens":"milk","diets":7,"custom":null}', null)).toEqual(EMPTY_PROFILE);
  });
});

describe("cleanProfile", () => {
  it("drops unknown allergens and diets", () => {
    const profile = cleanProfile({ allergens: ["milk", "pizza"], diets: ["vegan", "keto"] });
    expect(profile.allergens).toEqual(["milk"]);
    expect(profile.diets).toEqual(["vegan"]);
  });
  it("trims custom words, drops blanks and duplicates, and caps length and count", () => {
    const many = Array.from({ length: 30 }, (_, i) => `word${i}`);
    expect(cleanProfile({ custom: ["  alcohol ", "", "   ", "alcohol", "x".repeat(41)] }).custom).toEqual(["alcohol"]);
    expect(cleanProfile({ custom: many }).custom).toHaveLength(20);
  });
  it("defaults the language to English", () => {
    expect(cleanProfile({ language: 5 }).language).toBe("en");
  });
});

describe("isEmptyProfile", () => {
  it("is true only when nothing is chosen", () => {
    expect(isEmptyProfile(EMPTY_PROFILE)).toBe(true);
    expect(isEmptyProfile({ ...EMPTY_PROFILE, custom: ["pork"] })).toBe(false);
  });
});
