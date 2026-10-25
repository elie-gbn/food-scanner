import { ALLERGENS, customRule, matchRule, ruleById, type Match, type Rule } from "./diet";
import type { FoodReport } from "./report";

/* Turns a product report and a person's profile into one finding per thing they avoid.
   Nothing here ever says "safe": the best result is "clear", meaning not found in what the database lists. */

export type Profile = { allergens: string[]; diets: string[]; custom: string[]; language: string };
export type Status = "contains" | "may-contain" | "unknown" | "clear";
export type Finding = {
  restriction: string;
  label: string;
  status: Status;
  /** Why this status, one line per hit, e.g. "lard (in ingredients)". */
  evidence: string[];
  /** Words to highlight in the ingredient text. */
  terms: string[];
  /** Extra context that never changes the status: labels, unknown flavour origin, data gaps. */
  notes: string[];
};

export type DataQuality = { state: "none" | "incomplete" | "ok"; reasons: string[] };

const ORDER: Record<Status, number> = { contains: 0, "may-contain": 1, unknown: 2, clear: 3 };
const tagName = (tag: string) => tag.replace(/^[a-z]{2}:/i, "").replace(/-/g, " ");
const listedItems = (text: string) => text.split(/[,;·•\n]+/).map((item) => item.trim()).filter(Boolean);
/* Where an ingredient list turns into a "may contain" warning, in the languages we match. */
const TRACE_MARKER = /\b(may contain|might contain|traces? of|peut contenir|puede contener|kann spuren|kan innehålla)\b/i;

function ingredientText(report: FoodReport) {
  return [report.ingredients, report.ingredientsEn].filter(Boolean).join(" ; ");
}

/** How far the ingredient data can be trusted to rule things out. */
export function assessData(report: FoodReport): DataQuality {
  const text = ingredientText(report);
  if (!text.trim() && report.ingredientTags.length === 0) return { state: "none", reasons: ["No ingredient list is published for this product."] };

  const reasons: string[] = [];
  if (report.ingredientsComplete === false) reasons.push("Open Food Facts marks the ingredient list as unfinished.");
  const count = listedItems(report.ingredients ?? report.ingredientsEn ?? "").length;
  if (count < 3) reasons.push(`Only ${count} ${count === 1 ? "ingredient is" : "ingredients are"} listed, which looks too short to trust.`);

  const tagText = report.ingredientTags.map(tagName).join(", ");
  for (const name of report.allergens) {
    if (!ALLERGENS.includes(name)) continue;
    const explained = matchRule(ruleById(name)!, { tags: report.ingredientTags, text: `${text} ; ${tagText}` }).length > 0;
    if (!explained) reasons.push(`${name} is declared as an allergen but does not appear in the ingredient list.`);
  }
  if (report.lang && report.lang !== "en" && text.trim() && report.ingredientTags.length === 0) {
    reasons.push("The ingredient text is not in English and was not analysed by Open Food Facts.");
  }
  return { state: reasons.length ? "incomplete" : "ok", reasons };
}

function restrictions(profile: Profile): Rule[] {
  const rules: Rule[] = [];
  for (const id of profile.diets) { const rule = ruleById(id); if (rule?.kind === "diet") rules.push(rule); }
  for (const id of profile.allergens) { const rule = ruleById(id); if (rule?.kind === "allergen") rules.push(rule); }
  for (const word of profile.custom) if (word.trim()) rules.push(customRule(word));
  return rules;
}

const LABEL_NOTES: Record<string, [string, string]> = {
  halal: ["en:halal", "Labelled halal (not verified)"],
  vegetarian: ["en:vegetarian", "Labelled vegetarian (not verified)"],
  vegan: ["en:vegan", "Labelled vegan (not verified)"],
};

function dedupe(items: string[]) { return [...new Set(items)]; }

