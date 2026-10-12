// Field model shared by the admin editor (browser) and the server.
// Stored as JSON on OptionSet.fields; options.server.js merges the fields of every
// active set on a product into the `$app.options` metafield the theme block renders
// and the pricing function charges from.
//
// Field: { id, type, label, required, helpText?, placeholder?, maxLength?, price?, per?,
//          min?, max?, integer?, unit?,   (number fields)
//          condition?: { fieldId, values: [] }, choices?: [{ label, color?, price? }] }
// Choice fields charge per choice; other fields charge `price` once filled in or ticked.
// `per` (a number field's id) charges that price for each unit the customer enters there:
// Gold $50 per tooth × 3 teeth. A priced number field is always per its own unit.
// Follow-ups (`condition`) can chain any number of levels; a hidden field is never
// charged. Pricing rules live in extensions/product-options-pricing/src/pricing.js.
//hello
export const FIELD_TYPES = {
  text: { label: "Short text", icon: "text", placeholder: true, maxLength: true },
  textarea: { label: "Long text",icon: "text-block", placeholder: true, maxLength: true },
  number: { label: "Number",  icon: "hashtag", placeholder: true },
  date: { label: "Date", icon: "calendar" },
  select: { label: "Dropdown list", icon: "select", choices: true },
  radio: { label: "Buttons", icon: "button", choices: true },
  swatch: { label: "Color swatches", icon: "color", choices: true },
  checkboxes: { label: "Multiple choice", icon: "list-bulleted", choices: true },
  checkbox: { label: "Yes / no add-on", icon: "checkbox" },
  file: { label: "File upload", icon: "upload" },
};

// What customers may upload to a "File upload" question, by extension (browsers often leave
// the type blank for HEIC and Office files). The theme block's `accept` and
// product-options-upload.js mirror these two values; app/routes/proxy.upload.jsx enforces them.
// Shopify stores any of these as a generic file (it accepts anything but HTML).
export const UPLOAD_TYPES = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  // Spreadsheets and slides
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).map((ext) => `.${ext}`).join(",");
export const uploadMimeType = (filename) => {
  const ext = typeof filename === "string" && /\.([^.]+)$/.exec(filename)?.[1].toLowerCase();
  return (ext && Object.hasOwn(UPLOAD_TYPES, ext) && UPLOAD_TYPES[ext]) || null;
};

// How a set picks its products. "manual": the products picked in the editor (OptionSetProduct).
// "match": products that meet the conditions, re-checked whenever a product is created or edited
// (webhooks.products.update.jsx) or a collection's products change (webhooks.collections.update.jsx),
// so a tag added later is enough. "all": every product, including ones added later. For both,
// syncProducts also records the matched products in OptionSetProduct, so a later change can
// take the set away again.
export const ASSIGN_MODES = { manual: "Specific products", match: "By conditions", all: "All products" };
// The filters of Shopify's own product list. `input` is how the editor asks for the value:
// typed text, a fixed choice, or a picked resource (stored by ID, shown by `label`).
export const RULE_FIELDS = {
  tag: { label: "Tag", input: "text" },
  vendor: { label: "Vendor", input: "text" },
  type: { label: "Product type", input: "text" },
  status: { label: "Status", input: "choice" },
  category: { label: "Category", input: "pick" },
  collection: { label: "Collection", input: "pick" },
  channel: { label: "Sales channel", input: "pick" },
  catalog: { label: "Catalog", input: "pick" },
  metafield: { label: "Metafield", input: "metafield" },
};
// Product metafield types a condition can compare, and how: exact text (case-sensitive, like
// Shopify's search; a list matches if any item does), true/false, a number, or one entry of a
// metaobject (Shopify's category metafields such as Color: stored by ID, shown by name).
// ponytail: product/file references, measurements, ratings, rich text and JSON are listed but
// can't be picked; each needs its own value picker and compare.
export const METAFIELD_TYPES = {
  single_line_text_field: "text",
  "list.single_line_text_field": "text",
  multi_line_text_field: "text",
  url: "text",
  "list.url": "text",
  color: "text",
  "list.color": "text",
  date: "text",
  "list.date": "text",
  boolean: "boolean",
  number_integer: "number",
  "list.number_integer": "number",
  number_decimal: "number",
  "list.number_decimal": "number",
  metaobject_reference: "entry",
  "list.metaobject_reference": "entry",
};
export const PRODUCT_STATUSES = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived", UNLISTED: "Unlisted" };
// Catalog conditions first ask which kind of catalog, like Shopify's admin.
export const CATALOG_KINDS = { region: "Region", retail: "Retail", company: "Company location", b2b: "B2B", unassigned: "Unassigned" };
export const RULE_OPS = { is: "is", not: "is not" };
export const MAX_CONDITIONS = 10;
// The hidden product that carries option charges (see ensurePricing) never gets options.
export const ADDON_TAG = "product-options-addon";
// The value a condition starts with when its field is chosen.
export const blankCondition = (field = "tag") => ({
  field,
  op: "is",
  value: field === "status" ? "ACTIVE" : "",
  ...(field === "catalog" && { kind: "region" }),
  // `key` is the definition's "namespace.key"; `label` its name, `type` its type.
  ...(field === "metafield" && { key: "", type: "" }),
});

