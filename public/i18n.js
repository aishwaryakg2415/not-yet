// Labels and the parent summary. The Hindi was machine-drafted: have a native speaker check it before the demo.

export const LANGS = { en: "English", hi: "हिन्दी" };

export const T = {
  en: {
    concern: { acne: "Pimples", oiliness: "Oily skin", redness: "Redness", pore: "Open pores", moisture: "Dryness", texture: "Rough texture",
      radiance: "Dullness", dark_circle_v2: "Dark circles", wrinkle: "Fine lines", age_spot: "Dark spots" },
    verdict: { "not-yet": "Not yet", "too-strong": "Too strong for now", "good-fit": "Good fit", "doctor-only": "Doctor only", unknown: "Couldn't tell" },
    kind: {
      "bha-wash": "Face wash with salicylic acid (up to 2%)", "gentle-wash": "Gentle, fragrance-free face wash",
      "barrier-cream": "Moisturiser with ceramides", gel: "Light, oil-free gel moisturiser", "light-lotion": "Light moisturiser",
      "gel-spf": "Gel sunscreen, SPF 30 or more", spf: "Sunscreen, SPF 30 or more",
    },
    step: { cleanser: "Wash", moisturiser: "Moisturise", sunscreen: "Protect (mornings)" },
    summary: {
      title: "Skin check summary (Not Yet)",
      product: "Product checked", verdict: "Verdict", skinAge: "Skin age (estimate)", needs: "What the skin needs most",
      instead: "Gentler ingredients to look for", routine: "Simple routine", none: "-",
      footer: "Cosmetic guidance only, not medical advice. For painful or lasting pimples, see a dermatologist.",
    },
  },
  hi: {
    concern: { acne: "मुंहासे", oiliness: "तैलीय त्वचा", redness: "लालिमा", pore: "खुले रोमछिद्र", moisture: "रूखापन", texture: "खुरदरी त्वचा",
      radiance: "बेजान त्वचा", dark_circle_v2: "काले घेरे", wrinkle: "महीन रेखाएँ", age_spot: "काले धब्बे" },
    verdict: { "not-yet": "अभी नहीं", "too-strong": "अभी बहुत तेज़", "good-fit": "सही चुनाव", "doctor-only": "केवल डॉक्टर की सलाह पर", unknown: "पता नहीं चल सका" },
    kind: {
      "bha-wash": "सैलिसिलिक एसिड (2% तक) वाला फेस वॉश", "gentle-wash": "हल्का, बिना खुशबू वाला फेस वॉश",
      "barrier-cream": "सेरामाइड वाला मॉइस्चराइज़र", gel: "हल्का, ऑयल-फ्री जेल मॉइस्चराइज़र", "light-lotion": "हल्का मॉइस्चराइज़र",
      "gel-spf": "जेल सनस्क्रीन, SPF 30 या ज़्यादा", spf: "सनस्क्रीन, SPF 30 या ज़्यादा",
    },
    step: { cleanser: "धोएँ", moisturiser: "मॉइस्चराइज़ करें", sunscreen: "धूप से बचाव (सुबह)" },
    summary: {
      title: "त्वचा जाँच का सार (Not Yet)",
      product: "जाँचा गया प्रोडक्ट", verdict: "नतीजा", skinAge: "त्वचा की उम्र (अनुमान)", needs: "त्वचा को सबसे ज़्यादा ज़रूरत",
      instead: "इन हल्के इंग्रीडिएंट्स को देखें", routine: "आसान रूटीन", none: "-",
      footer: "यह केवल कॉस्मेटिक सलाह है, चिकित्सा सलाह नहीं। दर्द वाले या लंबे समय तक रहने वाले मुंहासों के लिए त्वचा विशेषज्ञ से मिलें।",
    },
  },
};

/** Plain-text summary a teen can send to a parent on WhatsApp. Ingredient names stay in English (as on labels). */
export function summaryText(lang, { product, verdict, skinAge, top, alternatives, routine, ingredientName }) {
  const t = T[lang] ?? T.en;
  const s = t.summary;
  return [
    `*${s.title}*`,
    "",
    `${s.product}: ${product || s.none}`,
    `${s.verdict}: *${t.verdict[verdict]}*`,
    skinAge != null ? `${s.skinAge}: ${skinAge}` : null,
    `${s.needs}: ${top.map(c => t.concern[c]).join(", ") || s.none}`,
    alternatives.length ? `${s.instead}: ${alternatives.map(ingredientName).join(", ")}` : null,
    "",
    `*${s.routine}*`,
    ...routine.map(r => `• ${t.step[r.step]}: ${t.kind[r.kind]}`),
    "",
    `_${s.footer}_`,
  ].filter(x => x !== null).join("\n");
}
