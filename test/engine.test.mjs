import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, detectIngredients, realNeeds, suggestFor, basicRoutine } from "../public/engine.js";

// A typical teen: some oil and pimples, no wrinkles or spots.
const teen = { acne: 66, oiliness: 58, redness: 88, pore: 72, moisture: 86, texture: 87, radiance: 84, dark_circle_v2: 82, wrinkle: 97, age_spot: 95 };
// A 30-year-old with some fine lines and spots.
const adult = { acne: 92, oiliness: 85, redness: 90, pore: 80, moisture: 75, texture: 78, radiance: 70, dark_circle_v2: 76, wrinkle: 72, age_spot: 74 };

test("detects ingredients in a pasted INCI list", () => {
  const inci = "Aqua, Glycerin, Niacinamide, Retinol, Sodium Hyaluronate, Phenoxyethanol";
  assert.deepEqual(detectIngredients(inci).sort(), ["hyaluronic", "niacinamide", "retinol"]);
});

test("short terms need whole words (no 'aha' inside other words)", () => {
  assert.deepEqual(detectIngredients("Shahabuddin face cream"), []);
  assert.deepEqual(detectIngredients("AHA BHA peeling solution"), ["aha", "bha"]);
  assert.deepEqual(detectIngredients("Matte gel SPF 50"), ["sunscreen"]);
  // titanium dioxide is often just a white colourant (CI 77891), not a sign of sun protection
  assert.deepEqual(detectIngredients("Aqua, Retinol, Titanium Dioxide, CI 77891"), ["retinol"]);
});

test("real needs are scores of 85 or below, worst first", () => {
  assert.deepEqual(realNeeds(teen), ["oiliness", "acne", "pore", "dark_circle_v2", "radiance"]);
});

test("anti-wrinkle cream for a teen: NOT YET", () => {
  const r = judge({ scores: teen, age: 14, ingredients: ["peptides", "collagen"] });
  assert.equal(r.verdict, "not-yet");
  assert.ok(r.reasons.some(x => x.concern === "wrinkle" && x.score === 97));
  assert.deepEqual(r.alternatives.map(i => i.id), ["niacinamide"]); // what they need instead: oil + acne
});

test("retinol for a teen who has rough texture: TOO STRONG, with a gentler option", () => {
  const r = judge({ scores: { ...teen, texture: 70 }, age: 15, ingredients: ["retinol"] });
  assert.equal(r.verdict, "too-strong");
  assert.equal(r.reasons[0].type, "age");
  assert.ok(r.alternatives.every(i => i.strength !== "strong"));
});

test("salicylic face wash for a teen with pimples: GOOD FIT", () => {
  const r = judge({ scores: teen, age: 15, ingredients: ["bha"] });
  assert.equal(r.verdict, "good-fit");
  assert.deepEqual(r.helps.sort(), ["acne", "oiliness", "pore"]);
});

test("sensitive skin turns a moderate ingredient into TOO STRONG", () => {
  const r = judge({ scores: teen, age: 15, ingredients: ["bha"], sensitive: true });
  assert.equal(r.verdict, "too-strong");
  assert.ok(r.alternatives.every(i => i.strength === "gentle"));
});

test("retinol for a 30-year-old with fine lines: GOOD FIT", () => {
  const r = judge({ scores: adult, age: 30, ingredients: ["retinol"] });
  assert.equal(r.verdict, "good-fit");
  assert.ok(r.helps.includes("wrinkle"));
});

test("prescription ingredients are always DOCTOR ONLY", () => {
  assert.equal(judge({ scores: teen, age: 16, ingredients: ["tretinoin"] }).verdict, "doctor-only");
  assert.equal(judge({ scores: adult, age: 30, ingredients: ["hydroquinone", "vitc"] }).verdict, "doctor-only");
});

test("fairness cream for healthy young skin: NOT YET", () => {
  const r = judge({ scores: { ...teen, radiance: 90 }, age: 16, ingredients: ["lightening"] });
  assert.equal(r.verdict, "not-yet");
});

test("sunscreen is a good fit for everyone", () => {
  assert.equal(judge({ scores: teen, age: 13, ingredients: ["sunscreen"] }).verdict, "good-fit");
});

test("no recognised ingredient: UNKNOWN, never a guess", () => {
  assert.equal(judge({ scores: teen, age: 15, ingredients: [] }).verdict, "unknown");
});

test("suggestions skip strong ingredients and respect age", () => {
  const s = suggestFor(["radiance"], 13);
  assert.ok(!s.some(i => i.id === "vitc")); // vitamin C is 16+
});

test("basic routine: oily, acne-prone teen gets a BHA wash, gel moisturiser and gel sunscreen", () => {
  assert.deepEqual(basicRoutine(teen, 15).map(s => s.kind), ["bha-wash", "gel", "gel-spf"]);
  assert.equal(basicRoutine(teen, 15, true)[0].kind, "gentle-wash");
});
