import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSupplierDocumentNumber } from "../../modules/procurement/domain/invoice.js";
import {
  canonicalJson,
  currencyDigits,
  fingerprint,
  roundCurrency,
} from "../../modules/procurement/application/invoice-primitives.js";

test("supplier document identity normalization is NFKC, whitespace and case stable but punctuation preserving", () => {
  assert.equal(
    normalizeSupplierDocumentNumber("  inv\u00a0  ００７ / A-1 "),
    "INV 007 / A-1",
  );
  assert.notEqual(
    normalizeSupplierDocumentNumber("INV-001"),
    normalizeSupplierDocumentNumber("INV001"),
  );
});

test("match fingerprints use deterministic object ordering and currency minor units", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
  assert.equal(currencyDigits("USD"), 2);
  assert.equal(currencyDigits("VND"), 0);
  assert.equal(roundCurrency(1.005, "USD"), 1.01);
  assert.equal(roundCurrency(1200.5, "VND"), 1201);
});
