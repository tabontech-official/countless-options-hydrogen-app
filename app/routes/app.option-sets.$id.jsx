import { useEffect, useMemo, useRef, useState } from "react";
import { useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  ADDON_TAG,
  ASSIGN_MODES,
  CATALOG_KINDS,
  FIELD_TYPES,
  MAX_CONDITIONS,
  MAX_FIELDS,
  MAX_PRICE,
  MAX_PRODUCTS,
  PRODUCT_STATUSES,
  RULE_FIELDS,
  RULE_OPS,
  UPLOAD_ACCEPT,
  answersOf,
  blankCondition,
  describeRules,
  hasPrices,
  newChoice,
  newField,
  rulesOf,
  rulesQuery,
  validateOptionSet,
} from "../options";
import { ensurePricing, getProducts, getShopCurrency, ruleMatches, syncProducts } from "../options.server";
import { StatusBadge, plural } from "../components/OptionSetsTable";

// A set that's gone (deleted, a second Delete click, Back after deleting, another tab)
// sends the merchant to the list instead of an error page.
async function findSet(shop, id, redirect) {
  if (id === "new") return null;
  // Scoped by shop so one store can never read or edit another store's set.
  const set = await prisma.optionSet.findFirst({ where: { id, shop }, include: { products: true } });
  if (!set) throw redirect("/app/option-sets");
  return set;
}

export const loader = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const set = await findSet(session.shop, params.id, redirect);
  const search = new URL(request.url).searchParams;
  const unsynced = search.has("unsynced");
  // Set when a template was just copied into this store (see app.templates.jsx).
  const created = search.has("created");
  const [currency, products] = await Promise.all([
    getShopCurrency(admin),
    // Rule-based sets record their matches too (possibly thousands); only hand-picked ones are listed.
    getProducts(admin, set && rulesOf(set.rules).mode === "manual" ? set.products.map((p) => p.productId) : []),
  ]);
  if (!set) {
    return { unsynced, currency, set: { id: null, name: "", status: "ACTIVE", fields: [], products: [], rules: rulesOf(), updatedAt: null } };
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
      rules: rulesOf(set.rules),
      updatedAt: set.updatedAt.toISOString(),
    },
  };
};

