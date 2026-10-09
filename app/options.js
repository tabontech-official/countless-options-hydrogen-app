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
});

// A set's rules with every key present (sets saved before rules existed store {}).
export const rulesOf = (rules) => ({ mode: "manual", match: "all", conditions: [], ...rules });

// Whether a product gets a set through its rules. `product` is { tags, vendor, productType,
// status, category: { id }, collections: [GIDs], publications: [GIDs] }: the collections and
// publications are only the ones the rules name (see syncProducts). Text compares
// case-insensitively, like Shopify's own tags. Hand-picked sets answer false.
export function appliesTo(rules, product) {
  const { mode, match, conditions } = rulesOf(rules);
  const lower = (s) => String(s ?? "").trim().toLowerCase();
  const tags = (product?.tags ?? []).map(lower);
  if (mode === "manual" || !product || tags.includes(ADDON_TAG)) return false;
  if (mode === "all") return true;
  const has = (field, value) => {
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
      default: // channel, catalog: published on that publication
        return (product.publications ?? []).includes(value);
    }
  };
  const meets = ({ field, op, value }) => (op === "not") !== has(field, value);
  return conditions.length > 0 && (match === "any" ? conditions.some(meets) : conditions.every(meets));
}

// The same rules as an Admin product search, to find today's matches when a set is saved and
// to count them in the editor. A superset is fine: appliesTo has the final say when syncing.
// ponytail: channels and catalogs use `publication_ids`, which Shopify deprecated in 2025-12;
// when it's removed, leave those terms out (the search becomes a superset; counts an upper bound).
export function rulesQuery(rules) {
  const { mode, match, conditions } = rulesOf(rules);
  if (mode === "manual") return null;
  const notAddon = `-tag:${ADDON_TAG}`;
  if (mode === "all") return notAddon;
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
  };
  const terms = conditions.map((c) => (c.op === "not" ? "-" : "") + term[c.field](c.value));
  return `(${terms.join(match === "any" ? " OR " : " AND ")}) ${notAddon}`;
}

