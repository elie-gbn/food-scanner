# Plan: Labelens, a "can I eat this?" scanner for travellers

## Goal
A traveller sets what they cannot or will not eat (allergens and diets such as pork-free, halal, vegetarian). They scan a barcode and get a plain verdict at the top of the result, for example "CONTAINS PORK (gelatin)", with the evidence shown. Missing data is never reported as safe.

## Spec
No SPEC.md exists. This plan is the spec until one is written. Global constraints:
- Safety first: "not found" is never shown as "safe". A product with no ingredient data gets a loud "Unknown, check the label" verdict.
- Verdict states per restriction: **Contains**, **May contain**, **Not found in listed ingredients**, **Unknown (no ingredient data)**.
- Show the evidence (matched ingredient and where it was found).
- Keep the original ingredient text visible, even when a translation is shown.
- Caffeine stays, but is secondary.

## Architecture
Today `app/api/food-scanner/route.ts` returns a `FoodReport` and `components/FoodScanner.tsx` (340 lines) does everything in the UI. Plan:
- `lib/diet.ts`: pure functions with no I/O. `evaluate(report, profile) -> Finding[]`. Tested.
- The API route also returns the language-neutral Open Food Facts tags: `ingredients_tags`, `traces_tags`, `labels_tags`, `ingredients_analysis_tags`, `ingredients_text_en`, `lang`. Field names verified against the live API on 2026-10-25 (Nutella: `ingredients_tags` like `en:palm-oil`, `traces_tags: []`, `ingredients_analysis_tags: ["en:maybe-vegan", ...]`).
- Profile (allergens, diets, custom words, UI language) lives in `localStorage`, behind a small hook in `lib/profile.ts`.
- Split the UI into small components as tasks touch them. No big-bang rewrite.

## Stack
Next.js 16.4.3, React 19.3.0, TypeScript 5, ESLint 9. There is no test runner yet; task 1 adds `vitest`. **Before writing code, read the relevant guide in `node_modules/next/dist/docs/`** (AGENTS.md says this Next.js has breaking changes).

## Overlooked inputs
- Product exists but ingredients are empty or partial. The Nutella entry returns only "sugar, palm oil", so the database itself can be wrong.
- Ingredient text is in a foreign language (Thai, Arabic, Japanese labels).
- Hidden pork and animal derivatives: gelatin, lard, bacon, ham, E441, E120, E904, E920, "natural flavours" (undeterminable, so say so).
- Word-boundary traps: "porcini" must not match "pork"; "peanut" vs "nut".
- Barcode not in either database (common abroad). Say so and point to the label.
- Offline or slow network. Both lookups time out at 8 s.
- Old `labelens-my-allergens` localStorage key must keep working.
- Rate limit is in-memory per server instance, so it does not hold on serverless. This is not a safety issue.

## Tasks
- [x] 1. Test runner and diet rules module (pure)
- [x] 2. API returns the language-neutral ingredient, trace and label tags
- [x] 3. Verdict engine: report + profile -> findings
- [x] 4. Profile setup UI: allergens, diets, custom words (with migration)
- [x] 5. Verdict banner and evidence in the result
- **Checkpoint A (human):** scan 5 real products and compare against their physical labels.
- [ ] 6. Ingredient translation (taxonomy-based, original always visible)
- [ ] 7. Not-found, no-data and failure states
- [ ] 8. Phone and accessibility pass, README and disclaimer
- **Checkpoint B (human):** try on a phone over HTTPS before sharing.

---

### 1. Add vitest and the diet rules table
- **Why**: Nothing is tested today, and a wrong verdict is a safety bug. Rules need tests before anything uses them.
- **Approach**: `npm i -D vitest`, add the `"test": "vitest run"` script. `lib/diet.ts` exports `DIETS`: `pork-free`, `halal`, `vegetarian`, `vegan`, plus the existing 14 allergens. Each rule has `tags` (OFF taxonomy ids such as `en:pork`, `en:gelatin`, `en:lard`), `words` (regexes with word boundaries for free text, multilingual: pork/porc/cerdo/Schwein/gris/ブタ/หมู), and `eNumbers`. Halal also treats alcohol, gelatin (unless labelled otherwise) and pork as hits. Kosher is out of scope for v1 (see open questions).
  Tests (name / input / expected):
  - `porcini is not pork` / "porcini mushrooms" / no hit
  - `lard is pork` / "lard" / hit
  - `gelatin flagged for pork-free as may-contain` / "gelatin" / may-contain, not contains
  - `E441 maps to gelatin` / "E441" / may-contain pork
  - `empty text` / "" / no hit, no crash