export const action = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const { shop } = session;
  const existing = await findSet(shop, params.id, redirect);
  // Every product a set reaches: picked by hand, or matched by its rules today.
  // Every product the set reaches now: picked by hand, or recorded as a rule match by syncProducts.
  const reach = (set) => set?.products.map((p) => p.productId) ?? [];
  const body = await request.json();

  if (existing && body.intent === "delete") {
    // Hide it from the storefront first, so a failed sync never leaves orphaned options live.
    await prisma.optionSet.update({ where: { id: existing.id }, data: { status: "DRAFT" } });
    await syncProducts(admin, shop, reach(existing));
    await prisma.optionSet.delete({ where: { id: existing.id } });
    return redirect("/app/option-sets");
  }
  if (existing && body.intent === "duplicate") {
    const copy = await prisma.optionSet.create({
      data: { shop, name: `Copy of ${existing.name}`.slice(0, 100), status: "DRAFT", fields: existing.fields, rules: existing.rules },
    });
    return redirect(`/app/option-sets/${copy.id}`);
  }
  if (existing && body.intent === "sync") {
    // Also searches the rules again, in case the failed sync never recorded new matches.
    await syncProducts(admin, shop, [...reach(existing), ...(await ruleMatches(admin, existing.rules))]);
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

  // Products the set reached before saving: they may lose it.
  const before = reach(existing);
  // Keeps only products that exist in this shop.
  const productIds = (await getProducts(admin, data.productIds)).map((p) => p.id);
  const values = { name: data.name, status: data.status, fields: data.fields, rules: data.rules };
  const products = productIds.map((productId) => ({ productId }));
  // Hand-picked sets replace their list. Rule-based sets keep their recorded matches, and
  // syncProducts adds and removes them, so a failed sync never loses track of a product.
  const saved = existing
    ? await prisma.optionSet.update({
        where: { id: existing.id },
        data: { ...values, ...(data.rules.mode === "manual" && { products: { deleteMany: {}, create: products } }) },
      })
    : await prisma.optionSet.create({ data: { shop, ...values, products: { create: products } } });

  try {
    await syncProducts(admin, shop, [...before, ...productIds, ...(await ruleMatches(admin, data.rules))]);
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

const snapshot = (d) => JSON.stringify([d.name, d.status, d.fields, d.products.map((p) => p.id), d.rules]);

function Editor({ set, currency, serverErrors, unsynced }) {
  const shopify = useAppBridge();
  const formatMoney = useMemo(() => {
    const format = new Intl.NumberFormat("en-US", { style: "currency", currency });
    return (amount) => format.format(amount);
  }, [currency]);
  const submit = useSubmit();
  const navigation = useNavigation();
  const initial = useMemo(
    () => ({ name: set.name, status: set.status, fields: set.fields, products: set.products, rules: set.rules }),
    [set],
  );
  const [draft, setDraft] = useState(initial);
  const [openId, setOpenId] = useState(null);
  const [picking, setPicking] = useState(false);
  const [clientErrors, setClientErrors] = useState([]);

  const isNew = !set.id;
  const dirty = snapshot(draft) !== snapshot(initial);
  const saving = navigation.state === "submitting";
  const deleting = navigation.state !== "idle" && navigation.json?.intent === "delete";
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
    setPicking(false);
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

  // Shopify's own product picker. It opens with the current products ticked, so what comes back
  // is the new list (removals included). The hidden "Option add-ons" product is left out.
  const [showAllProducts, setShowAllProducts] = useState(false);
  const pickProducts = async () => {
    const picked = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: MAX_PRODUCTS,
      selectionIds: draft.products.map((p) => ({ id: p.id })),
      filter: { variants: false, query: `-tag:${ADDON_TAG}` },
    });
    if (picked) update({ products: picked.map((p) => ({ id: p.id, title: p.title, image: p.images?.[0]?.originalSrc ?? null })) });
  };
  const visibleProducts = showAllProducts ? draft.products : draft.products.slice(0, PRODUCTS_PREVIEW);

  return (
    <s-page heading={isNew ? "Create option set" : set.name} inlineSize="large">
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

      {/* No entrance animation here: the editor remounts on every save. */}
      <div className="co-wrap">
        <header className="co-edithead">
          <span className="co-kicker">{isNew ? "New option set" : "Option set"}</span>
          <h1 className="co-heading">{draft.name.trim() || "Untitled option set"}</h1>
          <span className="co-edithead__meta">
            <StatusBadge status={draft.status} />
            {`${plural(draft.fields.length, "question")} · ${
              draft.rules.mode === "manual" ? plural(draft.products.length, "product") : describeRules(draft.rules)
            }`}
          </span>
        </header>

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

        <div className="co-editor">
          <div className="co-stack co-editor__main">
            <EditorCard num="01" title="Details" hint="Only you see this name; customers never do.">
              <s-text-field
                label="Name"
                value={draft.name}
                placeholder="e.g. Engraving options"
                onInput={(e) => update({ name: e.currentTarget.value })}
              />
            </EditorCard>

            <EditorCard
              num="02"
              title="Questions"
              hint="What customers answer on the product page, in this order."
              aside={draft.fields.length > 0 && `${draft.fields.length} / ${MAX_FIELDS}`}
            >
              {draft.fields.length > 0 && (
                <div className="co-qs">
                  {draft.fields.map((field, index) => (
                    // Follow-ups sit indented under the question they depend on.
                    <div key={field.id} style={{ "--co-depth": Math.min(depth.get(field.id), 3) }} className="co-qs__item">
                      <FieldCard
                        field={field}
                        fields={draft.fields}
                        formatMoney={formatMoney}
                        followUp={depth.get(field.id) > 0}
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
                    </div>
                  ))}
                </div>
              )}
              {/* Open until the first question exists; after that, behind one "Add a question" button. */}
              {picking || !draft.fields.length ? (
                <div className={draft.fields.length ? "co-picker co-picker--more" : "co-picker"}>
                  <div className="co-picker__head">
                    <span className="co-kicker">
                      {draft.fields.length ? "Choose an answer type" : "Choose the first question’s answer type"}
                    </span>
                    {draft.fields.length > 0 && (
                      <button type="button" className="co-link" onClick={() => setPicking(false)}>
                        Cancel
                      </button>
                    )}
                  </div>
                  <div className="co-typegrid">
                    {Object.entries(FIELD_TYPES).map(([type, spec]) => (
                      <button key={type} type="button" className="co-type" onClick={() => addField(type)}>
                        <TypeArt type={type} />
                        <span className="co-type__text">
                          <strong>{spec.label}</strong>
                          <small>{spec.hint}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button type="button" className="co-addbtn" onClick={() => setPicking(true)}>
                  <span aria-hidden="true">+</span>
                  Add a question
                </button>
              )}
            </EditorCard>

            <EditorCard
              num="03"
              title="Products"
              hint="Choose which products show these questions."
              aside={draft.rules.mode === "manual" && draft.products.length > 0 && plural(draft.products.length, "product")}
            >
              <div className="co-segment co-segment--plain co-assign">
                {Object.entries(ASSIGN_MODES).map(([mode, label]) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name="assign"
                      value={mode}
                      checked={draft.rules.mode === mode}
                      // Conditions start with one empty row, ready to fill in.
                      onChange={() =>
                        update({
                          rules: {
                            ...draft.rules,
                            mode,
                            conditions: draft.rules.conditions.length ? draft.rules.conditions : [blankCondition()],
                          },
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {draft.rules.mode === "match" && <RulesEditor rules={draft.rules} onChange={(rules) => update({ rules })} />}
              {draft.rules.mode === "all" && (
                <MatchCount
                  rules={draft.rules}
                  title={(n) => `All ${plural(n, "product")}`}
                  note="Products you add later get these questions too."
                />
              )}
              {draft.rules.mode === "manual" && (
                <>
                  {draft.products.length > 0 ? (
                    <ul className="co-rows">
                      {visibleProducts.map((product) => (
                        <li key={product.id} className="co-product">
                          <s-thumbnail src={product.image ?? undefined} alt={product.title} size="small" />
                          <span>{product.title}</span>
                          <s-button
                            variant="tertiary"
                            icon="x"
                            accessibilityLabel={`Remove ${product.title}`}
                            onClick={() => update({ products: draft.products.filter((p) => p.id !== product.id) })}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="co-empty co-placeholder">These questions only show on the products you choose.</div>
                  )}
                  <div className="co-actions">
                    <s-button icon="product" onClick={pickProducts}>
                      {draft.products.length ? "Edit products" : "Select products"}
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
                  </div>
                </>
              )}
            </EditorCard>

            {!isNew && (
              <div className="co-actions co-actions--end">
                <s-button tone="critical" commandFor="delete-modal" command="--show">
                  Delete option set
                </s-button>
              </div>
            )}
          </div>

          <aside className="co-stack co-editor__aside">
            <EditorCard title="Status" hint={draft.status === "ACTIVE" ? "Customers see these options." : "Hidden from your store."}>
              {/* Native radios: arrow keys and screen readers work without extra code. */}
              <div className="co-segment">
                {[
                  ["ACTIVE", "Active"],
                  ["DRAFT", "Draft"],
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="status"
                      value={value}
                      checked={draft.status === value}
                      onChange={() => update({ status: value })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </EditorCard>
            <EditorCard title="Preview">
              <Preview fields={draft.fields} formatMoney={formatMoney} />
            </EditorCard>
          </aside>
        </div>
      </div>

      <s-modal id="delete-modal" heading="Delete option set?">
        <s-paragraph>
          {`"${set.name}" will be removed from ${
            set.rules.mode === "manual" ? plural(set.products.length, "product") : "every product it applies to"
          }. This can't be undone.`}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={deleting ? "" : undefined}
          disabled={deleting}
          onClick={() => post({ intent: "delete" })}
        >
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

// A miniature of each answer type as customers see it, drawn in CSS (see .co-art in app.css).
function TypeArt({ type }) {
  const line = (width) => <i className="co-art__line" style={{ inlineSize: width }} />;
  const art = {
    text: (
      <span className="co-art__field">
        {line("42%")}
        <i className="co-art__caret" />
      </span>
    ),
    textarea: (
      <span className="co-art__field co-art__field--tall">
        {line("88%")}
        {line("72%")}
        {line("40%")}
      </span>
    ),
    number: (
      <span className="co-art__field co-art__field--stepper">
        <b>−</b>
        <b>2</b>
        <b>+</b>
      </span>
    ),
    date: (
      <span className="co-art__cal">
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} className={i === 9 ? "is-on" : undefined} />
        ))}
      </span>
    ),
    select: (
      <span className="co-art__field">
        {line("50%")}
        <i className="co-art__chev" />
      </span>
    ),
    radio: (
      <span className="co-art__row">
        <i className="co-art__pill is-on" />
        <i className="co-art__pill" />
        <i className="co-art__pill" />
      </span>
    ),
    swatch: (
      <span className="co-art__row">
        {["#d6b98c", "#e9b8c0", "#a9bfa4"].map((color, i) => (
          <i key={color} className={i ? "co-art__dot" : "co-art__dot is-on"} style={{ background: color }} />
        ))}
      </span>
    ),
    checkboxes: (
      <span className="co-art__list">
        <span>
          <i className="co-art__box is-on" />
          {line("62%")}
        </span>
        <span>
          <i className="co-art__box" />
          {line("44%")}
        </span>
      </span>
    ),
    checkbox: (
      <span className="co-art__list">
        <span>
          <i className="co-art__box is-on" />
          {line("56%")}
        </span>
      </span>
    ),
    file: (
      <span className="co-art__field">
        <i className="co-art__up" />
        {line("48%")}
      </span>
    ),
  };
  return (
    <span className="co-art" aria-hidden="true">
      {art[type]}
    </span>
  );
}

const VALUE_HINTS = { tag: "e.g. engraving", vendor: "e.g. Acme Jewelry", type: "e.g. Rings" };
const VALUE_NOUNS = { tag: "tag", vendor: "vendor", type: "product type" };

// A text field that lists the store's matching values while typing, with "Add" for a new one,
// like the tag field in Shopify's admin. A new tag needs nothing more: products tagged with
// it later get the questions.
function SuggestField({ label, placeholder, value, options, noun, onChange }) {
  const [open, setOpen] = useState(false);
  const typed = value.trim();
  const needle = typed.toLowerCase();
  const matches = (options ?? []).filter((o) => o.toLowerCase().includes(needle)).slice(0, 8);
  const isNew = Boolean(typed) && !(options ?? []).some((o) => o.toLowerCase() === needle);
  const choose = (picked) => {
    onChange(picked);
    setOpen(false);
  };
  // Entries keep focus in the field when pressed, so the list doesn't close before the click lands.
  const keepFocus = (e) => e.preventDefault();

  return (
    <div
      className="co-suggest"
      onFocus={() => setOpen(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <s-text-field
        label={label}
        labelAccessibilityVisibility="exclusive"
        placeholder={placeholder}
        value={value}
        onInput={(e) => {
          onChange(e.currentTarget.value);
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      {open && options && (matches.length > 0 || isNew) && (
        <div className="co-suggest__list" role="listbox" aria-label={`${noun}s in your store`}>
          {matches.map((o) => (
            <button key={o} type="button" role="option" aria-selected={o === value} onMouseDown={keepFocus} onClick={() => choose(o)}>
              {o}
            </button>
          ))}
          {isNew && (
            <button type="button" role="option" aria-selected={false} className="co-suggest__add" onMouseDown={keepFocus} onClick={() => choose(typed)}>
              {`Add “${typed}”`}
              <small>{`New ${noun}`}</small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Conditions like Shopify's own product filters: "Tag is engraving", "Catalog is Region: Europe".
// A tag doesn't have to exist yet; products that match later get the questions automatically
// (webhooks.products.update.jsx, webhooks.collections.update.jsx).
function RulesEditor({ rules, onChange }) {
  const shopify = useAppBridge();
  const suggestions = useFetcher();
  const channels = useFetcher();
  const catalogs = useFetcher();
  // Tags, vendors and types to suggest while typing; loaded once for all rows.
  useEffect(() => {
    suggestions.load("/app/rule-values?kind=suggest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [categoryRow, setCategoryRow] = useState(null);

  // Shopify only has a tag once a product carries it, so a new tag offers to tag products now.
  const tagger = useFetcher();
  const [tagged, setTagged] = useState(0); // recounts the matches after tagging
  const isNewTag = (c) =>
    c.field === "tag" &&
    Boolean(c.value.trim()) &&
    Boolean(suggestions.data) &&
    !suggestions.data.tag.some((t) => t.toLowerCase() === c.value.trim().toLowerCase());
  const tagProducts = async (tag) => {
    const picked = await shopify.resourcePicker({
      type: "product",
      action: "add",
      multiple: MAX_PRODUCTS,
      filter: { variants: false, query: `-tag:${ADDON_TAG}` },
    });
    if (picked?.length) {
      tagger.submit({ tag, productIds: picked.map((p) => p.id) }, { method: "post", action: "/app/rule-values", encType: "application/json" });
    }
  };
  useEffect(() => {
    if (!tagger.data) return;
    if (tagger.data.error) {
      shopify.toast.show(tagger.data.error, { isError: true });
      return;
    }
    shopify.toast.show(`Added “${tagger.data.tag}” to ${plural(tagger.data.tagged, "product")}`);
    suggestions.load("/app/rule-values?kind=suggest");
    setTagged((n) => n + 1);
    // Runs once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagger.data]);

  const setCondition = (i, patch) =>
    onChange({ ...rules, conditions: rules.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  // Channel and catalog lists load the first time a condition needs them.
  const needsChannels = rules.conditions.some((c) => c.field === "channel");
  const needsCatalogs = rules.conditions.some((c) => c.field === "catalog");
  useEffect(() => {
    if (needsChannels && !channels.data) channels.load("/app/rule-values?kind=channel");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsChannels]);
  useEffect(() => {
    if (needsCatalogs && !catalogs.data) catalogs.load("/app/rule-values?kind=catalog");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCatalogs]);

  // Collections come from Shopify's own picker: kept by ID, shown by title.
  const pickCollection = async (i) => {
    const [picked] = (await shopify.resourcePicker({ type: "collection", action: "select" })) ?? [];
    if (picked) setCondition(i, { value: picked.id, label: picked.title });
  };

  const valueControl = (c, i) => {
    const label = `Condition ${i + 1}: value`;
    switch (c.field) {
      case "status":
        return (
          <s-select label={label} labelAccessibilityVisibility="exclusive" value={c.value} onChange={(e) => setCondition(i, { value: e.currentTarget.value })}>
            {Object.entries(PRODUCT_STATUSES).map(([value, name]) => (
              <s-option key={value} value={value}>
                {name}
              </s-option>
            ))}
          </s-select>
        );
      case "category":
        return (
          <s-button icon="categories" commandFor="category-picker" command="--show" onClick={() => setCategoryRow(i)}>
            {c.value ? c.label : "Choose category"}
          </s-button>
        );
      case "collection":
        return (
          <s-button icon="collection" onClick={() => pickCollection(i)}>
            {c.value ? c.label : "Choose collection"}
          </s-button>
        );
      case "channel":
        return (
          <ListSelect
            label={label}
            options={channels.data?.options}
            value={c.value}
            placeholder="Choose a sales channel"
            onPick={(o) => setCondition(i, { value: o.value, label: o.label })}
          />
        );
      case "catalog":
        // First the kind of catalog, then the catalogs of that kind, as in Shopify's admin.
        return (
          <s-grid gridTemplateColumns="1fr 1fr" gap="small-300">
            <s-select
              label={`Condition ${i + 1}: kind of catalog`}
              labelAccessibilityVisibility="exclusive"
              value={c.kind}
              onChange={(e) => setCondition(i, { kind: e.currentTarget.value, value: "", label: undefined })}
            >
              {Object.entries(CATALOG_KINDS).map(([value, name]) => (
                <s-option key={value} value={value}>
                  {name}
                </s-option>
              ))}
            </s-select>
            <ListSelect
              label={label}
              options={catalogs.data?.options.filter((o) => o.kind === c.kind)}
              value={c.value}
              placeholder="Choose a catalog"
              onPick={(o) => setCondition(i, { value: o.value, label: o.label })}
            />
          </s-grid>
        );
      default:
        return (
          <SuggestField
            label={label}
            placeholder={VALUE_HINTS[c.field]}
            value={c.value}
            options={suggestions.data?.[c.field]}
            noun={VALUE_NOUNS[c.field]}
            onChange={(value) => setCondition(i, { value })}
          />
        );
    }
  };

  return (
    <>
      <s-query-container>
        <div className="co-rules">
          {rules.conditions.length > 1 && (
            <div className="co-matchmode" role="radiogroup" aria-label="Products must match">
              <span>Products must match</span>
              {[
                ["all", "all conditions"],
                ["any", "any condition"],
              ].map(([value, label]) => (
                <label key={value}>
                  <input type="radio" name="match" value={value} checked={rules.match === value} onChange={() => onChange({ ...rules, match: value })} />
                  {label}
                </label>
              ))}
            </div>
          )}
          {rules.conditions.map((c, i) => (
            // Index keys are fine: every input is controlled, so values follow the array.
            <div key={i} className="co-rule">
              <s-grid gridTemplateColumns="@container (inline-size > 560px) 9rem 7rem 1fr auto, 1fr 1fr" gap="small-300" alignItems="center">
                <s-select
                  label={`Condition ${i + 1}: what to check`}
                  labelAccessibilityVisibility="exclusive"
                  value={c.field}
                  // A new kind of check starts over: a tag name means nothing as a collection.
                  onChange={(e) => setCondition(i, { ...blankCondition(e.currentTarget.value), op: c.op, label: undefined })}
                >
                  {Object.entries(RULE_FIELDS).map(([value, f]) => (
                    <s-option key={value} value={value}>
                      {f.label}
                    </s-option>
                  ))}
                </s-select>
                <s-select
                  label={`Condition ${i + 1}: is or is not`}
                  labelAccessibilityVisibility="exclusive"
                  value={c.op}
                  onChange={(e) => setCondition(i, { op: e.currentTarget.value })}
                >
                  {Object.entries(RULE_OPS).map(([value, name]) => (
                    <s-option key={value} value={value}>
                      {name}
                    </s-option>
                  ))}
                </s-select>
                {valueControl(c, i)}
                <s-button
                  variant="tertiary"
                  icon="delete"
                  accessibilityLabel={`Remove condition ${i + 1}`}
                  disabled={rules.conditions.length === 1}
                  onClick={() => onChange({ ...rules, conditions: rules.conditions.filter((_, j) => j !== i) })}
                />
              </s-grid>
              {isNewTag(c) && (
                <div className="co-newtag">
                  <span>{`No product has “${c.value.trim()}” yet. Tags exist once a product has them.`}</span>
                  <s-button variant="tertiary" icon="plus" loading={tagger.state !== "idle" ? "" : undefined} onClick={() => tagProducts(c.value.trim())}>
                    Add it to products
                  </s-button>
                </div>
              )}
            </div>
          ))}
          <s-stack direction="inline">
            <s-button
              variant="tertiary"
              icon="plus"
              disabled={rules.conditions.length >= MAX_CONDITIONS}
              onClick={() => onChange({ ...rules, conditions: [...rules.conditions, blankCondition()] })}
            >
              Add condition
            </s-button>
          </s-stack>
          <MatchCount
            rules={rules}
            refresh={tagged}
            title={(n) => (n ? `${plural(n, "product")} ${n === 1 ? "matches" : "match"} today` : "No products match yet")}
            note={
              needsChannels || needsCatalogs
                ? "New matches are added automatically. Sales channel and catalog changes apply when a product is next edited, or when you save."
                : "Products that match later get these questions automatically."
            }
          />
        </div>
      </s-query-container>

      {/* One category search for every row; it starts fresh each time it opens. */}
      <s-modal id="category-picker" heading="Choose a category">
        {categoryRow !== null && (
          <CategorySearch key={categoryRow} onPick={(o) => setCondition(categoryRow, { value: o.value, label: o.label })} />
        )}
      </s-modal>
    </>
  );
}

// A select over options loaded from Shopify, with a placeholder until one is chosen.
function ListSelect({ label, options, value, placeholder, onPick }) {
  return (
    <s-select
      label={label}
      labelAccessibilityVisibility="exclusive"
      value={value}
      disabled={!options}
      placeholder={!options ? "Loading…" : options.length ? placeholder : "None in your store yet"}
      onChange={(e) => {
        const picked = options.find((o) => o.value === e.currentTarget.value);
        if (picked) onPick(picked);
      }}
    >
      {(options ?? []).map((o) => (
        <s-option key={o.value} value={o.value}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}

// Shopify's product categories, searched by name ("Rings" finds Apparel & Accessories > Jewelry > Rings).
function CategorySearch({ onPick }) {
  const results = useFetcher();
  const [query, setQuery] = useState("");
  const search = (value) => {
    setQuery(value);
    results.load(`/app/rule-values?kind=category&q=${encodeURIComponent(value)}`);
  };
  useEffect(() => {
    results.load("/app/rule-values?kind=category");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const options = results.data?.kind === "category" && results.state === "idle" ? results.data.options : null;

  return (
    <s-stack gap="base">
      <s-search-field
        label="Search categories"
        labelAccessibilityVisibility="exclusive"
        placeholder="Search categories, e.g. Rings"
        value={query}
        onInput={(e) => search(e.currentTarget.value)}
      />
      <div className="co-catlist">
        {!options ? (
          <s-spinner accessibilityLabel="Loading" />
        ) : options.length ? (
          options.map((o) => (
            <s-clickable key={o.value} padding="small" borderRadius="base" commandFor="category-picker" command="--hide" onClick={() => onPick(o)}>
              <s-text>{o.label}</s-text>
            </s-clickable>
          ))
        ) : (
          <s-text color="subdued">No categories match.</s-text>
        )}
      </div>
    </s-stack>
  );
}

// How many products the rules reach right now, so a condition's effect is visible before saving.
function MatchCount({ rules, refresh, title, note }) {
  const counter = useFetcher();
  const ready = rules.mode !== "match" || rules.conditions.every((c) => c.value.trim());
  const query = ready ? rulesQuery(rules) : null;
  // Delayed recounts read the conditions as they are by then, never the ones they started with.
  const latest = useRef(query);
  latest.current = query;
  const recount = () => latest.current && counter.load(`/app/rule-values?kind=count&q=${encodeURIComponent(latest.current)}`);
  useEffect(() => {
    // Waits for typing to pause, so a tag name isn't counted letter by letter.
    const timer = setTimeout(recount, 400);
    // Coming back from another tab (say, after tagging products in Shopify admin) counts again.
    window.addEventListener("focus", recount);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", recount);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  // ponytail: Shopify's product search catches up a few seconds after products are tagged and
  // sends no signal when it has, so a refresh counts again over the next few seconds.
  useEffect(() => {
    if (!refresh) return;
    const timers = [1500, 4000, 8000].map((ms) => setTimeout(recount, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  // The last count for these exact conditions stays up while a new one loads, so it never flickers.
  const count = counter.data?.kind === "count" && counter.data.q === query ? counter.data.count : null;

  return (
    <div className="co-matchcount" aria-live="polite">
      <span className="co-tile" aria-hidden="true">
        <s-icon type="product" />
      </span>
      <strong>{!query ? "Finish the conditions to see matching products" : count == null ? "Counting matching products…" : title(count)}</strong>
      {query && count != null && <small>{note}</small>}
    </div>
  );
}

// A glass card with the dashboard's numbered heading ("01  Details"), a hint and an optional count.
function EditorCard({ num, title, hint, aside, children }) {
  return (
    <section className="co-glass co-card co-editcard">
      <header className="co-cardhead">
        {num && <span className="co-cardhead__num co-mono">{num}</span>}
        <h2>{title}</h2>
        {aside && <span className="co-cardhead__aside co-mono">{aside}</span>}
        {hint && <p>{hint}</p>}
      </header>
      {children}
    </section>
  );
}

const PRODUCTS_PREVIEW = 10;

const isPriced = (price) => Number(price) > 0;
// What a "per" price is counted in: the number field's unit name, else its label.
const unitName = (numberField) => numberField?.unit || numberField?.label || "unit";

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

function FieldCard({ field, fields, formatMoney, followUp, open, canMoveUp, canMoveDown, onToggle, onChange, onChangeType, onMove, onDuplicate, onAddFollowUp, onRemove }) {
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
    <div className={`co-q${open ? " is-open" : ""}${followUp ? " co-q--follow" : ""}`}>
      <div className="co-q__head">
        <span className="co-q__icon">
          <s-icon type={spec.icon} />
        </span>
        <button type="button" className="co-q__title" aria-expanded={open} onClick={onToggle}>
          <strong>{field.label || "Untitled field"}</strong>
          <small>{summary}</small>
        </button>
        <span className="co-q__actions">
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
        </span>
      </div>
      {open && (
        <div className="co-q__body">
          <FieldSettings
            field={field}
            // Any other question except its own follow-ups (that would loop); picking one
            // moves this field under it.
            candidates={fields.filter((f) => f.id !== field.id && !isUnder(fields, f, field.id))}
            numberFields={fields.filter((f) => f.type === "number")}
            onChange={onChange}
            onChangeType={onChangeType}
          />
        </div>
      )}
    </div>
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
        : field.type === "file"
          ? "Price when uploaded"
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
    case "file":
      return (
        <s-stack gap="small-300">
          <s-drop-zone label={label} required={field.required} accept={UPLOAD_ACCEPT} accessibilityLabel={`Upload: ${label}`} />
          <s-text color="subdued">{details ? `Up to 10 MB · ${details}` : "Up to 10 MB"}</s-text>
        </s-stack>
      );
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