// "Tag is engraving and Collection is Rings" (then "+ 2 more"), for one-line summaries.
export function describeRules(rules) {
  const { mode, match, conditions } = rulesOf(rules);
  if (mode !== "match") return ASSIGN_MODES[mode];
  const shown = (c) =>
    !c.value ? "…"
    : RULE_FIELDS[c.field].input === "text" ? c.value
    : c.field === "status" ? PRODUCT_STATUSES[c.value]
    : c.label;
  const text = conditions
    .slice(0, 2)
    .map((c) => `${RULE_FIELDS[c.field].label} ${RULE_OPS[c.op]} ${shown(c)}`)
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
  const errors = [];
  const name = text(input?.name, 100);
  if (!name) errors.push("Give this option set a name.");

  const rawFields = Array.isArray(input?.fields) ? input.fields : [];
  if (!rawFields.length) errors.push("Add at least one field.");
  if (rawFields.length > MAX_FIELDS) errors.push(`Option sets can have up to ${MAX_FIELDS} fields.`);

  const fields = [];
  const labels = new Set();
  for (const [i, f] of rawFields.slice(0, MAX_FIELDS).entries()) {
    const type = Object.hasOwn(FIELD_TYPES, f?.type) ? f.type : "text";
    const spec = FIELD_TYPES[type];
    const label = text(f?.label, 100);
    const field = { id: text(f?.id, 64) || crypto.randomUUID(), type, label, required: f?.required === true };
    const ref = label ? `"${label}"` : `Field ${i + 1}`;
    let badPrice = false;

    if (!label) errors.push(`${ref} needs a label.`);
    // Labels become line item property names: "_" hides them and brackets break the cart form.
    else if (/^_|[[\]]/.test(label)) errors.push(`${ref} can't start with "_" or contain [ ].`);
    else if (labels.has(label.toLowerCase())) errors.push(`Two fields are labeled ${ref}. Labels must be unique.`);
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
      if (!field.choices.length) errors.push(`${ref} needs at least one choice.`);
      if (field.choices.some((c) => c.color === "")) errors.push(`${ref} has a swatch without a valid color.`);
    } else {
      const price = money(f?.price);
      if (Number.isNaN(price)) badPrice = true;
      else if (price > 0) field.price = price;
    }
    if (badPrice) errors.push(`${ref} has a price that isn't between 0 and ${MAX_PRICE}.`);

    if (type === "number") {
      let min = limit(f?.min);
      let max = limit(f?.max);
      if (Number.isNaN(min) || Number.isNaN(max)) {
        errors.push(`${ref} needs lowest and highest allowed numbers between -${MAX_LIMIT} and ${MAX_LIMIT}.`);
      }
      // Keep whichever limit is valid, so one typo doesn't trigger follow-on errors.
      if (Number.isNaN(min)) min = null;
      if (Number.isNaN(max)) max = null;
      if (f?.integer === true) {
        field.integer = true;
        if (min !== null) min = Math.ceil(min);
        if (max !== null) max = Math.floor(max);
      }
      if (min !== null && max !== null && min > max) errors.push(`${ref}: the lowest allowed number can't be more than the highest.`);
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
      if (!answers.length) errors.push(`${ref} depends on a field that's missing or placed below it.`);
      else if (!values.length) errors.push(`${ref}: choose which answer shows this field.`);
      else field.condition = { fieldId: parent.id, values };
    }
    fields.push(field);
  }

  // A multiplier must be a number field of this set with both limits: a ceiling (no accidental
  // 1,000,000 × price) and a floor of 0 or more, which a blank answer counts as (so leaving
  // it empty can't silently make per-unit prices free). It may sit anywhere in the form.
  const multiplierIssues = new Set();
  for (const field of fields.filter((f) => f.per)) {
    const target = fields.find((t) => t.id === field.per);
    if (target?.type !== "number") {
      multiplierIssues.add(`"${field.label}" is charged for each unit of a number field that no longer exists.`);
      continue;
    }
    if (target.min === undefined || target.max === undefined) {
      multiplierIssues.add(`"${target.label}" needs a lowest and highest allowed number, because prices are multiplied by it.`);
    }
    if (target.min < 0) multiplierIssues.add(`"${target.label}" can't go below 0, because prices are multiplied by it.`);
  }
  errors.push(...multiplierIssues);

  const rules = cleanRules(input?.rules, errors);
  // Hand-picked products only count for hand-picked sets.
  const productIds =
    rules.mode === "manual"
      ? [...new Set((Array.isArray(input?.productIds) ? input.productIds : []).filter((id) => PRODUCT_GID.test(id)))]
      : [];
  if (productIds.length > MAX_PRODUCTS) errors.push(`Option sets can be assigned to up to ${MAX_PRODUCTS} products.`);

  return {
    errors,
    data: { name, status: input?.status === "DRAFT" ? "DRAFT" : "ACTIVE", fields, rules, productIds },
  };
}

function cleanRules(input, errors) {
  const mode = Object.hasOwn(ASSIGN_MODES, input?.mode) ? input.mode : "manual";
  const raw = mode === "match" && Array.isArray(input?.conditions) ? input.conditions : [];
  const conditions = raw.slice(0, MAX_CONDITIONS).map((c) => {
    const field = Object.hasOwn(RULE_FIELDS, c?.field) ? c.field : "tag";
    const op = c?.op === "not" ? "not" : "is";
    if (RULE_FIELDS[field].input === "text") return { field, op, value: text(c?.value, 255) };
    if (field === "status") return { field, op, value: Object.hasOwn(PRODUCT_STATUSES, c?.value) ? c.value : "" };
    // Picked resources are kept by ID (they can be renamed), with their name for display.
    const value = PICKED_ID[field].test(c?.value) ? c.value : "";
    const label = text(c?.label, 255) || RULE_FIELDS[field].label;
    if (field !== "catalog") return { field, op, value, label };
    return { field, op, value, label, kind: Object.hasOwn(CATALOG_KINDS, c?.kind) ? c.kind : "region" };
  });
  if (mode === "match") {
    if (!conditions.length) errors.push("Add a condition, or choose another way to pick products.");
    if (raw.length > MAX_CONDITIONS) errors.push(`Use up to ${MAX_CONDITIONS} conditions.`);
    if (conditions.some((c) => !c.value)) errors.push("Every condition needs a value: type one, or choose one from the list.");
  }
  return { mode, match: input?.match === "any" ? "any" : "all", conditions };
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
