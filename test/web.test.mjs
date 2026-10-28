import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBrand, groundedShare } from "../web.js";

test("brand names are recognised in the query", () => {
  assert.equal(splitBrand("minimalist niacinamide").shop.brand, "Minimalist");
  assert.equal(splitBrand("Dot & Key sunscreen").rest, "sunscreen");
  assert.equal(splitBrand("the derma co salicylic").shop.brand, "The Derma Co");
  assert.equal(splitBrand("retinol serum").shop, null);
});

test("an extracted list must actually appear on the page", () => {
  const page = "Ingredients: Aqua, Niacinamide, Zinc PCA, Glycerin. How to use: apply at night.";
  assert.equal(groundedShare("Aqua, Niacinamide, Zinc PCA, Glycerin", page), 1);
  // invented ingredients fail the check
  assert.ok(groundedShare("Aqua, Retinol, Peptides, Glycerin", page) < 0.85);
});
