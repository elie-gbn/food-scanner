# Labelens: food scanner

Point your camera at a food or drink barcode to see its caffeine and nutrition facts next to the live camera feed.

- Reads EAN-13, EAN-8, UPC-A and UPC-E barcodes in the browser. It uses the native `BarcodeDetector` when the browser has one and falls back to ZXing WebAssembly otherwise. Video never leaves your device.
- Looks up each barcode live in [Open Food Facts](https://world.openfoodfacts.org) and [USDA FoodData Central](https://fdc.nal.usda.gov) at the same time and merges the results.
- Shows caffeine per serving, per container and per 100 g/ml, compared with the FDA's 400 mg/day guidance. When a product lists no caffeine amount, it still flags caffeine sources it finds in the ingredients, such as coffee, guarana or tea.
- Shows a full nutrition table, Nutri-Score, NOVA group, allergens and ingredients.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Browsers only allow camera access on `localhost` or over HTTPS. To use it on your phone, deploy it (for example to Vercel) or tunnel it over HTTPS.

If no camera is available, you can type a barcode into the box instead.

## Optional

Set `USDA_API_KEY` (free from https://fdc.nal.usda.gov/api-key-signup) for higher USDA rate limits. Without it, the app uses the shared `DEMO_KEY`.