// A set's rules with every key present (sets saved before rules existed store {}).
export const rulesOf = (rules) => ({ mode: "manual", match: "all", conditions: [], ...rules });

// Whether a product gets a set through its rules. `product` is { tags, vendor, productType,
// status, category: { id }, collections: [GIDs], publications: [GIDs], metafields: { "ns.key":
// jsonValue or null } }: the collections, publications and metafields are only the ones the
// rules name (see syncProducts). Tags, vendor and type compare case-insensitively, like
// Shopify's own; metafields exactly, like Shopify's search. Hand-picked sets answer false.
export function appliesTo(rules, product) {
  const { mode, match, conditions } = rulesOf(rules);
  const lower = (s) => String(s ?? "").trim().toLowerCase();
  const tags = (product?.tags ?? []).map(lower);
  if (mode === "manual" || !product || tags.includes(ADDON_TAG)) return false;
  if (mode === "all") return true;
  const has = ({ field, value, key, type }) => {
    switch (field) {
      case "tag":
        return tags.includes(lower(value));
      case "vendor":
        return lower(product.vendor) === lower(value);
      case "type":
        return lower(product.productType) === lower(value);
      case "status":
        return product.status === value;
      case "category":
        return product.category?.id === value;
      case "collection":
        return (product.collections ?? []).includes(value);
      case "metafield": {
        const stored = product.metafields?.[key];
        const kind = METAFIELD_TYPES[type];
        // An empty metafield has no value, so "is not" holds, as in Shopify's search.
        return (
          stored != null &&
          [stored].flat().some((v) => (kind === "number" ? Number(v) === Number(value) : String(v) === value))
        );
      }
      default: // channel, catalog: published on that publication
        return (product.publications ?? []).includes(value);
    }
  };
  const meets = (c) => (c.op === "not") !== has(c);
  return conditions.length > 0 && (match === "any" ? conditions.some(meets) : conditions.every(meets));
}

