# Labelens: can I eat this?

For travellers who need to know what is in a packaged food. Say what you avoid (pork, halal, vegetarian, vegan, any of the 14 standard allergens, or your own words), point the camera at a barcode, and get a plain answer at the top, such as **CONTAINS PORK**, with the evidence and the matching words highlighted in the ingredient list.

Caffeine and nutrition facts are still shown, below the answer.

## How the answer works

| Result | Meaning |
|---|---|
| **Contains** | A forbidden ingredient is listed, or the product declares your allergen. |
| **May contain** | The source is not stated (gelatin, some E-numbers, rennet, vanilla extract), or it appears under "may contain traces". |
| **Can't tell** | There is not enough data to rule it out: no ingredient list, an unfinished or very short list, or a declared allergen that the list does not explain. |
| **Not found in the listed ingredients** | Nothing matched in a full list. This is **not** a guarantee. |

The app never says "safe". Open Food Facts is crowd-sourced, so a product can be wrong or incomplete. Labels such as "halal" or "vegan" only add a note; they never lower a finding. Always check the printed label.

If a barcode is not in the databases, or the lookup fails, the app says so and lists the words to look for on the package. A failed lookup is never shown as "not found".

## What it reads

- Reads EAN-13, EAN-8, UPC-A and UPC-E barcodes in the browser, with the native `BarcodeDetector` or a ZXing WebAssembly fallback. Video never leaves your device.
- Looks the barcode up in [Open Food Facts](https://world.openfoodfacts.org) and [USDA FoodData Central](https://fdc.nal.usda.gov) and merges the results. Only the barcode is sent to our server.
- Your choices (diet, allergens, words, language) are saved in your browser only and are never sent anywhere.
- Ingredient lists show the original text, plus the database's English version when it has one (it can leave things out, so the original is what counts). Pick another language to get a link to Google Translate; that link sends the ingredient text to Google.

## Not detected

Hidden sources the label does not name (for example "natural flavours", or animal-derived processing aids), ingredients written in a language the matcher does not know and Open Food Facts has not analysed, and cross-contamination that is not printed on the package.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Browsers only allow camera access on `localhost` or over HTTPS. To use it on your phone, deploy it (for example to Vercel) or tunnel it over HTTPS. If no camera is available, type the barcode instead.

```bash
npm test      # unit tests, including real-product fixtures
npm run lint
npm run build
```

## Optional

Set `USDA_API_KEY` (free from https://fdc.nal.usda.gov/api-key-signup). Without it the app uses the shared `DEMO_KEY`, which allows only about 10 requests an hour; when it runs out, unknown barcodes say USDA could not be checked.

## Layout

- `lib/diet.ts`: what each diet and allergen matches (tags, words in many languages, E-numbers).
- `lib/verdict.ts`: turns a product and your profile into findings, and decides when data is too thin to trust.
- `lib/report.ts`: turns Open Food Facts / USDA records into a report.
- `lib/profile.ts`, `lib/translate.ts`, `lib/lookup.ts`: saved choices, translation links, failure states.
- `app/api/food-scanner/route.ts`: the lookup endpoint.
- `tasks/plan.md`: the plan this was built from.