- **Files**: `package.json`, `lib/diet.ts`, `lib/diet.test.ts`.
- **Interfaces**: produces `DIETS`, `matchRule(rule, {tags, text}) -> Match[]`.
- **Depends on**: none.
- **Accepted when**: tests above pass; `npm run lint` is clean; no existing behaviour changes.
- **Verify**: `npm test` shows 5+ passing; `npm run lint` exits 0.

### 2. API returns tags
- **Why**: Free text is error-prone; taxonomy tags are the same in every language.
- **Approach**: Add `ingredients_tags,traces_tags,labels_tags,ingredients_analysis_tags,ingredients_text_en,lang` to the `fetchOff` field list. Extend `FoodReport` with `ingredientTags: string[]`, `traces: string[]`, `labels: string[]`, `analysis: string[]`, `ingredientsEn: string | null`, `lang: string | null`. Also stop dropping `traces_tags`. Missing fields become `[]`/`null`, never undefined. USDA-only products get empty tag arrays plus the USDA text. Extract `buildReport` input mapping so it can be tested with a fixture. Tests: fixture with all fields; fixture with none (USDA-only).
- **Files**: `app/api/food-scanner/route.ts`, `app/api/food-scanner/report.test.ts`.
- **Interfaces**: consumes OFF/USDA JSON; produces extended `FoodReport`.
- **Depends on**: 1.
- **Accepted when**: the existing UI still works with the extended report; fixtures pass; `traces` is populated for a product that has them.
- **Verify**: `npm test`; `curl "localhost:3000/api/food-scanner?barcode=3017620422003"` includes `ingredientTags`.

### 3. Verdict engine
- **Why**: One tested function decides what the UI shows.
- **Approach**: `lib/verdict.ts`: `evaluate(report, profile) -> Finding[]`, with `Finding = {restriction, status: "contains" | "may-contain" | "clear" | "unknown", evidence: string[]}`. Rules:
  - No ingredient tags AND no ingredient text -> every restriction is `unknown`.
  - A match in `ingredientTags` or text -> `contains`, but a gelatin/E-number type "possibly animal" match -> `may-contain`.
  - A match in `traces` or in text after "may contain" -> `may-contain`.
  - `labels` containing `en:halal`/`en:vegan` and so on overrides `may-contain` to `clear`; it never overrides `contains`.
  - "Natural flavours"/"flavouring" with a vegan, vegetarian or halal profile adds the note "origin not stated".
  - Otherwise `clear`, labelled in the UI as "Not found in listed ingredients".
  Tests: Nutella fixture with the allergen `milk` -> contains (from `allergens_tags`); gummy bears with `en:gelatin` for pork-free -> may-contain; empty report -> unknown for all; halal-labelled with gelatin text -> may-contain downgraded to clear; porcini -> clear.
- **Files**: `lib/verdict.ts`, `lib/verdict.test.ts`.
- **Interfaces**: consumes `FoodReport` + `Profile`; produces `Finding[]` sorted worst-first.
- **Depends on**: 1, 2.
- **Accepted when**: all verdict tests pass; no state can produce `clear` when there is no ingredient data; findings are sorted contains > may-contain > unknown > clear.
- **Verify**: `npm test`.

### 4. Profile setup UI
- **Why**: Users must say what they avoid before scanning, and it must persist.
- **Approach**: `lib/profile.ts` (`useProfile` hook: `{allergens, diets, custom, language}`) with localStorage read/write in try/catch (existing pattern in `FoodScanner.tsx`). Migrate `labelens-my-allergens` into the new key on first load. UI: first-visit panel "What can't you eat?" with checkbox groups (Allergies / Diets / Other words, e.g. "pork, alcohol"), replacing the collapsed `<details>`. Custom words are matched in ingredient text as whole words.
- **Files**: `lib/profile.ts`, `components/ProfileSetup.tsx`, `components/FoodScanner.tsx`.
- **Interfaces**: produces `Profile` consumed by `evaluate`.
- **Depends on**: 1.
- **Accepted when**: choices survive reload; an old saved allergen list is kept; blocked storage does not crash the page.
- **Verify**: preview: tick Pork-free, reload, still ticked; set `localStorage` key `labelens-my-allergens` = `["milk"]` before first load and see Milk ticked.