// The same rules as an Admin product search, to find today's matches when a set is saved and
// to count them in the editor. A superset is fine: appliesTo has the final say when syncing.
// Shopify only searches metafields whose definition has admin filtering on (`searchable`, a Set of
// "ns.key"); it silently ignores the rest, so those terms are left out here: under "all" that's a
// superset, under "any" it has to be every product. `exact` says whether nothing was left out.
// ponytail: channels and catalogs use `publication_ids`, which Shopify deprecated in 2025-12;
// when it's removed, leave those terms out (the search becomes a superset; counts an upper bound).
export function rulesQuery(rules, searchable = new Set()) {
  return rulesSearch(rules, searchable).query;
}
export function rulesSearch(rules, searchable = new Set()) {
  const { mode, match, conditions } = rulesOf(rules);
  if (mode === "manual") return { query: null, exact: true };
  const notAddon = `-tag:${ADDON_TAG}`;
  if (mode === "all") return { query: notAddon, exact: true };
  const quote = (v) => `"${v.replace(/["\\]/g, "\\$&")}"`;
  const tail = (gid) => gid.split("/").pop();
  const term = {
    tag: (v) => `tag:${quote(v)}`,
    vendor: (v) => `vendor:${quote(v)}`,
    type: (v) => `product_type:${quote(v)}`,
    status: (v) => `status:${v.toLowerCase()}`,
    category: (v) => `category_id:${tail(v)}`,
    collection: (v) => `collection_id:${tail(v)}`,
    channel: (v) => `publication_ids:${tail(v)}`,
    catalog: (v) => `publication_ids:${tail(v)}`,
    metafield: (v, c) => `metafields.${c.key}:${["number", "boolean"].includes(METAFIELD_TYPES[c.type]) ? v : quote(v)}`,
  };
  const usable = conditions.filter((c) => c.field !== "metafield" || searchable.has(c.key));
  const exact = usable.length === conditions.length;
  if (!usable.length || (!exact && match === "any")) return { query: notAddon, exact };
  const terms = usable.map((c) => (c.op === "not" ? "-" : "") + term[c.field](c.value, c));
  return { query: `(${terms.join(match === "any" ? " OR " : " AND ")}) ${notAddon}`, exact };
}

// "Tag is engraving and Collection is Rings" (then "+ 2 more"), for one-line summaries.
export function describeRules(rules) {
  const { mode, match, conditions } = rulesOf(rules);
  if (mode !== "match") return ASSIGN_MODES[mode];
  const shown = (c) =>
    !c.value ? "…"
    : c.field === "metafield" ? c.valueLabel || c.value
    : RULE_FIELDS[c.field].input === "text" ? c.value
    : c.field === "status" ? PRODUCT_STATUSES[c.value]
    : c.label;
  const text = conditions
    .slice(0, 2)
    .map((c) => `${(c.field === "metafield" && c.label) || RULE_FIELDS[c.field].label} ${RULE_OPS[c.op]} ${shown(c)}`)
    .join(match === "any" ? " or " : " and ");
  return conditions.length > 2 ? `${text} + ${conditions.length - 2} more` : text;
}

export const MAX_FIELDS = 50;
export const MAX_CHOICES = 100;
export const MAX_PRICE = 100000;
export const MAX_PRODUCTS = 250; // Admin API `nodes` limit, used to load a set's products in one call.

export const newChoice = (type) =>
  type === "swatch" ? { label: "", color: "#000000", price: null } : { label: "", price: null };

export function newField(type) {
  return {
    id: crypto.randomUUID(),
    type,
    label: "",
    required: false,
    helpText: "",
    placeholder: "",
    maxLength: null,
    priced: false, // editor-only: the "Charge extra" switch; never stored
    price: null,
    min: null,
    max: null,
    integer: true, // number fields are usually counts
    unit: "",
    per: null,
    condition: null,
    choices: FIELD_TYPES[type].choices ? [newChoice(type)] : [],
  };
}

// The answers another field can depend on: its choices, or "Yes" for a single checkbox.
export const answersOf = (field) =>
  FIELD_TYPES[field.type].choices ? field.choices.map((c) => c.label.trim()).filter(Boolean)
  : field.type === "checkbox" ? ["Yes"]
  : [];

export const hasPrices = (fields) => fields.some((f) => f.price > 0 || f.choices?.some((c) => c.price > 0));

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
// Blank means free; anything else must be a price between 0 and MAX_PRICE (NaN marks invalid).
const money = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? Math.round(n * 100) / 100 : NaN;
};
// Blank means no limit; anything else must be a number within ±MAX_LIMIT (NaN marks invalid).
export const MAX_LIMIT = 1000000;
const limit = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= MAX_LIMIT ? n : NaN;
};
const HEX = /^#[0-9a-f]{6}$/i;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
// What a picked condition value must look like. Channels and catalogs are matched by their publication.
const PICKED_ID = {
  category: /^gid:\/\/shopify\/TaxonomyCategory\/[\w-]+$/,
  collection: /^gid:\/\/shopify\/Collection\/\d+$/,
  channel: /^gid:\/\/shopify\/Publication\/\d+$/,
  catalog: /^gid:\/\/shopify\/Publication\/\d+$/,
};