export function evaluate(report: FoodReport, profile: Profile): Finding[] {
  const quality = assessData(report);
  const text = ingredientText(report);
  const tagText = report.ingredientTags.map(tagName).join(", ");
  const marker = text.search(TRACE_MARKER);
  const listed = marker === -1 ? text : text.slice(0, marker);
  const warned = marker === -1 ? "" : text.slice(marker);
  const traceTags = report.traces.filter((tag) => /^en:/i.test(tag));
  const traceText = [...report.traces.map(tagName), warned].join(" ; ");

  return restrictions(profile).map((rule): Finding => {
    const evidence: string[] = [];
    const terms: string[] = [];
    const notes: string[] = [];
    let status = "clear" as Status;
    const raise = (next: Status) => { if (ORDER[next] < ORDER[status]) status = next; };

    const inListed: Match[] = matchRule(rule, { tags: report.ingredientTags, text: `${listed} ; ${tagText}` });
    for (const match of inListed) {
      if (match.strength === "contains") { raise("contains"); evidence.push(`${match.term} (in ingredients)`); terms.push(match.term); }
      else if (match.strength === "possible") { raise("may-contain"); evidence.push(`${match.term} (in ingredients; source not stated)`); terms.push(match.term); }
      else notes.push("Flavourings are listed without saying what they come from.");
    }

    if (rule.kind === "allergen" && report.allergens.includes(rule.id)) { raise("contains"); evidence.push(`${rule.id} (declared allergen)`); }

    for (const match of matchRule(rule, { tags: traceTags, text: traceText })) {
      if (match.strength === "note") continue;
      raise("may-contain");
      evidence.push(`${match.term} (may contain traces)`);
      terms.push(match.term);
    }

    // Open Food Facts' own vegan / vegetarian guess can add a hit, never remove one.
    if (rule.id === "vegan" && report.analysis.includes("en:non-vegan")) { raise("contains"); evidence.push("Open Food Facts marks this product non-vegan"); }
    if ((rule.id === "vegetarian" || rule.id === "vegan") && report.analysis.includes("en:non-vegetarian")) { raise("contains"); evidence.push("Open Food Facts marks this product non-vegetarian"); }

    // Labels are crowd-edited, so they only add a note and never lower a finding.
    const label = LABEL_NOTES[rule.id];
    if (label && report.labels.includes(label[0])) notes.push(label[1]);

    if (status === "clear" && quality.state !== "ok") status = "unknown";
    if (status !== "contains") notes.push(...quality.reasons);
    return { restriction: rule.id, label: rule.label, status, evidence: dedupe(evidence), terms: dedupe(terms), notes: dedupe(notes) };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

/* What to call a hit in the banner: "Contains pork", "Contains milk", "Not halal". */
const HIT_PHRASE: Record<string, string> = { "pork-free": "pork", halal: "ingredients that are not halal", vegetarian: "meat or fish ingredients", vegan: "animal products" };
const MAYBE_PHRASE: Record<string, string> = { "pork-free": "pork", halal: "ingredients that may not be halal", vegetarian: "ingredients that may not be vegetarian", vegan: "ingredients that may not be vegan" };

export function phrase(finding: Finding) {
  const table = finding.status === "contains" ? HIT_PHRASE : MAYBE_PHRASE;
  return table[finding.restriction] ?? finding.label;
}

export type Headline = { status: Status; text: string };

/** The one line that goes at the top of the result. Never says "safe". */
export function headline(findings: Finding[]): Headline | null {
  if (!findings.length) return null;
  const worst = findings[0].status;
  const names = findings.filter((f) => f.status === worst).map(phrase);
  const list = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ");
  if (worst === "contains") return { status: worst, text: `Contains ${list}` };
  if (worst === "may-contain") return { status: worst, text: `May contain ${list}` };
  if (worst === "unknown") return { status: worst, text: "Can't tell: check the label" };
  return { status: worst, text: "Not found in the listed ingredients" };
}
