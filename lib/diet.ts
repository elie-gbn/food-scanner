/* Rules for what a person avoids. Pure functions, no I/O.
   Tags are Open Food Facts taxonomy ids (en:pork); terms are matched in free ingredient text. */

export type Strength = "contains" | "possible" | "note";
export type Match = { strength: Strength; term: string; source: "tag" | "text" };
export type MatchInput = { tags: string[]; text: string };

export type Rule = {
  id: string;
  label: string;
  kind: "allergen" | "diet" | "custom";
  /** Always an animal / forbidden source. */
  contains: { tags: string[]; terms: string[] };
  /** Could be from a forbidden source, or the label does not say (gelatin, E471...). */
  possible: { tags: string[]; terms: string[] };
  /** Not a hit, but the origin is not stated. */
  note: { terms: string[] };
};

/* Names as Open Food Facts returns them (allergen tag, prefix stripped, hyphens as spaces). */
export const ALLERGENS = ["gluten", "milk", "eggs", "peanuts", "nuts", "soybeans", "fish", "crustaceans", "molluscs", "sesame seeds", "celery", "mustard", "sulphur dioxide and sulphites", "lupin"];

const ALLERGEN_TERMS: Record<string, string[]> = {
  gluten: ["wheat", "rye", "barley", "oats", "spelt", "gluten", "blé", "trigo", "weizen"],
  milk: ["milk", "butter", "cream", "cheese", "whey", "casein", "lactose", "yoghurt", "yogurt", "lait", "leche", "milch"],
  eggs: ["egg", "eggs", "albumen", "œuf", "oeuf", "huevo", "ei"],
  peanuts: ["peanut", "peanuts", "groundnut", "arachide", "cacahuete"],
  nuts: ["almond", "hazelnut", "walnut", "cashew", "pistachio", "pecan", "macadamia", "brazil nut", "amande", "noisette"],
  soybeans: ["soy", "soya", "soybean", "soja", "tofu"],
  fish: ["fish", "anchovy", "tuna", "salmon", "cod", "poisson", "pescado", "fisch"],
  crustaceans: ["shrimp", "prawn", "crab", "lobster", "crayfish", "crevette"],
  molluscs: ["mussel", "oyster", "squid", "clam", "octopus", "snail", "scallop"],
  "sesame seeds": ["sesame", "tahini", "sésame"],
  celery: ["celery", "celeriac", "céleri"],
  mustard: ["mustard", "moutarde"],
  "sulphur dioxide and sulphites": ["sulphite", "sulphites", "sulfite", "sulfites", "sulphur dioxide", "sulfur dioxide"],
  lupin: ["lupin", "lupine"],
};

const empty = { tags: [] as string[], terms: [] as string[] };
const slug = (name: string) => `en:${name.replace(/ /g, "-")}`;

const allergenRules: Rule[] = ALLERGENS.map((name) => ({
  id: name,
  label: name,
  kind: "allergen",
  contains: { tags: [slug(name)], terms: ALLERGEN_TERMS[name] ?? [] },
  possible: empty,
  note: { terms: [] },
}));

/* Pork in the languages travellers meet. Thai, Japanese, Chinese, Korean and Arabic have no spaces, so they match as substrings. */
const PORK = [
  "pork", "porc", "porco", "cerdo", "puerco", "schwein", "schweinefleisch", "fläsk", "flask", "svin", "varken",
  "lard", "saindoux", "schmalz", "bacon", "ham", "jamón", "jamon", "jambon", "prosciutto", "pancetta", "speck", "couenne", "chicharrón",
  "หมู", "ブタ", "豚", "豬", "猪", "돼지", "خنزير",
];
const PORK_TAGS = ["en:pork", "en:pork-meat", "en:lard", "en:bacon", "en:ham", "en:pork-fat", "en:pork-rind", "en:prosciutto", "en:pancetta"];