// Trust boundary: the server runs this on every save. Returns cleaned data plus
// merchant-readable errors (the editor runs it too, for instant feedback).
export function validateOptionSet(input) {
  // Each issue says where it is (input, and fieldId for a question) so the editor can mark it.
  const issues = [];
  const fail = (message, at = {}) => issues.push({ message, ...at });
  const name = text(input?.name, 100);
  if (!name) fail("Give this option set a name.", { input: "name" });

  const rawFields = Array.isArray(input?.fields) ? input.fields : [];
  if (!rawFields.length) fail("Add at least one question.", { input: "fields" });
  if (rawFields.length > MAX_FIELDS) fail(`Option sets can have up to ${MAX_FIELDS} questions.`, { input: "fields" });

  const fields = [];
  const labels = new Set();
  for (const [i, f] of rawFields.slice(0, MAX_FIELDS).entries()) {
    const type = Object.hasOwn(FIELD_TYPES, f?.type) ? f.type : "text";
    const spec = FIELD_TYPES[type];
    const label = text(f?.label, 100);
    const field = { id: text(f?.id, 64) || crypto.randomUUID(), type, label, required: f?.required === true };
    const ref = label ? `"${label}"` : `Question ${i + 1} (${spec.label})`;
    const at = (input) => ({ fieldId: f?.id, input });
    let badPrice = false;

    if (!label) fail(`${ref} has no question text. Type the question customers will see.`, at("label"));
    // Labels become line item property names: "_" hides them and brackets break the cart form.
    else if (/^_|[[\]]/.test(label)) fail(`${ref} can't start with "_" or contain [ ].`, at("label"));
    else if (labels.has(label.toLowerCase())) fail(`Two questions are called ${ref}. Each question needs its own wording.`, at("label"));
    labels.add(label.toLowerCase());

    const helpText = text(f?.helpText, 250);
    if (helpText) field.helpText = helpText;
    if (spec.placeholder) {
      const placeholder = text(f?.placeholder, 100);
      if (placeholder) field.placeholder = placeholder;
    }
    if (spec.maxLength) {
      const n = Number(f?.maxLength);
      if (Number.isInteger(n) && n > 0) field.maxLength = Math.min(n, 5000);
    }
    if (spec.choices) {
      const seen = new Set();
      field.choices = (Array.isArray(f?.choices) ? f.choices : [])
        .slice(0, MAX_CHOICES)
        .map((c) => {
          const price = money(c?.price);
          if (Number.isNaN(price)) badPrice = true;
          return {
            label: text(c?.label, 100),
            ...(type === "swatch" && { color: HEX.test(c?.color) ? c.color.toLowerCase() : "" }),
            ...(price > 0 && { price }),
          };
        })
        .filter((c) => c.label && !seen.has(c.label.toLowerCase()) && seen.add(c.label.toLowerCase()));
      if (!field.choices.length) fail(`${ref} needs at least one choice.`, at("choices"));
      // One choice selected when the page opens (single-choice questions only). A default that's
      // no longer a choice (renamed, removed) is dropped, so the customer chooses again.
      const preset = typeof f?.default === "string" ? f.default.trim() : "";
      if (type !== "checkboxes" && preset && field.choices.some((c) => c.label === preset)) field.default = preset;
      if (field.choices.some((c) => c.color === "")) fail(`${ref} has a swatch without a valid color.`, at("choices"));
    } else {
      const price = money(f?.price);
      if (Number.isNaN(price)) badPrice = true;
      else if (price > 0) field.price = price;
    }
    if (badPrice) fail(`${ref} has a price that isn't between 0 and ${MAX_PRICE}.`, at("price"));

    if (type === "number") {
      let min = limit(f?.min);
      let max = limit(f?.max);
      if (Number.isNaN(min) || Number.isNaN(max)) {
        fail(`${ref} needs lowest and highest allowed numbers between -${MAX_LIMIT} and ${MAX_LIMIT}.`, at("limits"));
      }
      // Keep whichever limit is valid, so one typo doesn't trigger follow-on errors.
      if (Number.isNaN(min)) min = null;
      if (Number.isNaN(max)) max = null;
      if (f?.integer === true) {
        field.integer = true;
        if (min !== null) min = Math.ceil(min);
        if (max !== null) max = Math.floor(max);
      }
      if (min !== null && max !== null && min > max) fail(`${ref}: the lowest allowed number can't be more than the highest.`, at("limits"));
      if (min !== null) field.min = min;
      if (max !== null) field.max = max;
      const unit = text(f?.unit, 30);
      if (unit) field.unit = unit;
    }
    // A number field's price is always per unit entered ("$5 per letter"); other fields may be
    // charged for each unit of a number field. Either only means something with a price.
    if (type === "number" && field.price > 0) field.per = field.id;
    else if (typeof f?.per === "string" && f.per && (field.price > 0 || field.choices?.some((c) => c.price > 0))) {
      field.per = f.per;
    }

    // Conditions may only point at an earlier field, so the storefront and the pricing
    // function can evaluate them top to bottom.
    if (f?.condition?.fieldId) {
      const parent = fields.find((p) => p.id === f.condition.fieldId);
      const answers = parent ? answersOf(parent) : [];
      const values = (Array.isArray(f.condition.values) ? f.condition.values : []).filter((v) => answers.includes(v));
      if (!answers.length) fail(`${ref} depends on a question that's missing or placed below it.`, at("condition"));
      else if (!values.length) fail(`${ref}: choose which answer shows this question.`, at("condition"));
      else field.condition = { fieldId: parent.id, values };
    }
    fields.push(field);
  }

  // A multiplier must be a number field of this set with both limits: a ceiling (no accidental
  // 1,000,000 × price) and a floor of 0 or more, which a blank answer counts as (so leaving
  // it empty can't silently make per-unit prices free). It may sit anywhere in the form.
  const multiplierIssues = new Map(); // message -> issue, so a shared multiplier is reported once
  const once = (message, fieldId, input) => multiplierIssues.set(message, { message, fieldId, input });
  for (const field of fields.filter((f) => f.per)) {
    const target = fields.find((t) => t.id === field.per);
    if (target?.type !== "number") {
      once(`"${field.label}" is charged for each unit of a number field that no longer exists.`, field.id, "price");
      continue;
    }
    if (target.min === undefined || target.max === undefined) {
      once(`"${target.label}" needs a lowest and highest allowed number, because prices are multiplied by it.`, target.id, "limits");
    }
    if (target.min < 0) once(`"${target.label}" can't go below 0, because prices are multiplied by it.`, target.id, "limits");
  }
  issues.push(...multiplierIssues.values());

  const rules = cleanRules(input?.rules, (message, condition, fix) => fail(message, { input: "products", condition, fix }));
  // Hand-picked products only count for hand-picked sets.
  const productIds =
    rules.mode === "manual"
      ? [...new Set((Array.isArray(input?.productIds) ? input.productIds : []).filter((id) => PRODUCT_GID.test(id)))]
      : [];
  if (productIds.length > MAX_PRODUCTS) fail(`Option sets can be assigned to up to ${MAX_PRODUCTS} products.`, { input: "products" });

  return {
    errors: issues.map((i) => i.message),
    issues,
    data: { name, status: input?.status === "DRAFT" ? "DRAFT" : "ACTIVE", fields, rules, productIds },
  };
}

