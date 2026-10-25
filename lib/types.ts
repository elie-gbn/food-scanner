import type { AllergenFinding } from "@/lib/allergens";

export type Nutrient = { key: string; label: string; unit: string; per100: number | null; perServing: number | null };

export type FoodReport = {
  /** Stable id used for saving: the barcode, `usda:<fdcId>`, or `off:<code>`. */
  id: string;
  /** How the product was identified. */
  origin: "barcode" | "search" | "photo";
  barcode: string | null;
  name: string;
  brand: string | null;
  image: string | null;
  quantity: string | null;
  servingSize: string | null;
  basis: "100 g" | "100 ml";
  nutriscore: string | null;
  nova: number | null;
  ingredients: string | null;
  allergens: AllergenFinding[];
  caffeine: {
    per100: number | null;
    perServing: number | null;
    perContainer: number | null;
    /** Ingredients that usually contain caffeine, found in the ingredient list or name. */
    signals: string[];
  };
  nutrients: Nutrient[];
  sources: { name: string; url: string }[];
  /** Set when the food was identified from a photo: what the model saw and how sure it was. */
  photo?: { portion: string; grams: number; confidence: "high" | "medium" | "low" | "picked" };
  checkedAt: string;
};