/* Often animal, often from pork. The label rarely says which. */
const AMBIGUOUS_ANIMAL_TERMS = ["gelatin", "gelatine", "gélatine", "gelatina", "gelatin", "animal fat", "animal fats", "animal shortening", "sausage", "salami", "mortadella", "chorizo", "saucisse", "wurst"];
const AMBIGUOUS_E = ["E441", "E471", "E472a", "E472b", "E472c", "E472e", "E477", "E542", "E920", "E631", "E627"];
const ORIGIN_UNSTATED = ["natural flavour", "natural flavours", "natural flavor", "natural flavors", "flavouring", "flavoring", "arôme naturel", "arômes naturels", "aroma natural", "natürliches aroma", "natürliche aromen"];

const MEAT = ["meat", "beef", "veal", "lamb", "mutton", "chicken", "turkey", "duck", "venison", "tallow", "suet", "viande", "carne", "fleisch", "kött", "肉", "หมู"];
const FISH = ["fish", "anchovy", "anchovies", "tuna", "salmon", "cod", "sardine", "shrimp", "prawn", "crab", "lobster", "squid", "oyster", "mussel", "isinglass", "poisson", "pescado", "fisch", "魚", "魚介"];
const DAIRY_EGG = ["milk", "butter", "cream", "cheese", "whey", "casein", "caseinate", "lactose", "yoghurt", "yogurt", "egg", "eggs", "albumen", "honey", "beeswax", "lait", "leche", "milch", "œuf", "oeuf", "huevo", "miel"];
const ALCOHOL = ["wine", "beer", "rum", "whisky", "whiskey", "brandy", "liqueur", "sake", "mirin", "vodka", "gin", "alcohol", "alcool", "alkohol", "vin", "vino", "wein", "bière", "cerveza"];

const porkFree: Rule = {
  id: "pork-free",
  label: "pork-free",
  kind: "diet",
  contains: { tags: PORK_TAGS, terms: PORK },
  possible: { tags: ["en:gelatin", "en:sausage", "en:salami", "en:chorizo", ...AMBIGUOUS_E.map((e) => `en:${e.toLowerCase()}`)], terms: [...AMBIGUOUS_ANIMAL_TERMS, ...AMBIGUOUS_E] },
  note: { terms: ORIGIN_UNSTATED },
};

const halal: Rule = {
  id: "halal",
  label: "halal",
  kind: "diet",
  contains: { tags: [...PORK_TAGS, "en:wine", "en:beer", "en:alcohol", "en:mirin", "en:rum"], terms: [...PORK, ...ALCOHOL, "blood", "carrion"] },
  possible: { tags: ["en:gelatin", "en:rennet", "en:vanilla-extract", "en:ethanol", ...AMBIGUOUS_E.map((e) => `en:${e.toLowerCase()}`)], terms: [...AMBIGUOUS_ANIMAL_TERMS, ...AMBIGUOUS_E, "rennet", "vanilla extract", "ethanol", "ethyl alcohol"] },
  note: { terms: ORIGIN_UNSTATED },
};

const vegetarian: Rule = {
  id: "vegetarian",
  label: "vegetarian",
  kind: "diet",
  contains: { tags: ["en:meat", "en:fish", "en:seafood", "en:gelatin", "en:lard", "en:tallow", "en:e120", "en:e441", "en:e904", "en:carmine"], terms: [...PORK, ...MEAT, ...FISH, "gelatin", "gelatine", "gélatine", "gelatina", "carmine", "cochineal", "E120", "E441", "E542", "lard", "tallow"] },
  possible: { tags: ["en:rennet", ...AMBIGUOUS_E.map((e) => `en:${e.toLowerCase()}`)], terms: ["rennet", "animal fat", "animal fats", "animal shortening", "sausage", "salami", "chorizo", ...AMBIGUOUS_E] },
  note: { terms: ORIGIN_UNSTATED },
};

const vegan: Rule = {
  id: "vegan",
  label: "vegan",
  kind: "diet",
  contains: { tags: [...vegetarian.contains.tags, "en:milk", "en:eggs", "en:honey", "en:dairy", "en:egg", "en:beeswax"], terms: [...vegetarian.contains.terms, ...DAIRY_EGG] },
  possible: { tags: vegetarian.possible.tags, terms: vegetarian.possible.terms },
  note: { terms: ORIGIN_UNSTATED },
};

