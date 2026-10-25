# Labelens: food scanner

Find out what's in your food: caffeine, nutrition and allergens, shown next to the live camera feed.

- **Scan barcodes.** Reads EAN-13, EAN-8, UPC-A and UPC-E barcodes in the browser. It uses the native `BarcodeDetector` when the browser has one and falls back to ZXing WebAssembly otherwise. Video never leaves your device.
- **Identify food without a barcode.** Tap **Identify food in frame**, or upload a photo. Claude names each food and estimates the portion, then the nutrition comes from USDA FoodData Central, scaled to that portion.
- **Search by name.** For example "espresso" or "banana". Searches USDA generic foods, which include measured caffeine for coffee, tea and chocolate, plus packaged products from Open Food Facts.
- **Allergens.** Checks all 14 major allergens (the EU list, which covers the US "Big 9"). Each one is marked as declared, "may contain", found in the ingredient list, or likely (for photo-identified food). Set **My allergens** to get a warning whenever a food contains one of yours.
- **Saved scans.** Save any result to your library. You can search it, filter it (has my allergens, has caffeine, from photos), sort it, add notes, see today's caffeine total and export to JSON. Saved scans stay in your browser on that device.
- **Caffeine.** Shown per serving, per container and per 100 g/ml, compared with the FDA's 400 mg/day guidance. When a product lists no caffeine amount, it still flags caffeine sources such as coffee, guarana or tea.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Browsers only allow camera access on `localhost` or over HTTPS. On a phone over plain HTTP, **Photo of food** still works, because it uses the phone's own camera app.

## API keys

Copy `.env.example` to `.env.local` and fill in:

| Variable | Needed for | Get one |
|---|---|---|
| `ANTHROPIC_API_KEY` | Identifying food from photos | https://console.anthropic.com |
| `USDA_API_KEY` | Generic-food search and photo nutrition. Without it, the shared `DEMO_KEY` runs out after a few dozen requests an hour | Free, instant: https://fdc.nal.usda.gov/api-key-signup |

Barcode scanning and packaged-product search work without any keys.
