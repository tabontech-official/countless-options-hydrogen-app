// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { UPLOAD_ACCEPT, hasPrices, mergeFields, uploadMimeType, validateOptionSet } from "./options.js";
import { priceSelection } from "../extensions/product-options-pricing/src/pricing.js";

const field = (over) => ({ id: "f1", type: "text", label: "Engraving", ...over });

test("embedded GraphQL starts on the line after #graphql", () => {
  // `#` comments run to the end of the line, so `#graphql query X { ... }` on one line
  // sends Shopify an empty document ("syntax error, unexpected end of file").
  const dir = new URL(".", import.meta.url);
  for (const file of readdirSync(dir, { recursive: true }).filter((f) => /\.jsx?$/.test(f) && !f.endsWith(".test.js"))) {
    assert.doesNotMatch(readFileSync(new URL(file.replaceAll("\\", "/"), dir), "utf8"), /`#graphql[^\r\n`]/, file);
  }
});

test("accepts a valid set and cleans it", () => {
  const { errors, data } = validateOptionSet({
    name: "  Gift options ",
    status: "DRAFT",
    fields: [
      field({ maxLength: "20", placeholder: "Your text", choices: [{ label: "x" }] }),
      field({ id: "f2", type: "swatch", label: "Color", choices: [{ label: "Red", color: "#FF0000" }, { label: "red", color: "#00ff00" }, { label: "" }] }),
    ],
    productIds: ["gid://shopify/Product/1", "gid://shopify/Product/1", "gid://shopify/Order/2", "nope"],
  });
  assert.deepEqual(errors, []);
  assert.equal(data.name, "Gift options");
  assert.equal(data.status, "DRAFT");
  assert.deepEqual(data.fields[0], { id: "f1", type: "text", label: "Engraving", required: false, placeholder: "Your text", maxLength: 20 });
  assert.deepEqual(data.fields[1].choices, [{ label: "Red", color: "#ff0000" }]); // deduped, blanks dropped, color normalized
  assert.deepEqual(data.productIds, ["gid://shopify/Product/1"]);
});

test("reports merchant-readable errors", () => {
  const { errors } = validateOptionSet({
    name: " ",
    fields: [
      field({ label: "" }),
      field({ label: "Size" }),
      field({ label: "size" }),
      field({ label: "_hidden" }),
      field({ type: "select", label: "Pick", choices: [] }),
      field({ type: "swatch", label: "Shade", choices: [{ label: "Blue", color: "blue" }] }),
      field({ type: "bogus", label: "Fallback" }),
    ],
  });
  assert.deepEqual(errors, [
    "Give this option set a name.",
    "Field 1 needs a label.",
    'Two fields are labeled "size". Labels must be unique.',
    '"_hidden" can\'t start with "_" or contain [ ].',
    '"Pick" needs at least one choice.',
    '"Shade" has a swatch without a valid color.',
  ]);
  assert.deepEqual(validateOptionSet({}).errors, ["Give this option set a name.", "Add at least one field."]);
});

