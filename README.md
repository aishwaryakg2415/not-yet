# Not Yet

**Skincare for your skin, not your feed.** A skin check for teens and their parents, built on the YouCam AI Skin Analysis API.

Teens see retinol, acid peels and anti-ageing serums all over social media and buy them. Most young skin doesn't need these, and strong actives can irritate it. Parents usually can't tell what's okay either.

Not Yet answers one question at the moment of wanting: **does this product match what *my* skin needs right now?**

1. **The product.** Type its name or barcode (or scan the barcode on Android). The app finds the real ingredient list in [Open Beauty Facts](https://world.openbeautyfacts.org), an open cosmetics database, and picks out 16 common actives: retinol, AHAs, salicylic acid, niacinamide, peptides, lightening agents, prescription retinoids and more. It also searches the official stores of Indian brands (Minimalist, The Derma Co, Plum, Dot & Key, Mamaearth, Re'equil, Pilgrim): when one is picked, the server reads that product page and extracts its ingredient list, first with a pattern and otherwise with Gemini reading only that page. Every ingredient Gemini returns must appear on the page, or the result is thrown away. If there's no list anywhere, the app says so and works from the name, or the user can paste the list from the box.
2. **A selfie.** YouCam AI Skin Analysis scores 10 concerns, including **fine lines** and **dark spots** (what anti-ageing products target), and estimates **skin age**.
3. **A verdict, with the evidence:**
   - 🛑 **Not yet**: everything the product targets already scores healthy ("Fine lines: 97/100").
   - ⚠️ **Too strong for now**: it aims at a real need, but the ingredient is stronger than this age or skin type needs.
   - ✅ **Good fit**: it targets one of the customer's real top needs.
   - 🩺 **Doctor only**: prescription-strength ingredients (tretinoin, hydroquinone).
   - ❓ **Couldn't tell**: no recognised ingredients. The app never guesses.
4. **What to use instead.** The gentlest suitable ingredient for the teen's actual top needs, and a simple 3-step routine.
5. **Parents in the loop.** Under-18s need a parent or guardian's agreement before the camera unlocks. The result can be sent to a parent on WhatsApp, in English or Hindi.

6. **Ask about this product.** Questions like "can I use it with my face wash?" are answered with retrieval-augmented generation (RAG). The server retrieves the product's ingredient list, the person's scan, the guide entry for each ingredient and the best-matching facts from a small reviewed knowledge base (`knowledge.js`, BM25 ranking). Then Gemini answers **only from those numbered sources**, cites them, and says so when they don't cover the question. Only the ingredient list, scores, age and question are sent to Gemini, never the selfie. Text inside an ingredient list is treated as data, so instructions planted there are ignored.

Checking another product reuses the same scan, so comparing products costs no extra API units. Product search also corrects typos ("lakmay sunscreen" → "lakme sunscreen").

## YouCam API used

- **File API**: `POST /s2s/v2.0/file`, then a PUT of the selfie to the pre-signed URL
- **AI Skin Analysis (SD)**: `POST /s2s/v2.0/task/skin-analysis` with 10 `dst_actions` (`acne, oiliness, redness, pore, moisture, texture, radiance, dark_circle_v2, wrinkle, age_spot`), then polling `GET /s2s/v2.0/task/skin-analysis/{task_id}`. The app uses the per-concern `raw_score`, the `all` score and `skin_age`.
- **Credits**: `GET /s2s/v1.0/client/credit`

Also used: [Open Beauty Facts](https://world.openbeautyfacts.org) for ingredient lists, and the Google Gemini API (optional) for the Ask feature.

The verdicts compare **`raw_score`**, not `ui_score`. The docs say the UI score is adjusted "to produce more favorable results", and a "you don't need this" verdict has to rest on the real measurement.

## Run it

Needs Node.js 22 or newer. No npm packages.

```powershell
git clone <this repo>
cd not-yet
copy .env.example .env      # then put your YouCam API key in .env
npm run dev                 # http://localhost:3000, uses the real API
```

**Example-data mode** (no key needed, no units spent): `npm run demo`. Scans return a built-in example teen result and an "Example data" badge is shown. The app also uses this mode automatically when no API key is set.

Tests: `npm test` (22 tests: verdict engine, ingredient detection, retrieval, typo correction, citations).

## Deploy (free, HTTPS for the phone camera)

The repo includes a Render Blueprint (`render.yaml`). On [Render](https://render.com): **New → Blueprint →** pick this repo. Render asks for `YOUCAM_API_KEY` and `GEMINI_API_KEY` (optional) and deploys. `MAX_SCANS_PER_DAY` (default 30) and `MAX_ASKS_PER_DAY` (default 200) cap usage so the free units last through judging. The free plan sleeps when idle, so the first visit after a while takes about 30 seconds.

## Install on a phone

Not Yet is a Progressive Web App. Open the deployed link, then:
- **Android (Chrome):** menu → **Add to Home screen** / **Install app**
- **iPhone (Safari):** Share → **Add to Home Screen**

It opens full-screen like a native app, and the app shell works offline (scans and questions need a connection).

## Safety and privacy

- The selfie goes to YouCam for analysis and is **not stored** by this app. Nothing is saved except the chosen summary language.
- Under 18: the camera stays locked until a parent or guardian agrees.
- The ingredient guidance is general and cautious ("usually not needed before about 25"), not medical advice. Prescription ingredients always point to a doctor.
- No brands: the app judges ingredients, not products.

## Project layout

```
server.js            zero-dependency Node server: static files + YouCam calls + example-data mode + daily caps
products.js          product search: Open Beauty Facts + brand stores, ranking, typo correction
web.js               brand-store search and ingredient extraction from official product pages
rag.js               retrieval (BM25 over knowledge.js + product + scan) and grounded Gemini answers
knowledge.js         the reviewed skincare facts the Ask feature may answer from
public/engine.js     ingredient guide, ingredient detection, verdict engine (pure, shared by browser and tests)
public/i18n.js       labels and the parent summary in English / Hindi
public/app.js        the phone UI (Check, Guide, Ask)
public/sw.js         service worker: installable app + offline shell
fixtures/            example teen scan in YouCam's result format
test/                node:test tests
scripts/             one-off API checks (smoke test, unit balance, feature costs)
```

## License

MIT
