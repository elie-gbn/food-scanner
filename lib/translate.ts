import type { FoodReport } from "./report";

/* Reading ingredients in another language. English comes from the database; any other language is a link to a
   machine translator, because a wrong translation of an ingredient is worse than showing the original. */

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "sv", name: "Swedish" },
  { code: "ar", name: "Arabic" },
  { code: "zh-CN", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "th", name: "Thai" },
];

/* Translator links carry the text in the URL, so keep it short enough for browsers and servers. */
const MAX_TEXT = 1500;
const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export type IngredientView = { original: string | null; english: string | null; originalLang: string | null };

/** The original list, plus an English version when the database has one that differs. */
export function ingredientView(report: FoodReport): IngredientView {
  const original = report.ingredients?.trim() || null;
  const english = report.ingredientsEn?.trim() || null;
  return { original, english: english && (!original || !same(english, original)) ? english : null, originalLang: report.lang };
}

export function translateUrl(text: string | null, language: string): string | null {
  if (!text?.trim() || language === "en" || !LANGUAGES.some((entry) => entry.code === language)) return null;
  const params = new URLSearchParams({ sl: "auto", tl: language, text: text.trim().slice(0, MAX_TEXT), op: "translate" });
  return `https://translate.google.com/?${params.toString()}`;
}
