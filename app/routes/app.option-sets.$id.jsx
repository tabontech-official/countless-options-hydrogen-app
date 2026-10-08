import { Fragment, useEffect, useMemo, useState } from "react";
import { useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { FIELD_TYPES, MAX_PRICE, MAX_PRODUCTS, answersOf, hasPrices, newChoice, newField, validateOptionSet } from "../options";
import { ensurePricing, getProducts, getShopCurrency, syncProducts } from "../options.server";
import { plural } from "../components/OptionSetsTable";

async function findSet(shop, id) {
  if (id === "new") return null;
  // Scoped by shop so one store can never read or edit another store's set.
  const set = await prisma.optionSet.findFirst({ where: { id, shop }, include: { products: true } });
  if (!set) throw new Response("Option set not found", { status: 404 });
  return set;
}

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const set = await findSet(session.shop, params.id);
  const search = new URL(request.url).searchParams;
  const unsynced = search.has("unsynced");
  // Set when a template was just copied into this store (see app.templates.jsx).
  const created = search.has("created");
  const [currency, products] = await Promise.all([
    getShopCurrency(admin),
    getProducts(admin, set?.products.map((p) => p.productId) ?? []),
  ]);
  if (!set) {
    return { unsynced, currency, set: { id: null, name: "", status: "ACTIVE", fields: [], products: [], updatedAt: null } };
  }
  return {
    unsynced,
    created,
    currency,
    set: {
      id: set.id,
      name: set.name,
      status: set.status,
      // Stored fields omit empty keys; the editor wants every key present.
      fields: set.fields.map((f) => ({
        helpText: "",
        placeholder: "",
        maxLength: null,
        price: null,
        min: null,
        max: null,
        integer: false,
        unit: "",
        condition: null,
        ...f,
        priced: hasPrices([f]),
        // A priced number field is charged per unit (older sets marked that with perUnit).
        per: f.type === "number" ? (f.price > 0 ? f.id : null) : (f.per ?? null),
        choices: (f.choices ?? []).map((c) => ({ price: null, ...c })),
      })),
      products,
      updatedAt: set.updatedAt.toISOString(),
    },
  };
};

export const action = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const { shop } = session;
  const existing = await findSet(shop, params.id);
  const before = existing?.products.map((p) => p.productId) ?? [];
  const body = await request.json();

  if (existing && body.intent === "delete") {
    // Hide it from the storefront first, so a failed sync never leaves orphaned options live.
    await prisma.optionSet.update({ where: { id: existing.id }, data: { status: "DRAFT" } });
    await syncProducts(admin, shop, before);
    await prisma.optionSet.delete({ where: { id: existing.id } });
    return redirect("/app/option-sets");
  }
  if (existing && body.intent === "duplicate") {
    const copy = await prisma.optionSet.create({
      data: { shop, name: `Copy of ${existing.name}`.slice(0, 100), status: "DRAFT", fields: existing.fields },
    });
    return redirect(`/app/option-sets/${copy.id}`);
  }
  if (existing && body.intent === "sync") {
    await syncProducts(admin, shop, before);
    return { toast: "Store updated" };
  }

  const { errors, data } = validateOptionSet(body);
  if (errors.length) return { errors };

  // Turn on charging before prices go live, so customers never see a price that isn't charged.
  if (data.status === "ACTIVE" && hasPrices(data.fields)) {
    try {
      await ensurePricing(admin);
    } catch (error) {
      console.error(error);
      return { errors: [error.message] };
    }
  }

  // Keeps only products that exist in this shop.
  const productIds = (await getProducts(admin, data.productIds)).map((p) => p.id);
  const values = { name: data.name, status: data.status, fields: data.fields };
  const products = productIds.map((productId) => ({ productId }));
  const saved = existing
    ? await prisma.optionSet.update({
        where: { id: existing.id },
        data: { ...values, products: { deleteMany: {}, create: products } },
      })
    : await prisma.optionSet.create({ data: { shop, ...values, products: { create: products } } });

  try {
    await syncProducts(admin, shop, [...new Set([...before, ...productIds])]);
  } catch (error) {
    console.error(error);
    if (!existing) return redirect(`/app/option-sets/${saved.id}?unsynced`);
    return { unsynced: true };
  }
  return existing ? { toast: "Option set saved" } : redirect(`/app/option-sets/${saved.id}`);
};

export default function OptionSetPage() {
  const { set, unsynced, created, currency } = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();

  useEffect(() => {
    if (created) shopify.toast.show("Template added to your option sets");
  }, [created, shopify]);

  useEffect(() => {
    if (actionData?.toast) shopify.toast.show(actionData.toast);
  }, [actionData, shopify]);

  // Remounting on every save resets the draft to what was stored.
  return (
    <Editor
      key={`${set.id}-${set.updatedAt}`}
      set={set}
      currency={currency}
      serverErrors={actionData?.errors ?? []}
      unsynced={actionData ? Boolean(actionData.unsynced) : unsynced}
    />
  );
}

const snapshot = (d) => JSON.stringify([d.name, d.status, d.fields, d.products.map((p) => p.id)]);

