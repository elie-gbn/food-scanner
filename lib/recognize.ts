"use client";

import { FOODS } from "@/data/foods";
import type { AllergenId } from "@/lib/allergens";
import { MODEL_ID, NOT_FOOD } from "@/lib/recognize-config";

/*
 * Free, on-device food recognition: MobileCLIP's vision model runs in the browser (WebGPU or WebAssembly)
 * and the photo is compared with pre-computed text embeddings of every food in data/foods.ts.
 * Nothing is uploaded and there's no per-photo cost.
 */

export type Guess = { name: string; query: string; allergens: AllergenId[]; probability: number };
export type Recognition = { guesses: Guess[]; notFood: boolean };
type Loaded = { classify: (image: Blob) => Promise<Float32Array>; labels: string[]; vectors: Float32Array[] };

/* fp16 matches fp32 accuracy at half the download (~43 MB); the int8 build of this model misclassifies badly. */
const DTYPE = "fp16";
/* CLIP's learned temperature: turns cosine similarities into a sharp probability distribution. */
const LOGIT_SCALE = 100;

let loading: Promise<Loaded> | null = null;

function decodeIndex(index: { labels: string[]; dim: number; scales: number[]; data: string }) {
  const raw = atob(index.data);
  const bytes = new Int8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = (raw.charCodeAt(i) << 24) >> 24;
  return index.labels.map((_, row) => Float32Array.from(bytes.subarray(row * index.dim, (row + 1) * index.dim), (value) => value * index.scales[row]));
}

async function load(onProgress: (percent: number) => void): Promise<Loaded> {
  const [{ AutoProcessor, CLIPVisionModelWithProjection, RawImage }, index] = await Promise.all([
    import("@huggingface/transformers"),
    fetch("/food-embeddings.json").then((response) => {
      if (!response.ok) throw new Error("The food list for photo recognition is missing.");
      return response.json() as Promise<{ model: string; labels: string[]; dim: number; scales: number[]; data: string }>;
    }),
  ]);
  if (index.model !== MODEL_ID) throw new Error("The food list was built for a different model. Run `npm run embeddings`.");

  // Track download progress across the model's files, weighted by size.
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (event: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (event.status !== "progress" || !event.file || !event.total) return;
    files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
    const totals = [...files.values()].reduce((sum, file) => ({ loaded: sum.loaded + file.loaded, total: sum.total + file.total }), { loaded: 0, total: 0 });
    onProgress(Math.round((totals.loaded / totals.total) * 100));
  };

  const device = "gpu" in navigator ? "webgpu" : "wasm";
  const processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
  const model = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: DTYPE, device, progress_callback })
    .catch(() => CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: DTYPE, device: "wasm", progress_callback }));

  return {
    labels: index.labels,
    vectors: decodeIndex(index),
    classify: async (blob) => {
      const image = await RawImage.fromBlob(blob);
      const { image_embeds } = await model(await processor(image));
      return Float32Array.from(image_embeds.data as ArrayLike<number>);
    },
  };
}

/** Starts the model download early (e.g. when the camera starts) so the first photo is fast. */
export function preloadRecognizer(onProgress: (percent: number) => void = () => {}) {
  loading ??= load(onProgress).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

export async function recognizeFood(image: Blob, onProgress?: (percent: number) => void): Promise<Recognition> {
  const { classify, labels, vectors } = await preloadRecognizer(onProgress);
  const embed = await classify(image);
  const length = Math.hypot(...embed);
  const scores = vectors.map((vector) => vector.reduce((sum, value, i) => sum + value * embed[i], 0) / length * LOGIT_SCALE);
  const max = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(score - max));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const ranked = labels.map((label, i) => ({ label, probability: weights[i] / total })).sort((a, b) => b.probability - a.probability);

  const foodByName = new Map(FOODS.map(([name, query, allergens]) => [name, { query, allergens }]));
  const guesses = ranked
    .filter((item) => foodByName.has(item.label))
    .slice(0, 3)
    .map((item) => ({ name: item.label, probability: item.probability, ...foodByName.get(item.label)! }));
  return { guesses, notFood: NOT_FOOD.includes(ranked[0].label) && ranked[0].probability > 0.5 };
}
