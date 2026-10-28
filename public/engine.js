// Not Yet: does this product match what YOUR skin needs right now?
// Pure functions, no DOM, so the browser and the tests share the same code.

// YouCam SD concerns we request (9-12 concerns = one price tier). wrinkle and age_spot are what
// anti-ageing products target; asking for them lets the app say "not yet" with evidence.
export const CONCERNS = ["acne", "oiliness", "redness", "pore", "moisture", "texture", "radiance", "dark_circle_v2", "wrinkle", "age_spot"];

const REAL_NEED = 15;   // raw_score <= 85 counts as a real concern
const ADULT = 18;

// General cosmetic guidance, written cautiously. Not medical advice.
// strength: gentle | moderate | strong | doctor (prescription / doctor-supervised only)
// minAge: below this age the ingredient is generally not needed or too strong for everyday use.
export const INGREDIENTS = [
  { id: "retinol", name: "Retinol / retinal", match: ["retinol", "retinal", "retinyl", "retinoate"], targets: ["wrinkle", "texture", "age_spot"], strength: "strong", minAge: 25,
    note: "An anti-ageing ingredient. It can cause dryness, peeling and sun sensitivity." },
  { id: "tretinoin", name: "Tretinoin / adapalene", match: ["tretinoin", "adapalene", "tazarotene"], targets: ["acne", "wrinkle", "texture"], strength: "doctor", minAge: 0,
    note: "A prescription retinoid. Use it only if a doctor prescribes it." },
  { id: "hydroquinone", name: "Hydroquinone", match: ["hydroquinone"], targets: ["age_spot"], strength: "doctor", minAge: 0,
    note: "A strong lightening agent, used under a doctor's supervision." },
  { id: "aha", name: "Glycolic / lactic acid (AHA)", match: ["glycolic", "lactic acid", "mandelic", "aha"], targets: ["texture", "radiance", "age_spot"], strength: "strong", minAge: 18,
    note: "An exfoliating acid. Daily or high-strength use can irritate young skin." },
  { id: "lightening", name: "Skin lightening / fairness", match: ["kojic", "arbutin", "fairness", "whitening", "glutathione"], targets: ["age_spot", "radiance"], strength: "strong", minAge: 18,
    note: "Lightens dark spots or overall skin tone. Healthy skin doesn't need a lighter tone." },
  { id: "vitc", name: "Vitamin C", match: ["ascorbic", "vitamin c", "ascorbyl"], targets: ["radiance", "age_spot"], strength: "moderate", minAge: 16,
    note: "Brightens and helps with dark spots. Higher strengths can sting." },
  { id: "peptides", name: "Peptides", match: ["peptide", "matrixyl", "argireline"], targets: ["wrinkle"], strength: "gentle", minAge: 25,
    note: "Marketed for fine lines. Gentle, but young skin rarely needs it." },
  { id: "collagen", name: "Collagen / anti-wrinkle cream", match: ["collagen", "anti-wrinkle", "anti wrinkle", "anti-ageing", "anti-aging"], targets: ["wrinkle", "moisture"], strength: "gentle", minAge: 25,
    note: "Mostly a moisturiser with anti-ageing marketing." },
  { id: "bakuchiol", name: "Bakuchiol", match: ["bakuchiol"], targets: ["wrinkle", "texture"], strength: "gentle", minAge: 25,
    note: "A plant-based retinol alternative, also aimed at fine lines." },
  { id: "bha", name: "Salicylic acid (BHA)", match: ["salicylic", "bha", "beta hydroxy"], targets: ["acne", "oiliness", "pore"], strength: "moderate", minAge: 12,
    note: "Unclogs pores. A low-strength face wash (up to 2%) is a common first step for pimples." },
  { id: "bpo", name: "Benzoyl peroxide", match: ["benzoyl"], targets: ["acne"], strength: "moderate", minAge: 12,
    note: "A pimple spot treatment. Start with a low strength; it can dry the skin and bleach fabric." },
  { id: "niacinamide", name: "Niacinamide", match: ["niacinamide", "nicotinamide"], targets: ["oiliness", "pore", "redness", "acne", "texture"], strength: "gentle", minAge: 12,
    note: "Helps with oil, pores and redness. Usually well tolerated at 2–5%." },
  { id: "azelaic", name: "Azelaic acid", match: ["azelaic"], targets: ["redness", "acne", "age_spot"], strength: "moderate", minAge: 14,
    note: "Helps with redness and pimple marks." },
  { id: "hyaluronic", name: "Hyaluronic acid", match: ["hyaluronic", "hyaluronate"], targets: ["moisture"], strength: "gentle", minAge: 0,
    note: "Holds water in the skin. Gentle hydration." },
  { id: "ceramides", name: "Ceramides", match: ["ceramide"], targets: ["moisture", "redness"], strength: "gentle", minAge: 0,
    note: "Repairs the skin barrier. Good for dry or easily irritated skin." },
  { id: "sunscreen", name: "Sunscreen (SPF)", match: ["spf", "sunscreen", "sun screen", "avobenzone", "octocrylene", "uvinul", "tinosorb"], targets: [], strength: "gentle", minAge: 0,
    note: "Good for everyone, every day.", always: true },
];