function Editor({ set, currency, serverErrors, unsynced }) {
  const shopify = useAppBridge();
  const formatMoney = useMemo(() => {
    const format = new Intl.NumberFormat("en-US", { style: "currency", currency });
    return (amount) => format.format(amount);
  }, [currency]);
  const submit = useSubmit();
  const navigation = useNavigation();
  const initial = useMemo(
    () => ({ name: set.name, status: set.status, fields: set.fields, products: set.products }),
    [set],
  );
  const [draft, setDraft] = useState(initial);
  const [openId, setOpenId] = useState(null);
  const [clientErrors, setClientErrors] = useState([]);

  const isNew = !set.id;
  const dirty = snapshot(draft) !== snapshot(initial);
  const saving = navigation.state === "submitting";
  const errors = clientErrors.length ? clientErrors : serverErrors;

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setFields = (fn) => setDraft((d) => ({ ...d, fields: fn(d.fields) }));
  const updateField = (id, patch) => setFields((fs) => patchField(fs, id, patch));
  const post = (body) => submit(body, { method: "post", encType: "application/json" });

  const save = () => {
    const payload = { ...draft, productIds: draft.products.map((p) => p.id) };
    const { errors } = validateOptionSet(payload);
    setClientErrors(errors);
    if (!errors.length) post(payload);
  };

  const discard = () => {
    setDraft(initial);
    setClientErrors([]);
    setOpenId(null);
  };

  const addField = (type) => {
    const field = newField(type);
    setFields((fs) => [...fs, field]);
    setOpenId(field.id);
  };

  const moveField = (index, direction) => setFields((fs) => moved(fs, index, direction) ?? fs);

  // The copy goes below the original's follow-ups, so they stay under the original.
  const duplicateField = (index) =>
    setFields((fs) => {
      const source = fs[index];
      const id = crypto.randomUUID();
      const copy = { ...structuredClone(source), id, label: `${source.label} copy`.trim(), per: source.per === source.id ? id : source.per };
      const end = blockEnd(fs, index);
      return [...fs.slice(0, end), copy, ...fs.slice(end)];
    });

  // Keeps existing choices when switching between choice types; swatches need a color each.
  const changeType = (field, type) => {
    let choices = field.choices.length ? field.choices : [newChoice(type)];
    if (type === "swatch") choices = choices.map((c) => ({ color: "#000000", ...c }));
    const patch = {
      type,
      choices: FIELD_TYPES[type].choices ? choices : field.choices,
      // A priced number counts its own units; other types can't multiply by themselves.
      per: type === "number" ? (field.priced ? field.id : null) : field.per === field.id ? null : field.per,
    };
    // Prices counted by this field go back to "once" when it stops being a number.
    setFields((fs) =>
      fs.map((f) => (f.id === field.id ? { ...f, ...patch } : type !== "number" && f.per === field.id ? { ...f, per: null } : f)),
    );
  };

  // A follow-up goes right after the parent and its existing follow-ups, shown for the
  // parent's answer when there's only one (a ticked checkbox).
  const addFollowUp = (parent) => {
    const answers = answersOf(parent);
    const field = { ...newField("radio"), condition: { fieldId: parent.id, values: answers.length === 1 ? answers : [] } };
    setFields((fs) => {
      const family = new Set([parent.id]);
      let at = 0;
      fs.forEach((f, i) => {
        if (f.id === parent.id || family.has(f.condition?.fieldId)) {
          family.add(f.id);
          at = i;
        }
      });
      return [...fs.slice(0, at + 1), field, ...fs.slice(at + 1)];
    });
    setOpenId(field.id);
  };
  const depth = followUpDepths(draft.fields);

  // The picker adds products directly or via the collections, tags and categories that hold them now.
  const resolver = useFetcher();
  const [pickerKey, setPickerKey] = useState(0);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const addMatching = (body) =>
    resolver.submit(body, { method: "post", action: "/app/product-filters", encType: "application/json" });
  useEffect(() => {
    if (!resolver.data) return;
    const have = new Set(draft.products.map((p) => p.id));
    const fresh = resolver.data.products.filter((p) => !have.has(p.id));
    if (fresh.length) update({ products: [...draft.products, ...fresh] });
    const more = resolver.data.truncated ? ` (only the first ${MAX_PRODUCTS} matches)` : "";
    shopify.toast.show(fresh.length ? `Added ${plural(fresh.length, "product")}${more}` : "No new products found");
    // Runs once per result; draft is read from the render the result arrived in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolver.data]);
  const adding = resolver.state !== "idle";
  const visibleProducts = showAllProducts ? draft.products : draft.products.slice(0, PRODUCTS_PREVIEW);

  return (
    <s-page heading={isNew ? "Create option set" : set.name}>
      <s-link slot="breadcrumb-actions" href="/app/option-sets">
        Option sets
      </s-link>
      {!isNew && (
        <s-button slot="secondary-actions" onClick={() => post({ intent: "duplicate" })}>
          Duplicate
        </s-button>
      )}

      <SaveBar id="option-set-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined}>
          Save
        </button>
        <button onClick={discard} disabled={saving}>
          Discard
        </button>
      </SaveBar>

      {errors.length > 0 && (
        <s-banner tone="critical" heading={`Fix ${plural(errors.length, "issue")} before saving`}>
          <s-unordered-list>
            {errors.map((error) => (
              <s-list-item key={error}>{error}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}
      {unsynced && (
        <s-banner tone="warning" heading="Saved, but your store wasn't fully updated">
          Some products may still show their previous options.
          <s-button slot="secondary-actions" onClick={() => post({ intent: "sync" })}>
            Try again
          </s-button>
        </s-banner>
      )}

      <s-section heading="Details">
        <s-text-field
          label="Name"
          value={draft.name}
          placeholder="e.g. Engraving options"
          details="Only you see this name."
          onInput={(e) => update({ name: e.currentTarget.value })}
        />
      </s-section>

      <s-section heading="Fields">
        <s-stack gap="base">
          {draft.fields.length === 0 && (
            <s-paragraph color="subdued">
              Add the questions customers answer on the product page, like a
              metal type, a size or engraving text.
            </s-paragraph>
          )}
          {draft.fields.map((field, index) => (
            // Follow-ups sit indented under the question they depend on.
            <s-box key={field.id} paddingInlineStart={INDENTS[Math.min(depth.get(field.id), INDENTS.length - 1)]}>
              <FieldCard
                field={field}
                fields={draft.fields}
                formatMoney={formatMoney}
                open={openId === field.id}
                onToggle={() => setOpenId(openId === field.id ? null : field.id)}
                onChange={(patch) => updateField(field.id, patch)}
                onChangeType={(type) => changeType(field, type)}
                canMoveUp={Boolean(moved(draft.fields, index, -1))}
                canMoveDown={Boolean(moved(draft.fields, index, 1))}
                onMove={(direction) => moveField(index, direction)}
                onDuplicate={() => duplicateField(index)}
                onAddFollowUp={() => addFollowUp(field)}
                onRemove={() =>
                  // Follow-up fields of a removed field become always visible.
                  setFields((fs) =>
                    fs
                      .filter((f) => f.id !== field.id)
                      .map((f) => ({
                        ...f,
                        condition: f.condition?.fieldId === field.id ? null : f.condition,
                        per: f.per === field.id ? null : f.per,
                      })),
                  )
                }
              />
            </s-box>
          ))}
          <s-stack direction="inline">
            <s-button icon="plus" commandFor="add-field-menu">
              Add field
            </s-button>
          </s-stack>
          <s-menu id="add-field-menu" accessibilityLabel="Field types">
            {Object.entries(FIELD_TYPES).map(([type, spec]) => (
              <s-button key={type} icon={spec.icon} onClick={() => addField(type)}>
                {spec.label}
              </s-button>
            ))}
          </s-menu>
        </s-stack>
      </s-section>

      <s-section heading="Products">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            These fields show on the product pages below. Adding a collection,
            tag or category adds the products it has now; products added to it
            later need to be added here too.
          </s-paragraph>
          {draft.products.length > 0 && (
            <s-box border="base" borderRadius="base">
              {visibleProducts.map((product, i) => (
                <Fragment key={product.id}>
                  {i > 0 && <s-divider />}
                  <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center" padding="small">
                    <s-thumbnail src={product.image ?? undefined} alt={product.title} size="small" />
                    <s-text>{product.title}</s-text>
                    <s-button
                      variant="tertiary"
                      icon="x"
                      accessibilityLabel={`Remove ${product.title}`}
                      onClick={() => update({ products: draft.products.filter((p) => p.id !== product.id) })}
                    />
                  </s-grid>
                </Fragment>
              ))}
            </s-box>
          )}
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              icon="product"
              commandFor="product-picker"
              command="--show"
              loading={adding ? "" : undefined}
              onClick={() => setPickerKey((k) => k + 1)}
            >
              {draft.products.length ? "Add products" : "Select products"}
            </s-button>
            {draft.products.length > PRODUCTS_PREVIEW && (
              <s-button variant="tertiary" onClick={() => setShowAllProducts(!showAllProducts)}>
                {showAllProducts ? "Show fewer" : `Show all ${draft.products.length}`}
              </s-button>
            )}
            {draft.products.length > 1 && (
              <s-button variant="tertiary" tone="critical" onClick={() => update({ products: [] })}>
                Remove all
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      {/* Stays mounted so the button's open command finds it; the picker inside resets on each open. */}
      <s-modal id="product-picker" heading="Select products" size="large">
        {pickerKey > 0 && (
          <ProductPicker key={pickerKey} added={new Set(draft.products.map((p) => p.id))} onAdd={addMatching} />
        )}
      </s-modal>

      {!isNew && (
        <s-stack direction="inline" justifyContent="end">
          <s-button tone="critical" commandFor="delete-modal" command="--show">
            Delete option set
          </s-button>
        </s-stack>
      )}

      <s-section slot="aside" heading="Status">
        <s-select
          label="Status"
          labelAccessibilityVisibility="exclusive"
          value={draft.status}
          details={draft.status === "ACTIVE" ? "Customers see these options." : "Hidden from your store."}
          onChange={(e) => update({ status: e.currentTarget.value })}
        >
          <s-option value="ACTIVE">Active</s-option>
          <s-option value="DRAFT">Draft</s-option>
        </s-select>
      </s-section>

      <s-section slot="aside" heading="Preview">
        <Preview fields={draft.fields} formatMoney={formatMoney} />
      </s-section>

      <s-modal id="delete-modal" heading="Delete option set?">
        <s-paragraph>
          {`"${set.name}" will be removed from ${plural(set.products.length, "product")}. This can't be undone.`}
        </s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical" onClick={() => post({ intent: "delete" })}>
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

const PRODUCTS_PREVIEW = 10;

// The picker's "Select by" choices: what the list shows and what ticking an entry adds.
const SELECT_BY = {
  product: { label: "Products", search: "Search products", empty: "No products found." },
  collection: {
    label: "Collections",
    search: "Search collections",
    empty: "No collections found.",
    hint: "Adds every product in the collections you tick.",
  },
  tag: { label: "Tags", search: "Search tags", empty: "No tags found.", hint: "Adds every product with the tags you tick." },
  category: {
    label: "Categories",
    search: "Search categories, e.g. Rings",
    empty: "No categories found.",
    hint: "Adds every product in the categories you tick.",
  },
};
// About eight rows; capped by the screen height on small laptops.
const LIST_STYLE = { height: "min(440px, 50vh)", overflowY: "auto" };
const NOTHING_SELECTED = { product: [], collection: [], tag: [], category: [] };

// Our own picker, because Shopify's resource picker can't select by tag or category.
// Ticks are kept per "Select by" type, so one pick can mix products, collections, tags and categories.
function ProductPicker({ added, onAdd }) {
  const options = useFetcher();
  const [type, setType] = useState("product");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(NOTHING_SELECTED);
  const spec = SELECT_BY[type];
  // Tags are loaded once and filtered here; everything else is searched on Shopify.
  const local = type === "tag";

  const load = (nextType, q) => {
    const params = new URLSearchParams({ type: nextType });
    if (nextType !== "tag" && q.trim()) params.set("q", q.trim());
    options.load(`/app/product-filters?${params}`);
  };
  useEffect(() => {
    load("product", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchType = (next) => {
    setType(next);
    setQuery("");
    load(next, "");
  };
  // ponytail: a request per keystroke (the previous one is cancelled); debounce if it gets chatty.
  const search = (value) => {
    setQuery(value);
    if (!local) load(type, value);
  };

  const needle = query.trim().toLowerCase();
  // Ignore results still showing from the previous "Select by" choice.
  const loaded = options.data?.type === type ? options.data.options : null;
  const list = (loaded ?? []).filter((o) => !local || o.label.toLowerCase().includes(needle));
  const withImages = type === "product" || type === "collection";
  const ticked = selected[type];
  const toggle = (value) =>
    setSelected((s) => ({ ...s, [type]: s[type].includes(value) ? s[type].filter((v) => v !== value) : [...s[type], value] }));
  const total = Object.values(selected).flat().length;

  return (
    <>
      <s-query-container>
        <s-stack gap="base">
          <s-grid gridTemplateColumns="@container (inline-size > 500px) 12rem 1fr, 1fr" gap="small-300" alignItems="end">
            <s-select label="Select by" value={type} onChange={(e) => switchType(e.currentTarget.value)}>
              {Object.entries(SELECT_BY).map(([value, s]) => (
                <s-option key={value} value={value}>
                  {s.label}
                </s-option>
              ))}
            </s-select>
            <s-search-field
              label={spec.search}
              labelAccessibilityVisibility="exclusive"
              placeholder={spec.search}
              value={query}
              onInput={(e) => search(e.currentTarget.value)}
            />
          </s-grid>
          {spec.hint && <s-text color="subdued">{spec.hint}</s-text>}

          {/* Fixed height, so the pop-up keeps its size while results change; the list scrolls inside. */}
          <s-box border="base" borderRadius="base" overflow="hidden">
            <div style={LIST_STYLE}>
              {!loaded || !list.length ? (
                <s-stack blockSize="100%" alignItems="center" justifyContent="center" padding="large">
                  {!loaded ? (
                    <s-spinner accessibilityLabel="Loading" size="large" />
                  ) : (
                    <s-text color="subdued">{local && !needle ? "Your products don't have tags yet." : spec.empty}</s-text>
                  )}
                </s-stack>
              ) : (
                list.map((o, i) => {
                  const already = type === "product" && added.has(o.value);
                  return (
                    <Fragment key={o.value}>
                      {i > 0 && <s-divider />}
                      <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center" padding="small base">
                        <s-checkbox
                          label={o.label}
                          labelAccessibilityVisibility="exclusive"
                          checked={already || ticked.includes(o.value)}
                          disabled={already}
                          onChange={() => toggle(o.value)}
                        />
                        {/* Clicking the image or name ticks the row too, like Shopify's own picker. */}
                        <s-clickable onClick={() => !already && toggle(o.value)} accessibilityLabel={`Select ${o.label}`}>
                          <s-stack direction="inline" gap="base" alignItems="center">
                            {withImages && <s-thumbnail src={o.image ?? undefined} alt="" size="small" />}
                            <s-text>{o.label}</s-text>
                            {already && <s-badge>Added</s-badge>}
                          </s-stack>
                        </s-clickable>
                      </s-grid>
                    </Fragment>
                  );
                })
              )}
            </div>
          </s-box>
          <s-text color="subdued">{total ? `${total} selected` : "Nothing selected yet"}</s-text>
        </s-stack>
      </s-query-container>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!total}
        commandFor="product-picker"
        command="--hide"
        onClick={() =>
          onAdd({
            products: selected.product,
            collections: selected.collection,
            tags: selected.tag,
            categories: selected.category,
          })
        }
      >
        Add
      </s-button>
      <s-button slot="secondary-actions" commandFor="product-picker" command="--hide">
        Cancel
      </s-button>
    </>
  );
}

const isPriced = (price) => Number(price) > 0;
// What a "per" price is counted in: the number field's unit name, else its label.
const unitName = (numberField) => numberField?.unit || numberField?.label || "unit";
const INDENTS = [undefined, "large-200", "large-400", "large-500"];

// How deep each field sits in the follow-up tree (0 = always shown).
function followUpDepths(fields) {
  const depth = new Map();
  for (const f of fields) depth.set(f.id, f.condition ? (depth.get(f.condition.fieldId) ?? -1) + 1 : 0);
  return depth;
}

// Applies an edit to one field and keeps the follow-ups that depend on it consistent.
function patchField(fs, id, patch) {
  const before = fs.find((f) => f.id === id);
  const after = { ...before, ...patch };
  // Follow-ups track their parent's answers: a renamed choice carries over, a removed one drops.
  const renamed = new Map(
    after.choices.length === before.choices.length
      ? before.choices.map((c, i) => [c.label.trim(), after.choices[i].label.trim()])
      : [],
  );
  const removed = after.choices.length < before.choices.length;
  const next = fs.map((f) => {
    if (f.id === id) return after;
    if (f.condition?.fieldId !== id) return f;
    let values = f.condition.values.map((v) => renamed.get(v) ?? v);
    if (removed) values = values.filter((v) => answersOf(after).includes(v));
    return { ...f, condition: { ...f.condition, values } };
  });
  // A new or removed dependency moves the field under (or out of) that question's group.
  const from = before.condition?.fieldId;
  const to = after.condition?.fieldId;
  return to !== from ? placeAfterGroup(next, id, to ?? from) : next;
}

// Whether `field` is a follow-up (at any level) of the field with id `ancestorId`.
function isUnder(fields, field, ancestorId) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  let parentId = field.condition?.fieldId;
  for (let hops = 0; parentId && hops < fields.length; hops++) {
    if (parentId === ancestorId) return true;
    parentId = byId.get(parentId)?.condition?.fieldId;
  }
  return false;
}

// End (exclusive) of the field at `index` plus the follow-ups right below it.
function blockEnd(fields, index) {
  let end = index + 1;
  while (end < fields.length && isUnder(fields, fields[end], fields[index].id)) end++;
  return end;
}

// Swaps a field (with its follow-ups) past the neighbouring group, or null when it can't
// move: a follow-up never leaves its parent's group.
function moved(fields, index, direction) {
  const parentId = fields[index].condition?.fieldId;
  const inGroup = (f) => !parentId || isUnder(fields, f, parentId);
  const end = blockEnd(fields, index);
  if (direction < 0) {
    const start = fields.findIndex((f, i) => i < index && blockEnd(fields, i) === index);
    if (start < 0 || !inGroup(fields[start])) return null;
    return [...fields.slice(0, start), ...fields.slice(index, end), ...fields.slice(start, index), ...fields.slice(end)];
  }
  if (end >= fields.length || !inGroup(fields[end])) return null;
  const after = blockEnd(fields, end);
  return [...fields.slice(0, index), ...fields.slice(end, after), ...fields.slice(index, end), ...fields.slice(after)];
}

// Moves a field (with its follow-ups) to the end of `anchorId`'s group, so follow-ups always
// sit right under the question they depend on.
function placeAfterGroup(fields, id, anchorId) {
  const index = fields.findIndex((f) => f.id === id);
  const end = blockEnd(fields, index);
  const rest = [...fields.slice(0, index), ...fields.slice(end)];
  const anchor = rest.findIndex((f) => f.id === anchorId);
  if (anchor < 0) return fields;
  const at = blockEnd(rest, anchor);
  return [...rest.slice(0, at), ...fields.slice(index, end), ...rest.slice(at)];
}

function FieldCard({ field, fields, formatMoney, open, canMoveUp, canMoveDown, onToggle, onChange, onChangeType, onMove, onDuplicate, onAddFollowUp, onRemove }) {
  const spec = FIELD_TYPES[field.type];
  const parent = field.condition && fields.find((f) => f.id === field.condition.fieldId);
  const per = field.per && fields.find((f) => f.id === field.per);
  const summary = [
    parent && `Shown when ${parent.label || "another field"} is ${field.condition.values.join(" or ") || "…"}`,
    spec.label,
    field.required && "Required",
    spec.choices
      ? field.choices.some((c) => isPriced(c.price)) && (per ? `Priced per ${unitName(per)}` : "Priced")
      : isPriced(field.price) && `+${formatMoney(Number(field.price))}${per ? ` per ${unitName(per)}` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const menuId = `field-menu-${field.id}`;

  return (
    <s-box border="base" borderRadius="base">
      <s-grid gridTemplateColumns="auto 1fr auto" gap="small-300" alignItems="center" padding="small">
        <s-icon type={spec.icon} />
        <s-clickable onClick={onToggle} accessibilityLabel={`${open ? "Collapse" : "Edit"} ${field.label || "field"}`}>
          <s-stack gap="small-500">
            <s-text type="strong">{field.label || "Untitled field"}</s-text>
            <s-text color="subdued">{summary}</s-text>
          </s-stack>
        </s-clickable>
        <s-stack direction="inline" gap="small-500" alignItems="center">
          <s-button variant="tertiary" icon="arrow-up" accessibilityLabel="Move up" disabled={!canMoveUp} onClick={() => onMove(-1)} />
          <s-button variant="tertiary" icon="arrow-down" accessibilityLabel="Move down" disabled={!canMoveDown} onClick={() => onMove(1)} />
          <s-button variant="tertiary" icon="menu-vertical" accessibilityLabel="More actions" commandFor={menuId} />
          <s-menu id={menuId} accessibilityLabel="Field actions">
            {answersOf(field).length > 0 && (
              <s-button icon="plus" onClick={onAddFollowUp}>
                Add follow-up question
              </s-button>
            )}
            <s-button icon="duplicate" onClick={onDuplicate}>
              Duplicate
            </s-button>
            <s-button icon="delete" tone="critical" onClick={onRemove}>
              Delete
            </s-button>
          </s-menu>
          <s-button variant="tertiary" icon={open ? "chevron-up" : "chevron-down"} accessibilityLabel={open ? "Collapse" : "Expand"} onClick={onToggle} />
        </s-stack>
      </s-grid>
      {open && (
        <>
          <s-divider />
          <s-box padding="base">
            <FieldSettings
              field={field}
              // Any other question except its own follow-ups (that would loop); picking one
              // moves this field under it.
              candidates={fields.filter((f) => f.id !== field.id && !isUnder(fields, f, field.id))}
              numberFields={fields.filter((f) => f.type === "number")}
              onChange={onChange}
              onChangeType={onChangeType}
            />
          </s-box>
        </>
      )}
    </s-box>
  );
}

const TWO_COLUMNS = "@container (inline-size > 500px) 1fr 1fr, 1fr";

function FieldSettings({ field, candidates, numberFields, onChange, onChangeType }) {
  const spec = FIELD_TYPES[field.type];
  const set = (key) => (e) => onChange({ [key]: e.currentTarget.value });
  const isNumber = field.type === "number";
  // Other fields can be charged for each unit of a number field: Gold $50 per tooth.
  const counters = isNumber ? [] : numberFields;
  const per = field.per && numberFields.find((f) => f.id === field.per);
  // Follow-ups can depend on any question with fixed answers, including other follow-ups.
  const parents = candidates.filter((f) => answersOf(f).length);
  const parent = field.condition && parents.find((f) => f.id === field.condition.fieldId);

  const setPriced = (priced) =>
    onChange(
      priced
        ? { priced, per: isNumber ? field.id : field.per }
        : { priced, price: null, per: null, choices: field.choices.map((c) => ({ ...c, price: null })) },
    );
  const priceLabel = isNumber
    ? (field.unit ? `Price per ${field.unit}` : "Price for each")
    : per
      ? `Price per ${unitName(per)}`
      : field.type === "checkbox"
        ? "Price when ticked"
        : "Price when filled in";

  return (
    <s-query-container>
      <s-stack gap="base">
        <s-grid gridTemplateColumns="@container (inline-size > 500px) 2fr 1fr, 1fr" gap="base">
          <s-text-field label="Question" value={field.label} placeholder="e.g. Metal type" onInput={set("label")} />
          <s-select label="Answer type" value={field.type} onChange={(e) => onChangeType(e.currentTarget.value)}>
            {Object.entries(FIELD_TYPES).map(([type, t]) => (
              <s-option key={type} value={type}>
                {t.label}
              </s-option>
            ))}
          </s-select>
        </s-grid>

        {isNumber && (
          <s-grid gridTemplateColumns={TWO_COLUMNS} gap="base">
            <s-number-field label="Lowest allowed" value={field.min == null ? "" : String(field.min)} placeholder="No limit" onInput={set("min")} />
            <s-number-field label="Highest allowed" value={field.max == null ? "" : String(field.max)} placeholder="No limit" onInput={set("max")} />
          </s-grid>
        )}
        {spec.choices && <ChoicesEditor field={field} onChange={onChange} />}

        <s-checkbox label="Required" checked={field.required} onChange={(e) => onChange({ required: e.currentTarget.checked })} />
        <s-divider />

        <s-switch
          label="Charge extra"
          details={spec.choices ? "Set a price for each choice. Leave free ones empty." : undefined}
          checked={field.priced}
          onChange={(e) => setPriced(e.currentTarget.checked)}
        />
        {field.priced && (!spec.choices || counters.length > 0) && (
          <s-grid gridTemplateColumns={TWO_COLUMNS} gap="base">
            {!spec.choices && (
              <s-money-field
                label={priceLabel}
                value={field.price == null ? "" : String(field.price)}
                placeholder="0.00"
                min={0}
                max={MAX_PRICE}
                onInput={set("price")}
              />
            )}
            {counters.length > 0 && (
              <s-select label="Charge" value={field.per ?? ""} onChange={(e) => onChange({ per: e.currentTarget.value || null })}>
                <s-option value="">Once</s-option>
                {counters.map((n) => (
                  <s-option key={n.id} value={n.id}>
                    {n.unit ? `Per ${n.unit} (${n.label || "Untitled field"})` : `Times “${n.label || "Untitled field"}”`}
                  </s-option>
                ))}
              </s-select>
            )}
          </s-grid>
        )}

        <s-switch
          label="Depends on another answer"
          details={
            parents.length
              ? "Only shown, and only charged, when the customer picks a matching answer above."
              : "Add a question with buttons, a dropdown, swatches or a checkbox first."
          }
          checked={Boolean(field.condition)}
          disabled={!parents.length && !field.condition}
          onChange={(e) => onChange({ condition: e.currentTarget.checked ? { fieldId: parents[0].id, values: [] } : null })}
        />
        {field.condition && (
          <s-grid gridTemplateColumns={TWO_COLUMNS} gap="base">
            <s-select
              label="Show when"
              value={field.condition.fieldId}
              onChange={(e) => onChange({ condition: { fieldId: e.currentTarget.value, values: [] } })}
            >
              {!parent && <s-option value={field.condition.fieldId}>Choose a question</s-option>}
              {parents.map((p) => (
                <s-option key={p.id} value={p.id}>
                  {p.label || "Untitled field"}
                </s-option>
              ))}
            </s-select>
            {parent ? (
              <s-choice-list
                label="is answered with"
                multiple
                values={field.condition.values}
                onChange={(e) => onChange({ condition: { ...field.condition, values: e.currentTarget.values } })}
              >
                {answersOf(parent).map((answer) => (
                  <s-choice key={answer} value={answer}>
                    {answer}
                  </s-choice>
                ))}
              </s-choice-list>
            ) : (
              <s-paragraph tone="critical">The question this depends on was removed.</s-paragraph>
            )}
          </s-grid>
        )}
      </s-stack>
    </s-query-container>
  );
}

function ChoicesEditor({ field, onChange }) {
  const swatch = field.type === "swatch";
  const [stepsOpen, setStepsOpen] = useState(false);
  const setChoice = (i, patch) => onChange({ choices: field.choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const columns = [swatch && "9rem", "1fr", field.priced && "8rem", "auto"].filter(Boolean).join(" ");

  return (
    <s-stack gap="small-300">
      <s-text type="strong">Choices</s-text>
      {field.choices.map((choice, i) => (
        // Index keys are fine: every input is controlled, so values follow the array.
        <s-grid key={i} gridTemplateColumns={columns} gap="small-300" alignItems="center">
          {swatch && (
            <s-color-field
              label={`Color for choice ${i + 1}`}
              labelAccessibilityVisibility="exclusive"
              value={choice.color}
              onChange={(e) => setChoice(i, { color: e.currentTarget.value })}
            />
          )}
          <s-text-field
            label={`Choice ${i + 1}`}
            labelAccessibilityVisibility="exclusive"
            placeholder={`Choice ${i + 1}`}
            value={choice.label}
            onInput={(e) => setChoice(i, { label: e.currentTarget.value })}
          />
          {field.priced && (
            <s-money-field
              label={`Price for choice ${i + 1}`}
              labelAccessibilityVisibility="exclusive"
              placeholder="Free"
              min={0}
              max={MAX_PRICE}
              value={choice.price == null ? "" : String(choice.price)}
              onInput={(e) => setChoice(i, { price: e.currentTarget.value })}
            />
          )}
          <s-button
            variant="tertiary"
            icon="delete"
            accessibilityLabel={`Remove choice ${i + 1}`}
            disabled={field.choices.length === 1}
            onClick={() => onChange({ choices: field.choices.filter((_, j) => j !== i) })}
          />
        </s-grid>
      ))}
      <s-stack direction="inline" gap="base">
        <s-button variant="tertiary" icon="plus" onClick={() => onChange({ choices: [...field.choices, newChoice(field.type)] })}>
          Add choice
        </s-button>
        {field.priced && field.choices.length > 2 && (
          <s-button variant="tertiary" icon="wand" onClick={() => setStepsOpen(!stepsOpen)}>
            Price in steps
          </s-button>
        )}
      </s-stack>
      {field.priced && stepsOpen && <StepPrices field={field} onChange={onChange} />}
    </s-stack>
  );
}

// Fills every choice price at once: a first price, then the same increase for each next choice.
function StepPrices({ field, onChange }) {
  const [first, setFirst] = useState("");
  const [step, setStep] = useState("");
  const fill = () =>
    onChange({
      choices: field.choices.map((c, i) => {
        const price = Math.round(((Number(first) || 0) + (Number(step) || 0) * i) * 100) / 100;
        return { ...c, price: price > 0 ? price : null };
      }),
    });

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-grid gridTemplateColumns="@container (inline-size > 500px) 1fr 1fr auto, 1fr" gap="base" alignItems="end">
        <s-money-field label="First choice" value={first} min={0} max={MAX_PRICE} onInput={(e) => setFirst(e.currentTarget.value)} />
        <s-money-field
          label="Each next choice adds"
          value={step}
          min={0}
          max={MAX_PRICE}
          details="0 and 5 gives 0, 5, 10, 15…"
          onInput={(e) => setStep(e.currentTarget.value)}
        />
        <s-button onClick={fill}>Fill prices</s-button>
      </s-grid>
    </s-box>
  );
}

// Approximates the storefront block with admin components; the theme restyles the real thing.
// Framed like a storefront product page, so merchants see the fields in context.
function Preview({ fields, formatMoney }) {
  return (
    <s-stack gap="base">
      <div className="co-device">
        <div className="co-device__bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <span className="co-device__url">yourstore.com/products/…</span>
        </div>
        <div className="co-device__body">
          <div className="co-device__product" aria-hidden="true">
            <div className="co-device__image" />
            <div className="co-stack" style={{ gap: 8 }}>
              <span className="co-skeleton" style={{ inlineSize: "85%" }} />
              <span className="co-skeleton" style={{ inlineSize: "40%" }} />
            </div>
          </div>
          {fields.length ? (
            fields.map((field) => <PreviewField key={field.id} field={field} fields={fields} formatMoney={formatMoney} />)
          ) : (
            <s-paragraph color="subdued">Add a field to preview it here.</s-paragraph>
          )}
          <div className="co-device__cart" aria-hidden="true">
            Add to cart
            {hasPrices(fields) && <small>+ selected options</small>}
          </div>
        </div>
      </div>
      <s-paragraph color="subdued">
        Extra charges are added to the product price in the cart, and checkout
        and orders list them separately.
      </s-paragraph>
    </s-stack>
  );
}

function PreviewField({ field, fields, formatMoney }) {
  const per = field.per && fields.find((f) => f.id === field.per);
  const plus = (price) => (isPriced(price) ? ` (+${formatMoney(Number(price))}${per ? ` per ${unitName(per)}` : ""})` : "");
  const label = (field.label || "Untitled field") + (FIELD_TYPES[field.type].choices ? "" : plus(field.price));
  const parent = field.condition && fields.find((f) => f.id === field.condition.fieldId);
  const details =
    [field.helpText, parent && `Appears when ${parent.label || "another field"} is ${field.condition.values.join(" or ") || "…"}`]
      .filter(Boolean)
      .join(" · ") || undefined;
  const common = { label, required: field.required, details };
  const choices = field.choices.filter((c) => c.label.trim());

  switch (field.type) {
    case "textarea":
      return <s-text-area {...common} placeholder={field.placeholder} maxLength={field.maxLength ?? undefined} rows={3} />;
    case "number":
      return (
        <s-number-field
          {...common}
          placeholder={field.placeholder}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          step={field.integer ? 1 : undefined}
        />
      );
    case "date":
      return <s-date-field {...common} />;
    case "select":
      return (
        <s-select {...common} placeholder="Choose an option">
          {choices.map((c) => (
            <s-option key={c.label} value={c.label}>
              {c.label + plus(c.price)}
            </s-option>
          ))}
        </s-select>
      );
    case "radio":
    case "checkboxes":
      return (
        <s-choice-list {...common} multiple={field.type === "checkboxes"}>
          {choices.map((c) => (
            <s-choice key={c.label} value={c.label}>
              {c.label + plus(c.price)}
            </s-choice>
          ))}
        </s-choice-list>
      );
    case "checkbox":
      return <s-checkbox {...common} />;
    case "swatch":
      return (
        <s-stack gap="small-300">
          <s-text>{field.required ? `${label} *` : label}</s-text>
          <s-stack direction="inline" gap="small-300">
            {choices.map((c) => (
              <span
                key={c.label}
                title={c.label + plus(c.price)}
                style={{ width: 28, height: 28, borderRadius: "50%", background: c.color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.2)" }}
              />
            ))}
          </s-stack>
          {details && <s-text color="subdued">{details}</s-text>}
        </s-stack>
      );
    default:
      return <s-text-field {...common} placeholder={field.placeholder} maxLength={field.maxLength ?? undefined} />;
  }
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
