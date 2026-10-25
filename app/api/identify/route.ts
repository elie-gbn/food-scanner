import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { ALLERGEN_IDS, type AllergenId } from "@/lib/allergens";
import { rateLimited } from "@/lib/rate-limit";
import { reportFromUsda, SourceError, usdaSearch } from "@/lib/sources";
import type { FoodReport } from "@/lib/types";

/* Photo identification for foods without a barcode: Claude names each food and estimates the portion,
   then the nutrition comes from USDA FoodData Central, not from the model. */

export const maxDuration = 60;

type Identified = {
  notFood: boolean;
  items: {
    name: string;
    usdaQuery: string;
    portion: string;
    estimatedGrams: number;
    confidence: "high" | "medium" | "low";
    likelyAllergens: AllergenId[];
  }[];
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notFood", "items"],
  properties: {
    notFood: { type: "boolean", description: "True when the photo shows no food or drink." },
    items: {
      type: "array",
      description: "Each distinct food or drink in the photo, most prominent first. At most 4.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "usdaQuery", "portion", "estimatedGrams", "confidence", "likelyAllergens"],
        properties: {
          name: { type: "string", description: "Short everyday name, e.g. \"Iced latte\" or \"Pepperoni pizza slice\"." },
          usdaQuery: { type: "string", description: "Generic search words for the USDA FoodData Central database, e.g. \"coffee latte whole milk\" or \"pizza pepperoni\". No brand names." },
          portion: { type: "string", description: "The visible portion in household terms, e.g. \"1 large cup (16 fl oz)\" or \"1 slice\"." },
          estimatedGrams: { type: "number", description: "Estimated weight of the visible portion in grams (use ml ≈ g for drinks)." },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          likelyAllergens: { type: "array", items: { type: "string", enum: ALLERGEN_IDS }, description: "Major allergens this food usually contains." },
        },
      },
    },
  },
} as const;

const SYSTEM = `You identify foods and drinks in photos for a nutrition app. For each distinct item, give an everyday name, generic USDA search words, the visible portion and its estimated weight, and the major allergens such a dish usually contains. Judge portion size from plates, cups, hands, and packaging in the frame. If a packaged product is visible, describe the food inside it generically. If you are unsure what something is, still give your best guess and mark it low confidence.`;

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export async function POST(request: Request) {
  if (rateLimited(request, "identify", 8)) return NextResponse.json({ error: "Too many photos. Wait a minute and try again." }, { status: 429 });

  const body = await request.json().catch(() => null) as { image?: string } | null;
  const match = body?.image?.match(DATA_URL);
  if (!match) return NextResponse.json({ error: "Send a JPEG, PNG, or WebP photo." }, { status: 400 });
  if (match[2].length > 6_000_000) return NextResponse.json({ error: "That photo is too large; try a smaller one." }, { status: 413 });

  let identified: Identified;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: match[1] as "image/jpeg" | "image/png" | "image/webp", data: match[2] } },
          { type: "text", text: "What food or drink is in this photo?" },
        ],
      }],
    });
    if (response.stop_reason === "refusal") return NextResponse.json({ error: "The photo could not be analyzed. Try another one." }, { status: 422 });
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new Error("empty response");
    identified = JSON.parse(text.text) as Identified;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || (error instanceof Error && /api key|apiKey|authentication/i.test(error.message) && !(error instanceof Anthropic.APIError))) {
      return NextResponse.json({ error: "Photo identification needs an Anthropic API key. Add ANTHROPIC_API_KEY to .env.local and restart the server." }, { status: 503 });
    }
    if (error instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "The vision service is busy. Try again in a moment." }, { status: 429 });
    if (error instanceof Anthropic.APIError) return NextResponse.json({ error: `The vision service returned an error (${error.status ?? "network"}).` }, { status: 502 });
    return NextResponse.json({ error: "Could not read the identification result. Try again." }, { status: 502 });
  }

  if (identified.notFood || !identified.items.length) return NextResponse.json({ error: "No food or drink was recognized in that photo." }, { status: 422 });

  const warnings = new Set<string>();
  const items = await Promise.all(identified.items.slice(0, 4).map(async (item) => {
    const grams = Math.max(1, Math.round(item.estimatedGrams));
    let report: FoodReport | null = null;
    try {
      const [food] = await usdaSearch(item.usdaQuery, undefined, 1);
      if (food) {
        report = reportFromUsda(food, "photo", { name: item.name, likelyAllergens: item.likelyAllergens, portion: { grams, label: `${item.portion} (~${grams} g, estimated from photo)` } });
        report = { ...report, id: `photo:${food.fdcId}:${grams}`, photo: { portion: item.portion, grams, confidence: item.confidence } };
      }
    } catch (error) {
      warnings.add(error instanceof SourceError ? error.message : "USDA did not respond.");
    }
    return { name: item.name, portion: item.portion, grams, confidence: item.confidence, likelyAllergens: item.likelyAllergens, report };
  }));

  return NextResponse.json({ items, warnings: [...warnings] });
}