export const byId = Object.fromEntries(INGREDIENTS.map(i => [i.id, i]));
const RANK = { gentle: 0, moderate: 1, strong: 2, doctor: 3 };

/** Find known ingredients in a pasted ingredient list or product name. Short terms (aha, bha, spf) must be whole words. */
export function detectIngredients(text) {
  const t = String(text).toLowerCase();
  const hit = m => m.length <= 3 ? new RegExp(`\\b${m}\\b`).test(t) : t.includes(m);
  return INGREDIENTS.filter(i => i.match.some(hit)).map(i => i.id);
}

/** Concerns sorted by need. Scores are YouCam raw_score, higher = healthier. */
export function needs(scores) {
  return CONCERNS.filter(c => typeof scores[c] === "number")
    .map(c => ({ concern: c, score: scores[c], need: 100 - scores[c] }))
    .sort((a, b) => b.need - a.need);
}
export const realNeeds = scores => needs(scores).filter(n => n.need >= REAL_NEED).map(n => n.concern);

/** The gentlest suitable ingredient for each concern, for this age. */
export function suggestFor(concerns, age, sensitive = false) {
  const out = [];
  for (const c of concerns) {
    const ok = INGREDIENTS.filter(i => i.targets.includes(c) && RANK[i.strength] <= 1 && age >= i.minAge && !(sensitive && i.strength !== "gentle"));
    ok.sort((a, b) => RANK[a.strength] - RANK[b.strength] || b.targets.length - a.targets.length);
    if (ok[0] && !out.some(o => o.id === ok[0].id)) out.push(ok[0]);
  }
  return out;
}

/**
 * The verdict for one product.
 * verdict: "good-fit" | "not-yet" | "too-strong" | "doctor-only" | "unknown"
 */
export function judge({ scores, age, ingredients, sensitive = false }) {
  const ings = ingredients.map(id => byId[id]).filter(Boolean);
  const real = realNeeds(scores);
  const top = real.slice(0, 2);
  const targets = [...new Set(ings.flatMap(i => i.targets))];
  const helps = targets.filter(c => real.includes(c));
  const notNeeded = targets.filter(c => !real.includes(c) && typeof scores[c] === "number");
  const alternatives = suggestFor(top, age, sensitive);
  const base = { targets, helps, notNeeded, top, alternatives, ingredients: ings.map(i => i.id) };

  if (!ings.length) return { ...base, verdict: "unknown", reasons: [] };
  if (ings.every(i => i.always)) return { ...base, verdict: "good-fit", reasons: [{ type: "sunscreen" }] };

  const doctor = ings.filter(i => i.strength === "doctor");
  if (doctor.length) return { ...base, verdict: "doctor-only", reasons: doctor.map(i => ({ type: "doctor", ingredient: i.id })) };

  if (!helps.length) {
    return { ...base, verdict: "not-yet", reasons: notNeeded.map(c => ({ type: "fine", concern: c, score: scores[c] })) };
  }

  const tooStrong = ings.filter(i => !i.always && (age < i.minAge || (sensitive && RANK[i.strength] >= 1) || (age < ADULT && i.strength === "strong")));
  if (tooStrong.length) {
    return { ...base, verdict: "too-strong", reasons: tooStrong.map(i => ({ type: age < i.minAge ? "age" : "strength", ingredient: i.id, minAge: i.minAge })) };
  }

  return { ...base, verdict: "good-fit", reasons: helps.map(c => ({ type: "helps", concern: c, score: scores[c] })) };
}

/** A basic 3-step routine aimed at the real top needs, using ingredient types (no brands). */
export function basicRoutine(scores, age, sensitive = false) {
  const real = realNeeds(scores);
  const acne = real.includes("acne") || real.includes("pore");
  const oily = real.includes("oiliness");
  const dry = real.includes("moisture") || real.includes("redness");
  return [
    { step: "cleanser", kind: acne && age >= 12 && !sensitive ? "bha-wash" : "gentle-wash" },
    { step: "moisturiser", kind: dry ? "barrier-cream" : oily ? "gel" : "light-lotion" },
    { step: "sunscreen", kind: oily ? "gel-spf" : "spf" },
  ];
}
