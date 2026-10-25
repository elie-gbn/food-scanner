/*
 * Pre-computes MobileCLIP text embeddings for every food in data/foods.ts, so the browser only has to
 * download the small vision model. Run with `npm run embeddings` after editing the food list.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { AutoTokenizer, CLIPTextModelWithProjection } from "@huggingface/transformers";
import { FOODS } from "../data/foods.ts";
import { MODEL_ID, NOT_FOOD, PROMPTS } from "../lib/recognize-config.ts";

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const model = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: "fp32" });

const normalize = (vector: Float32Array) => {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
};

async function embed(name: string) {
  const inputs = tokenizer(PROMPTS.map((prompt) => prompt.replace("{}", name)), { padding: "max_length", truncation: true });
  const { text_embeds } = await model(inputs);
  const dim = text_embeds.dims[1];
  const data = text_embeds.data as Float32Array;
  // Average the normalized embedding of each prompt template (prompt ensembling), then renormalize.
  const mean = new Float32Array(dim);
  for (let row = 0; row < PROMPTS.length; row++) {
    const vector = normalize(data.slice(row * dim, (row + 1) * dim));
    for (let i = 0; i < dim; i++) mean[i] += vector[i] / PROMPTS.length;
  }
  return normalize(mean);
}

const labels = [...FOODS.map(([name]) => name), ...NOT_FOOD];
const vectors: Float32Array[] = [];
for (const label of labels) {
  vectors.push(await embed(label));
  process.stdout.write(".");
}

// Store as int8 with one scale per vector: about 4x smaller than float32 with no measurable loss in ranking.
const dim = vectors[0].length;
const bytes = new Int8Array(labels.length * dim);
const scales = vectors.map((vector, row) => {
  const scale = Math.max(...vector.map(Math.abs)) / 127;
  vector.forEach((value, i) => { bytes[row * dim + i] = Math.round(value / scale); });
  return Number(scale.toPrecision(6));
});

const version = createHash("sha256").update(JSON.stringify([MODEL_ID, PROMPTS, labels])).digest("hex").slice(0, 12);
mkdirSync("public", { recursive: true });
writeFileSync("public/food-embeddings.json", JSON.stringify({ model: MODEL_ID, version, dim, labels, scales, data: Buffer.from(bytes.buffer).toString("base64") }));
console.log(`\nWrote ${labels.length} embeddings (${dim}-d) to public/food-embeddings.json, version ${version}.`);
