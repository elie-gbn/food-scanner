# Labelens: food scanner

Find out what's in your food: caffeine, nutrition and allergens, shown next to the live camera feed.

- **Scan barcodes.** Reads EAN-13, EAN-8, UPC-A and UPC-E barcodes in the browser. It uses the native `BarcodeDetector` when the browser has one and falls back to ZXing WebAssembly otherwise. Video never leaves your device.
- **Identify food without a barcode.** Tap **Identify food in frame**, or upload a photo. A small MobileCLIP model (~43 MB, downloaded once) recognizes it **on your device**: free, private, and quick after the first load. It knows about 155 everyday foods and drinks, and gives one-tap alternatives when it isn't sure.
- **Search by name.** For example "espresso", "banana" or "red bull". Searches about 5,400 USDA generic foods bundled with the app (with measured caffeine for coffee, tea, energy drinks and chocolate), plus packaged products from Open Food Facts.
- **Allergens.** Checks all 14 major allergens (the EU list, which covers the US "Big 9"). Each one is marked as declared, "may contain", found in the ingredient list, or likely (for photo-identified food). Set **My allergens** to get a warning whenever a food contains one of yours.
- **Saved scans.** Save any result to your library. You can search it, filter it (has my allergens, has caffeine, from photos), sort it, add notes, see today's caffeine total and export to JSON. Saved scans stay in your browser on that device.
- **Caffeine.** Shown per serving, per container and per 100 g/ml, compared with the FDA's 400 mg/day guidance. When a product lists no caffeine amount, it still flags caffeine sources such as coffee, guarana or tea.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Browsers only allow camera access on `localhost` or over HTTPS. On a phone over plain HTTP, **Photo of food** still works, because it uses the phone's own camera app.

## Free to run

There are no paid APIs and no keys required:

| Feature | How it's free |
|---|---|
| Barcode scanning | Runs in the browser; products come from Open Food Facts (free, open data) |
| Photo recognition | MobileCLIP runs on the device via [Transformers.js](https://github.com/huggingface/transformers.js); photos never leave it |
| Generic foods and photo nutrition | USDA FNDDS, bundled in `data/generic-foods.json` (public domain) |
| Saved scans | Stored in the browser |

Optional: set `USDA_API_KEY` in `.env.local` (free, instant at https://fdc.nal.usda.gov/api-key-signup). It adds USDA branded-product results to name search and a USDA fallback for barcodes that Open Food Facts doesn't know.

## Updating the data

- **Photo foods:** edit `data/foods.ts`, then `npm run embeddings` to re-compute `public/food-embeddings.json`.
- **USDA generic foods:** download the latest FNDDS JSON release from https://fdc.nal.usda.gov/download-datasets/, unzip it, then `npm run usda -- path/to/surveyDownload.json`.
