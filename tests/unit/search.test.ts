import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeExactTerm,
  normalizeSearchText,
} from "../../modules/search/index.js";

test("search normalization folds Vietnamese accents and punctuation", () => {
  assert.equal(normalizeSearchText("Máy chủ Hà Nội"), "may chu ha noi");
  assert.equal(normalizeExactTerm("Máy-chủ"), "may chu");
});

test("structured MAC/IP identifiers compact separators for exact matching", () => {
  assert.equal(normalizeExactTerm("00:1B:44:11:3A:B7"), "001b44113ab7");
  assert.equal(normalizeExactTerm("10.20.30.40"), "10203040");
});
