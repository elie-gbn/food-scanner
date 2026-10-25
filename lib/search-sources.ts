import "server-only";
import type { OffProduct, UsdaFood } from "@/lib/report";

/* Name search against Open Food Facts (packaged products) and, with a personal key, USDA branded foods. */

const OFF_FIELDS = "code,product_name,brands,quantity,serving_size,image_front_url,nutriscore_grade,nova_group,ingredients_text,ingredients_text_en,ingredients_tags,allergens_tags,traces_tags,labels_tags,ingredients_analysis_tags,states_tags,lang,categories_tags,product_quantity,product_quantity_unit,nutriments";

export class SourceError extends Error {}

async function getJson<T>(url: string, init: RequestInit, source: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(9000) });
  if (response.status === 429) throw new SourceError(`${source} is busy right now.`);
  if (!response.ok) throw new SourceError(`${source} answered ${response.status}.`);
  return response.json() as Promise<T>;
}

/** Uses Open Food Facts' search service (the legacy search.pl endpoint is frequently overloaded). */
export async function offSearch(query: string, limit = 5): Promise<(OffProduct & { code: string })[]> {
  const params = new URLSearchParams({ q: query, page_size: String(limit), sort_by: "-unique_scans_n", fields: OFF_FIELDS });
  const data = await getJson<{ hits?: (Omit<OffProduct, "brands"> & { code?: string; brands?: string | string[] })[] }>(
    `https://search.openfoodfacts.org/search?${params}`,
    { headers: { "User-Agent": "labelens-food-scanner/1.0 (https://github.com/elie-gbn/food-scanner)" } },
    "Open Food Facts",
  );
  return (data.hits ?? [])
    .filter((product): product is typeof product & { code: string } => !!product.code && !!product.product_name)
    .map(({ brands, ...product }) => ({ ...product, brands: Array.isArray(brands) ? brands.join(", ") : brands }));
}

export async function usdaBrandedSearch(query: string, key: string, limit = 3) {
  const params = new URLSearchParams({ api_key: key, query, pageSize: String(limit), dataType: "Branded" });
  const data = await getJson<{ foods?: UsdaFood[] }>(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, {}, "USDA");
  return data.foods ?? [];
}