export const DIETS: Rule[] = [porkFree, halal, vegetarian, vegan];
export const ALL_RULES: Rule[] = [...DIETS, ...allergenRules];

export function ruleById(id: string): Rule | undefined {
  return ALL_RULES.find((rule) => rule.id === id);
}

/** A rule for a word the user typed. The word is escaped before it reaches a RegExp. */
export function customRule(word: string): Rule {
  const clean = word.trim();
  return { id: `custom:${clean.toLowerCase()}`, label: clean, kind: "custom", contains: { tags: [], terms: [clean] }, possible: empty, note: { terms: [] } };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* Latin letters (with accents), digits, spaces and hyphens get word boundaries; every other script is a plain substring. */
const LATIN = /^[\p{Script=Latin}\p{N}\s'’-]+$/u;
const regexCache = new Map<string, RegExp>();

function termRegex(term: string): RegExp {
  let regex = regexCache.get(term);
  if (!regex) {
    const body = escapeRegExp(term.trim()).replace(/\s+/g, "\\s+");
    // E-numbers also appear as "E 441" or "E-441".
    const pattern = /^E\d+[a-z]?$/i.test(term) ? `E[\\s-]?${escapeRegExp(term.slice(1))}` : body;
    regex = LATIN.test(term) ? new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu") : new RegExp(escapeRegExp(term), "u");
    regexCache.set(term, regex);
  }
  return regex;
}

/* Phrases that contain a trigger word without the thing itself: sugar alcohols are polyols, cocoa butter is not dairy. */
const FALSE_FRIENDS = new RegExp([
  "(sugar|polyol|sweetener)\\s+alcohols?",
  "alcools?\\s+de\\s+(sucre|canne)",
  "alcohol\\s+de\\s+az[uú]car",
  "cream\\s+of\\s+tartar",
  "(cocoa|cacao|shea|peanut|nut|almond|cashew|coconut|mango|illipe)\\s+(butter|milk|cream)",
  "butter\\s*(beans?|nut)",
  "egg\\s*plant",
].join("|"), "giu");

function findTags(tags: string[], wanted: string[]): string[] {
  const have = new Set(tags.map((tag) => tag.toLowerCase()));
  return wanted.filter((tag) => have.has(tag));
}

function findTerms(text: string, terms: string[]): string[] {
  return [...new Set(terms)].filter((term) => termRegex(term).test(text)).map((term) => term);
}

const tagName = (tag: string) => tag.replace(/^[a-z]{2}:/i, "").replace(/-/g, " ");

export function matchRule(rule: Rule, input: MatchInput): Match[] {
  const text = input.text.replace(FALSE_FRIENDS, " ");
  const matches: Match[] = [];
  for (const tag of findTags(input.tags, rule.contains.tags)) matches.push({ strength: "contains", term: tagName(tag), source: "tag" });
  for (const term of findTerms(text, rule.contains.terms)) matches.push({ strength: "contains", term, source: "text" });
  for (const tag of findTags(input.tags, rule.possible.tags)) matches.push({ strength: "possible", term: tagName(tag), source: "tag" });
  for (const term of findTerms(text, rule.possible.terms)) matches.push({ strength: "possible", term, source: "text" });
  for (const term of findTerms(text, rule.note.terms)) matches.push({ strength: "note", term, source: "text" });
  return matches;
}

/** Splits text into plain and matched pieces so the matched terms can be highlighted. */
export function highlightTerms(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const unique = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
  if (!text || !unique.length) return [{ text, hit: false }];
  const combined = new RegExp(unique.map((term) => `(?:${termRegex(term).source})`).join("|"), "giu");
  const pieces: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const found of text.matchAll(combined)) {
    if (!found[0]) continue;
    if (found.index > last) pieces.push({ text: text.slice(last, found.index), hit: false });
    pieces.push({ text: found[0], hit: true });
    last = found.index + found[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), hit: false });
  return pieces;
}