test("keeps prices and conditions, rejects bad ones", () => {
  const size = field({ id: "s", type: "radio", label: "Size", choices: [{ label: "Small", price: "" }, { label: "Large", price: "5.555" }] });
  const { errors, data } = validateOptionSet({
    name: "Priced",
    fields: [
      size,
      field({ id: "g", type: "checkbox", label: "Gift", price: "2" }),
      field({ id: "e", label: "Engraving", price: 10, condition: { fieldId: "s", values: ["Large", "Huge"] } }),
      field({ id: "w", label: "Wrap note", condition: { fieldId: "g", values: ["Yes"] } }),
    ],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(data.fields[0].choices, [{ label: "Small" }, { label: "Large", price: 5.56 }]);
  assert.equal(data.fields[1].price, 2);
  assert.deepEqual(data.fields[2].condition, { fieldId: "s", values: ["Large"] }); // unknown answers dropped
  assert.deepEqual(data.fields[3].condition, { fieldId: "g", values: ["Yes"] });
  assert.equal(hasPrices(data.fields), true);

  const bad = validateOptionSet({
    name: "Bad",
    fields: [
      field({ id: "a", label: "Below", condition: { fieldId: "b", values: ["Yes"] } }), // parent comes later
      field({ id: "b", type: "checkbox", label: "Later", price: -1 }),
      field({ id: "c", type: "select", label: "Pick", choices: [{ label: "X", price: "abc" }] }),
      field({ id: "d", label: "Orphan", condition: { fieldId: "c", values: ["Nope"] } }),
    ],
  });
  assert.deepEqual(bad.errors, [
    "\"Below\" depends on a field that's missing or placed below it.",
    "\"Later\" has a price that isn't between 0 and 100000.",
    "\"Pick\" has a price that isn't between 0 and 100000.",
    "\"Orphan\": choose which answer shows this field.",
  ]);
  assert.equal(hasPrices(validateOptionSet({ name: "Free", fields: [field()] }).data.fields), false);
});

test("number fields and 'charge for each' pricing", () => {
  const teeth = { id: "t", type: "number", label: "Teeth", integer: true, min: "0.5", max: "32.9", unit: " tooth " };
  const metal = { id: "m", type: "radio", label: "Metal", per: "t", choices: [{ label: "Silver", price: "20" }, { label: "Gold", price: "50" }] };
  const { errors, data } = validateOptionSet({ name: "Grillz", fields: [metal, teeth] }); // multiplier may come later
  assert.deepEqual(errors, []);
  assert.equal(data.fields[0].per, "t");
  assert.deepEqual(data.fields[1], { id: "t", type: "number", label: "Teeth", required: false, integer: true, min: 1, max: 32, unit: "tooth" });

  // A priced count always prices itself (4 teeth × $50), whatever the browser sent.
  for (const per of ["t", undefined, "m"]) {
    assert.equal(validateOptionSet({ name: "X", fields: [{ ...teeth, price: "50", per }] }).data.fields[0].per, "t");
  }

  const errorsFor = (overTeeth, overMetal = {}) =>
    validateOptionSet({ name: "X", fields: [{ ...metal, ...overMetal }, { ...teeth, ...overTeeth }] }).errors;
  assert.deepEqual(errorsFor({ max: "" }), ['"Teeth" needs a lowest and highest allowed number, because prices are multiplied by it.']);
  assert.deepEqual(errorsFor({ min: "" }), ['"Teeth" needs a lowest and highest allowed number, because prices are multiplied by it.']);
  assert.deepEqual(errorsFor({ min: "-2" }), [`"Teeth" can't go below 0, because prices are multiplied by it.`]);
  assert.deepEqual(errorsFor({ min: "40" }), [`"Teeth": the lowest allowed number can't be more than the highest.`]);
  assert.deepEqual(errorsFor({ min: "lots" }), [
    '"Teeth" needs lowest and highest allowed numbers between -1000000 and 1000000.',
    '"Teeth" needs a lowest and highest allowed number, because prices are multiplied by it.',
  ]);
  assert.deepEqual(errorsFor({ type: "text" }), ['"Metal" is charged for each unit of a number field that no longer exists.']);
  assert.deepEqual(errorsFor({}, { per: "gone" }), ['"Metal" is charged for each unit of a number field that no longer exists.']);
  // "For each" without any price is meaningless, so it's dropped instead of demanding limits.
  const free = validateOptionSet({ name: "X", fields: [{ ...metal, choices: [{ label: "Silver" }] }, { ...teeth, max: "" }] });
  assert.deepEqual(free.errors, []);
  assert.equal(free.data.fields[0].per, undefined);
});

test("follow-ups chain several levels deep", () => {
  const { errors, data } = validateOptionSet({
    name: "Grillz",
    fields: [
      { id: "d", type: "checkbox", label: "Diamonds", price: "10" },
      { id: "k", type: "radio", label: "Diamond type", condition: { fieldId: "d", values: ["Yes"] }, choices: [{ label: "Regular" }, { label: "VVS", price: "30" }] },
      { id: "s", type: "radio", label: "Setting", condition: { fieldId: "k", values: ["VVS"] }, choices: [{ label: "Prong" }, { label: "Bezel", price: "5" }] },
    ],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(data.fields.map((f) => f.condition?.fieldId), [undefined, "d", "k"]);
});

test("merges sets per product, first label wins", () => {
  const merged = mergeFields([[field({ id: "a" })], [field({ id: "b", label: "ENGRAVING" }), field({ id: "c", label: "Wrap" })]]);
  assert.deepEqual(merged.map((f) => f.id), ["a", "c"]);
});

test("every template is a valid option set", async () => {
  const { TEMPLATES, templateFields } = await import("./templates.js");
  for (const t of TEMPLATES) {
    const { errors } = validateOptionSet({ name: t.name, fields: templateFields(t) });
    assert.deepEqual(errors, [], t.id);
  }
});

test("file uploads: allowed types, saved like text, charged once when uploaded", () => {
  assert.equal(uploadMimeType("Logo.PNG"), "image/png");
  assert.equal(uploadMimeType("scan.heic"), "image/heic");
  assert.equal(uploadMimeType("form.pdf"), "application/pdf");
  assert.equal(uploadMimeType("Brief.DOCX"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(uploadMimeType("sizes.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  for (const name of ["virus.exe", "page.html", "pdf", "no-extension", "x.constructor", undefined]) assert.equal(uploadMimeType(name), null, name);
  // The theme block's file picker offers exactly what the server accepts.
  const block = readFileSync(new URL("../extensions/product-options/blocks/product_options.liquid", import.meta.url), "utf8");
  assert.ok(block.includes(`accept="${UPLOAD_ACCEPT}"`), "product_options.liquid accept= is out of date");

  const { errors, data } = validateOptionSet({ name: "Artwork", fields: [field({ id: "u", type: "file", label: "Your artwork", price: "5" })] });
  assert.deepEqual(errors, []);
  assert.equal(data.fields[0].type, "file");
  assert.equal(data.fields[0].price, 5);

  const url = "https://cdn.shopify.com/s/files/1/0/files/logo.png?v=1";
  assert.equal(priceSelection(data.fields, { u: url }).total, 5);
  assert.deepEqual(priceSelection(data.fields, { u: url }).display, [{ label: "Your artwork", value: url }]);
  assert.equal(priceSelection(data.fields, {}).total, 0);
});
