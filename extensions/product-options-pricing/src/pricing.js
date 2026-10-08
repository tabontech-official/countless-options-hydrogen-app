// Single source of truth for option prices. The cart transform charges with this;
// the admin preview and tests import it too. Prices come only from the product's
// `$app.options` metafield (written by the app), never from the browser.
//
// selection: { [fieldId]: string | string[] } — what the customer picked or typed.
//
// A field's price is free, charged once, or charged "for each" unit of a number field
// (`per`: that field's id): Gold $50 per tooth × 3 teeth. A number field's price is per unit.

const CHOICE_TYPES = new Set(["select", "radio", "swatch", "checkboxes"]);
const cents = (n) => Math.round((Number(n) || 0) * 100);

// A number answer forced into the merchant's rules, so a tampered value can't change the price.
export function normalizeNumber(field, raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  let n = text === "" ? NaN : Number(text);
  if (!Number.isFinite(n)) return null;
  if (field.integer) n = Math.round(n);
  if (field.min != null) n = Math.max(n, field.min);
  if (field.max != null) n = Math.min(n, field.max);
  return n;
}

// A number field's own price is always per unit entered; others may name a number field.
const multiplierOf = (field) => (field.type === "number" ? field.id : (field.per ?? null));

// Returns the answers the customer can actually see (conditions met), the add-ons to charge
// for, and the total add-on price in shop currency.
export function priceSelection(fields, selection) {
  const visible = new Map(); // fieldId -> answers, for conditions
  const shown = new Set(); // fields whose condition is met
  const numbers = new Map(); // number fieldId -> normalized number
  const answered = []; // { field, values, base } in form order; base is the unmultiplied price

  for (const field of fields) {
    if (field.condition) {
      const parent = visible.get(field.condition.fieldId) ?? [];
      if (!parent.some((v) => field.condition.values.includes(v))) continue;
    }
    shown.add(field.id);
    const raw = selection?.[field.id];
    let values;
    let base = 0;

    if (field.type === "number") {
      const n = normalizeNumber(field, raw);
      values = n === null ? [] : [String(n)];
      if (n !== null) {
        numbers.set(field.id, n);
        base = cents(field.price);
      }
    } else if (CHOICE_TYPES.has(field.type)) {
      const picked = (Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === "string");
      // One answer for single-choice fields, whatever the browser sent.
      const wanted = field.type === "checkboxes" ? picked : picked.slice(0, 1);
      const kept = field.choices.filter((c) => wanted.includes(c.label));
      values = kept.map((c) => c.label);
      base = kept.reduce((sum, c) => sum + cents(c.price), 0);
    } else {
      const text = typeof raw === "string" ? raw.trim() : "";
      values = text ? [field.type === "checkbox" ? "Yes" : text] : [];
      if (text) base = cents(field.price);
    }

    if (!values.length) continue;
    visible.set(field.id, values);
    answered.push({ field, values, base });
  }

  // Second pass, because a price may multiply by a number field placed after it.
  const display = [];
  const charges = [];
  let total = 0;
  for (const { field, values, base } of answered) {
    const value = values.join(", ");
    display.push({ label: field.label, value });
    const per = multiplierOf(field);
    // A blank but visible number counts as its minimum (so removing it can't make extras free);
    // a hidden one as 0, since that question doesn't apply.
    const fallback = shown.has(per) ? fields.find((f) => f.id === per)?.min ?? 0 : 0;
    const units = per ? Math.max(numbers.get(per) ?? fallback, 0) : 1;
    const price = Math.round(base * units);
    if (price > 0) {
      charges.push({ label: field.label, value, price: price / 100, ...(per && { each: base / 100, units, self: per === field.id }) });
      total += price;
    }
  }
  return { display, charges, total: total / 100 };
}