### 5. Verdict banner and evidence
- **Why**: This is the product: "CONTAINS PORK" in one glance.
- **Approach**: Top of the results panel shows the worst finding as a large banner (red contains, amber may-contain, grey unknown, green "not found in listed ingredients"), then a list of every finding with its evidence ("gelatin, found in ingredients"). Highlight matched words inside the ingredient text. Remove the old `allergenHits` block. No colour-only meaning (text and icon too). If the profile is empty, show "Set what you avoid" and no green state.
- **Files**: `components/VerdictBanner.tsx`, `components/FoodScanner.tsx`, `app/globals.css`.
- **Interfaces**: consumes `Finding[]`.
- **Depends on**: 3, 4.
- **Accepted when**: pork-free + a product with lard shows "Contains pork" with "lard" as evidence; a product with no ingredient data shows "Unknown" in a non-green state; the empty profile never shows green.
- **Verify**: preview with the three example barcodes plus a known gummy-sweet barcode; screenshot each state.

### 6. Ingredient translation
- **Why**: Travellers read the ingredients in a language they cannot read.
- **Approach**: Show `ingredientsEn` when present and the original text below it. Also show the ingredient list as a readable chip row built from `ingredientTags` using a small label table for the UI language (default: English, plus the languages chosen in open question 3). No free-text machine translation in v1 (it is unreliable for safety), and a note says the translation is partial. Unknown tags fall back to the tag id with the prefix stripped.
  Tests: tag `en:pork` -> "Schweinefleisch" in German; unknown tag `en:some-thing` -> "some thing"; no tags -> falls back to original text only.
- **Files**: `lib/labels.ts`, `lib/labels.test.ts`, `components/FoodScanner.tsx`.
- **Interfaces**: consumes `ingredientTags`, `language`.
- **Depends on**: 2, 4.
- **Accepted when**: switching language changes the chip labels and the banner wording; the original text is always visible.
- **Verify**: `npm test`; preview a non-English product.

### 7. Not-found, no-data and failure states
- **Why**: Trips happen in places with thin data and bad networks.
- **Approach**: 404 -> "This barcode isn't in our databases. Read the label; look for: <profile words in your language>". Network/timeout error -> retry button. A product with a name but no ingredients -> `unknown` banner (already from task 3). Distinguish "lookup failed" from "not found" in the API (502 vs 404 so far both look like "not found").
- **Files**: `app/api/food-scanner/route.ts`, `components/FoodScanner.tsx`.
- **Depends on**: 5.
- **Accepted when**: an unknown barcode (`0000000000000`) shows the not-found help; with the network off, a retry message appears, not "not found".
- **Verify**: preview; DevTools offline.

### 8. Phone, accessibility, docs
- **Why**: It is used on a phone, one-handed, in a shop.
- **Approach**: Check at 375 px; verdict banner is `role="alert"`; touch targets 44 px; update README (purpose, how verdicts work, data limits); one visible disclaimer: "Not medical advice. Always check the label."
- **Files**: `app/globals.css`, `README.md`, `components/*`.
- **Depends on**: 5, 6, 7.
- **Accepted when**: no horizontal scroll at 375 px; the banner is announced by a screen reader; README matches behaviour.
- **Verify**: `npm run build && npm run lint`; resize_window to mobile, screenshot.

## Risks
| Risk | Mitigation |
|---|---|
| Incomplete database data gives a false "clear" | Wording is "not found in listed ingredients" and never "safe"; `unknown` when data is empty; disclaimer; Checkpoint A compares with real labels |
| Keyword rules miss a hidden pork source | Prefer taxonomy tags over text; E-number table; "may contain" for animal-ambiguous items; list in README what is not detected |
| Keyword false positives (porcini) | Word-boundary regexes with tests |
| Halal/vegan labelling disputes | Labels only downgrade `may-contain`, never override `contains` |
| Translation errors | Taxonomy-only; original text always visible; partial-translation note |
| Scope creep (photo OCR of labels, accounts) | Out of scope for v1 |

## Open questions (defaults in brackets; plan was written on these)
1. Which diets for v1? [pork-free, halal, vegetarian, vegan + the 14 allergens; kosher later]
2. Is "translate" about the interface, the ingredients, or both? [ingredients via taxonomy chips + English text from the database; UI labels in the same language]
3. Which languages? [English first; add the 3 or 4 languages the traveller needs: which?]
4. Should the app work offline or save history? [No; history stays in memory as today]
5. Where will it be deployed (phone needs HTTPS)? [Vercel]
6. Is a label-photo (OCR) fallback wanted for products missing from the databases? [No, v2]
