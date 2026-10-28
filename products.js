// Product lookup: Open Beauty Facts (free, open database of cosmetics, ODbL licence),
// with typo correction and ranking. Separate from server.js so it can be tested on its own.
import { INGREDIENTS } from "./public/engine.js";
import { searchShops } from "./web.js";

class LookupError extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

const OBF = "https://world.openbeautyfacts.org";
const OBF_FIELDS = "code,product_name,brands,ingredients_text,image_front_small_url";
const obfCache = new Map();

async function obf(path) {
  if (obfCache.has(path)) return obfCache.get(path);
  const r = await fetch(OBF + path, { headers: { "User-Agent": "NotYet/0.1 (YouCam hackathon project)" }, signal: AbortSignal.timeout(12000) })
    .catch(() => { throw new LookupError(502, "lookup_unavailable", "The product database didn't answer. Paste the ingredients instead."); });
  if (!r.ok) throw new LookupError(502, "lookup_unavailable", "The product database didn't answer. Paste the ingredients instead.");
  const j = await r.json();
  if (obfCache.size > 500) obfCache.clear();
  obfCache.set(path, j);
  return j;
}

const slim = p => ({
  code: p.code, name: (p.product_name ?? "").trim(), brand: (p.brands ?? "").split(",")[0].trim(),
  ingredients: (p.ingredients_text ?? "").replace(/^\s*ingredients\s*:\s*/i, "").trim(), image: p.image_front_small_url ?? null,
});

const fold = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ");
const STOP = new Set(["and", "the", "for", "with", "of"]);

// Typo correction: words we expect people to type, so "lakmay" -> "lakme", "niacinmide" -> "niacinamide".
const VOCAB = new Set([
  "lakme", "mamaearth", "minimalist", "plum", "cetaphil", "neutrogena", "nivea", "garnier", "himalaya", "ponds", "olay", "cerave",
  "derma", "dot", "key", "lotus", "biotique", "mcaffeine", "foxtale", "deconstruct", "simple", "loreal", "nykaa", "patanjali", "vlcc",
  "kaya", "clinique", "innisfree", "cosrx", "ordinary", "inkey", "bioderma", "roche", "posay", "aveeno", "vaseline", "boroplus", "dove",
  "face", "wash", "facewash", "serum", "sunscreen", "cream", "moisturiser", "moisturizer", "toner", "gel", "cleanser", "lotion", "mask",
  "scrub", "night", "day", "spf", "acne", "anti", "glow", "brightening", "foaming", "oil", "free", "water", "rice", "tea", "tree", "green",
  ...INGREDIENTS.flatMap(i => i.match.flatMap(m => m.split(/\s+/))), "vitamin", "hyaluronic", "ceramide", "niacinamide", "salicylic", "retinol",
].filter(w => w.length >= 3));

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function correctQuery(q) {
  return tokens(q).map(w => {
    if (w.length < 4 || VOCAB.has(w) || /\d/.test(w)) return w;
    const max = w.length >= 6 ? 2 : 1;
    let best = null, bestD = max + 1;
    for (const v of VOCAB) { if (Math.abs(v.length - w.length) > max) continue; const dd = editDistance(w, v); if (dd < bestD) { best = v; bestD = dd; } }
    return best ?? w;
  }).join(" ");
}

// Open Beauty Facts only finds products whose text contains every word, so "minimalist niacinamide"
// finds nothing. Search the whole phrase plus each word, merge, and rank by how many words match.
// Not face skincare: shown last, not hidden (the user may really mean it).
const NOT_FACE = /shampoo|conditioner|hair|deodorant|toothpaste|perfume|parfum|nail|mascara|lipstick|lip balm|body wash|shower/;
export const tokens = s => fold(s).split(/[^a-z0-9%]+/).filter(Boolean);

// Two sources, searched at the same time:
//  - Open Beauty Facts (global, volunteer-filled, ingredient list included when someone typed it in)
//  - Indian brands' own stores (web.js): the official page, ingredients extracted when the user picks one
export async function searchProducts(q) {
  // Short words ("co" in "The Derma Co") count for ranking as whole words, but are too vague to search on.
  const words = [...new Set(tokens(q).filter(w => w.length >= 2 && !STOP.has(w)))];
  const queries = [q, ...(words.length > 1 ? words.filter(w => w.length >= 3) : [])].slice(0, 5);
  const [shops, ...pages] = await Promise.allSettled([searchShops(q), ...queries.map(s =>
    obf(`/cgi/search.pl?search_terms=${encodeURIComponent(s)}&search_simple=1&action=process&json=1&page_size=40&fields=${OBF_FIELDS}`))]);
  if (shops.status === "rejected" && pages.every(p => p.status === "rejected")) throw pages[0].reason;
  const named = shops.value?.brand ?? null;

  const byKey = new Map();
  for (const p of shops.value?.products ?? []) byKey.set(`${p.domain}${p.path}`, p);
  for (const p of pages) for (const x of p.value?.products ?? []) if (x.code && !byKey.has(x.code)) byKey.set(x.code, { source: "db", ...slim(x) });

  const ranked = [...byKey.values()].filter(p => p.name).map(p => {
    const toks = tokens(`${p.brand} ${p.name}`);
    const hit = w => w.length < 3 ? toks.includes(w) : toks.some(t => t.startsWith(w) || (w.length >= 5 && t.includes(w)));
    // A brand's own store counts as matching the brand words even when the title doesn't repeat the brand.
    const brandHits = p.source === "shop" && named === p.brand ? tokens(p.brand).filter(t => words.includes(t)).length : 0;
    const hits = Math.min(words.length, words.filter(hit).length + brandHits);
    // Can this result give a real verdict? DB entries only if they have a list; official pages usually do.
    const usable = p.source === "shop" || !!p.ingredients;
    return { ...p, hits, usable, face: !NOT_FACE.test(fold(p.name)) };
  }).filter(p => p.hits > 0 || !words.length);

  // Best match first; then face products; then official pages and lists; then shorter names.
  ranked.sort((a, b) => b.hits - a.hits || b.face - a.face || b.usable - a.usable || (b.source === "shop") - (a.source === "shop") || a.name.length - b.name.length);
  const exact = ranked.length > 0 && ranked[0].hits === words.length;
  return { products: ranked.slice(0, 10).map(({ hits, face, usable, ...p }) => p), exact };
}

export async function productByCode(code) {
  const j = await obf(`/api/v2/product/${encodeURIComponent(code)}?fields=${OBF_FIELDS}`);
  return j.product ? { source: "db", ...slim(j.product) } : null;
}

