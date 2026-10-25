import "server-only";
import data from "@/data/generic-foods.json";
import type { GenericFood } from "@/lib/report";

/* Local search over USDA FNDDS generic foods (built by `npm run usda`): no API key, no network. */

type Indexed = { food: GenericFood; head: Set<string>; all: Set<string>; size: number };

const stem = (word: string) => word.length > 4 && word.endsWith("es") && !word.endsWith("ses") ? word.slice(0, -2) : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
const tokens = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean).map(stem);

let index: Indexed[] | null = null;
function getIndex() {
  index ??= (data as GenericFood[])
    .filter((food) => !/^(babyfood|infant formula|human milk|milk, human)/i.test(food.name))
    .map((food) => {
      const all = tokens(`${food.name} ${food.category}`);
      return { food, head: new Set(tokens(food.name.split(",")[0])), all: new Set(all), size: tokens(food.name).length };
    });
  return index;
}

export function searchGeneric(query: string, limit = 6): GenericFood[] {
  const words = [...new Set(tokens(query))];
  if (!words.length) return [];
  return getIndex()
    .map((entry) => {
      let score = 0;
      let missing = 0;
      for (const word of words) {
        if (entry.head.has(word)) score += 3;
        else if (entry.all.has(word)) score += 2;
        else if ([...entry.all].some((token) => token.startsWith(word) && word.length >= 3)) score += 1;
        else missing++;
      }
      score -= missing * 3 + entry.size * 0.15;
      if (entry.head.has(words[0])) score += 1;
      // Prefer the plain food ("Banana, raw") over dishes that merely contain the word ("Banana split").
      if (entry.head.size === words.length && words.every((word) => entry.head.has(word))) score += 2;
      if (/, (raw|NFS)$/i.test(entry.food.name)) score += 0.5;
      return { food: entry.food, score, missing };
    })
    .filter((item) => item.missing < words.length && item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.food);
}

/** An exact FNDDS name if one matches, otherwise the best search result. */
export function findGeneric(nameOrQuery: string) {
  const exact = getIndex().find((entry) => entry.food.name.toLowerCase() === nameOrQuery.toLowerCase());
  return exact?.food ?? searchGeneric(nameOrQuery, 1)[0] ?? null;
}