function cleanRules(input, fail) {
  const mode = Object.hasOwn(ASSIGN_MODES, input?.mode) ? input.mode : "manual";
  const raw = mode === "match" && Array.isArray(input?.conditions) ? input.conditions : [];
  const conditions = raw.slice(0, MAX_CONDITIONS).map((c) => {
    const field = Object.hasOwn(RULE_FIELDS, c?.field) ? c.field : "tag";
    const op = c?.op === "not" ? "not" : "is";
    if (RULE_FIELDS[field].input === "text") return { field, op, value: text(c?.value, 255) };
    if (field === "status") return { field, op, value: Object.hasOwn(PRODUCT_STATUSES, c?.value) ? c.value : "" };
    if (field === "metafield") return cleanMetafieldCondition(c, op);
    // Picked resources are kept by ID (they can be renamed), with their name for display.
    const value = PICKED_ID[field].test(c?.value) ? c.value : "";
    const label = text(c?.label, 255) || RULE_FIELDS[field].label;
    if (field !== "catalog") return { field, op, value, label };
    return { field, op, value, label, kind: Object.hasOwn(CATALOG_KINDS, c?.kind) ? c.kind : "region" };
  });
  if (mode === "match") {
    if (!conditions.length) fail("Add a condition, or choose another way to pick products.");
    if (raw.length > MAX_CONDITIONS) fail(`Use up to ${MAX_CONDITIONS} conditions.`);
    // `i` and `fix` let the editor put the error on the field itself ("Choose a collection").
    conditions.forEach((c, i) => {
      const fix = c.field === "metafield" && !c.key ? "choose a metafield" : !c.value && missingValueHint(c);
      if (fix) fail(`Condition ${i + 1}: ${fix}.`, i, fix.replace(/^./, (ch) => ch.toUpperCase()));
    });
  }
  return { mode, match: input?.match === "any" ? "any" : "all", conditions };
}

// What to do about a condition without a value, in the words of its own control.
function missingValueHint(c) {
  if (c.field === "metafield") {
    const kind = METAFIELD_TYPES[c.type];
    return kind === "number" ? "enter a number" : kind === "boolean" ? "choose true or false" : kind === "entry" ? "choose a value" : "type a value";
  }
  if (RULE_FIELDS[c.field].input === "text") return `type a ${RULE_FIELDS[c.field].label.toLowerCase()}`;
  return `choose a ${RULE_FIELDS[c.field].label.toLowerCase()}`;
}

export const isMetafieldKey = (key) => typeof key === "string" && METAFIELD_KEY.test(key);

// A metafield condition: a product metafield definition ("namespace.key", never an app's own
// "app--…" namespace) of a type we can compare, and a value that fits the type.
const METAFIELD_KEY = /^(?!app--)[\w-]{2,255}\.[\w-]{2,64}$/;
function cleanMetafieldCondition(c, op) {
  const key = isMetafieldKey(c?.key) ? c.key : "";
  const type = key && Object.hasOwn(METAFIELD_TYPES, c?.type) ? c.type : "";
  const raw = text(c?.value, 255);
  const kind = METAFIELD_TYPES[type];
  const value =
    kind === "boolean" ? (["true", "false"].includes(raw) ? raw : "")
    : kind === "number" ? (raw !== "" && Number.isFinite(Number(raw)) ? String(Number(raw)) : "")
    : kind === "entry" ? (/^gid:\/\/shopify\/Metaobject\/\d+$/.test(raw) ? raw : "")
    : raw;
  return {
    field: "metafield",
    op,
    value,
    key: type ? key : "",
    label: text(c?.label, 255) || key,
    type,
    // An entry is kept by ID (it can be renamed) and shown by its name.
    ...(kind === "entry" && { valueLabel: text(c?.valueLabel, 255) || value }),
  };
}

// A product can belong to several sets; first set wins when labels collide,
// since two inputs can't share one line item property name.
export function mergeFields(fieldLists) {
  const seen = new Set();
  return fieldLists.flat().filter((f) => {
    const key = f.label.toLowerCase();
    return !seen.has(key) && seen.add(key);
  });
}
