import { Link, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { FIELD_TYPES, hasPrices } from "../options";
import { countProducts, isBlockInTheme, themeEditorUrl } from "../options.server";
import { TEMPLATES } from "../templates";
import { plural } from "../components/OptionSetsTable";
import { Brand } from "../components/Brand";
import { TryIt } from "../components/TryIt";
import { Ring } from "../components/Ring";
import { Capabilities } from "../components/Capabilities";
import { TemplateGallery } from "../components/TemplateGallery";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;
  const [latest, activeSets, draft, products, totalProducts, blockAdded, shopName] = await Promise.all([
    prisma.optionSet.findFirst({ where: { shop }, orderBy: { updatedAt: "desc" }, select: { id: true } }),
    prisma.optionSet.findMany({ where: { shop, status: "ACTIVE" }, select: { fields: true } }),
    prisma.optionSet.count({ where: { shop, status: "DRAFT" } }),
    prisma.optionSetProduct.findMany({
      where: { optionSet: { shop, status: "ACTIVE" } },
      distinct: ["productId"],
      select: { productId: true },
    }),
    countProducts(admin),
    isBlockInTheme(admin),
    admin
      .graphql(
        `#graphql
        query ShopName { shop { name } }`,
      )
      .then((res) => res.json())
      .then((json) => json.data.shop.name),
  ]);

  // Live fields only: what customers actually see on product pages.
  const fields = activeSets.flatMap((s) => s.fields);
  const byType = new Map();
  for (const f of fields) byType.set(f.type, (byType.get(f.type) ?? 0) + 1);

  return {
    shopName,
    latestId: latest?.id ?? null,
    active: activeSets.length,
    draft,
    productCount: products.length,
    totalProducts,
    fieldCount: fields.length,
    requiredCount: fields.filter((f) => f.required).length,
    pricedCount: fields.filter((f) => hasPrices([f])).length,
    typeCounts: Object.fromEntries(byType),
    blockAdded,
    themeEditorUrl: themeEditorUrl(shop),
    // Optional: set SUPPORT_EMAIL in .env to show the support line at the bottom.
    // eslint-disable-next-line no-undef
    supportEmail: process.env.SUPPORT_EMAIL || null,
  };
};

const number = new Intl.NumberFormat("en-US");

export default function Dashboard() {
  const data = useLoaderData();
  const { active, draft, productCount, blockAdded, latestId } = data;
  const hasSets = active + draft > 0;

  const steps = [
    {
      title: "Create an option set",
      done: hasSets,
      body: "Group the questions customers answer, from a template or from scratch.",
      action: { label: "Start from a template", to: "/app/templates" },
    },
    {
      title: "Choose its products",
      done: productCount > 0,
      body: "Assign by product, collection, tag or category.",
      action: { label: "Choose products", to: latestId ? `/app/option-sets/${latestId}` : "/app/option-sets" },
    },
    {
      title: "Add the block to your theme",
      done: blockAdded,
      body: "Options appear as soon as a set is assigned.",
      action: { label: "Open theme editor", href: data.themeEditorUrl },
    },
  ];
  const live = steps.every((s) => s.done);

  return (
    <s-page heading="Dashboard" inlineSize="large">
      <div className="co-wrap co-animate">
        <Hero data={data} hasSets={hasSets} live={live} steps={steps} />
        {!live && <SetupSteps steps={steps} />}
        <Kpis data={data} />
        {hasSets && <Insights data={data} />}

        <section className="co-center">
          <h2 className="co-heading">
            Shopify stops at three options. <em>You don’t have to.</em>
          </h2>
          <p>Keep size and color as variants. Everything else lives in an option set.</p>
        </section>
        <Capabilities />

        <section className="co-block">
          <div className="co-blockhead">
            <h2 className="co-heading">
              Start from a <em>template</em>
            </h2>
            <Link className="co-link" to="/app/templates">
              All templates
            </Link>
          </div>
          <TemplateGallery templates={TEMPLATES.slice(0, 4)} />
        </section>

        {data.supportEmail && (
          <footer className="co-foot">
            <span>Stuck on setup? We can review your option set and theme placement.</span>
            <a className="co-link" href={`mailto:${data.supportEmail}`}>
              Contact support
            </a>
          </footer>
        )}
      </div>
    </s-page>
  );
}

// ---------- Hero ----------

// A personal welcome whose second line follows setup: first set, going live, then live.
function Hero({ data, hasSets, live, steps }) {
  const shopify = useAppBridge();
  const done = steps.filter((s) => s.done).length;
  const next = live
    ? `Your options are live on ${plural(data.productCount, "product")}.`
    : hasSets
      ? "Let’s get your options live."
      : "Let’s make your first option set.";
  return (
    <section className="co-hero">
      <div>
        {/* Built like the try-it card header beside it, so the two sit on one line. */}
        <Brand />
        <span className={live ? "co-state co-state--live" : "co-state"}>
          {live ? "Live on your store" : `Not live yet · ${done} of ${steps.length} setup steps done`}
        </span>
        <h1 className="co-hero__title">
          {`Welcome${hasSets ? " back" : ""}, ${data.shopName}.`} <em>{next}</em>
        </h1>
        <p className="co-hero__body">
          Add unlimited options and paid add-ons to any product, priced live and carried through to checkout. Try the
          preview on the right.
        </p>
        <div className="co-hero__actions">
          {/* Opens the list; creating a set is the merchant’s own step from there. */}
          <Link className="co-btn co-btn--dark" to="/app/option-sets">
            Go to option sets →
          </Link>
          <Link className="co-btn co-btn--glass" to="/app/templates">
            Browse templates
          </Link>
        </div>
      </div>
      <TryIt onAddToCart={() => shopify.toast.show("This is a preview. Your product pages work just like this.")} />
    </section>
  );
}

// ---------- Setup ----------

function SetupSteps({ steps }) {
  const done = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="co-glass co-setup">
      <div className="co-blockhead">
        <h2 className="co-heading co-heading--small">
          Go live in <em>three steps</em>
        </h2>
        <span className="co-progress">
          <span className="co-meter" role="meter" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
            <span className="co-meter__fill" style={{ inlineSize: `${(done / steps.length) * 100}%` }} />
          </span>
          <span className="co-mono">{`${done} / ${steps.length}`}</span>
        </span>
      </div>
      <ol className="co-steps">
        {steps.map((step, i) => {
          const state = step.done ? "done" : i === current ? "current" : "todo";
          const num = String(i + 1).padStart(2, "0");
          return (
            <li key={step.title} className={`co-step co-step--${state}`}>
              <span className="co-step__tag co-mono">
                {state === "done" ? `✓ ${num} — Done` : state === "current" ? `${num} — Up next` : num}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {/* Products wait for a set; the theme editor link is useful at any time. */}
              {!step.done &&
                (state === "current" || step.action.href) &&
                (step.action.to ? (
                  <Link className={state === "current" ? "co-btn co-btn--dark co-btn--small" : "co-link"} to={step.action.to}>
                    {step.action.label}
                  </Link>
                ) : (
                  <a className="co-link" href={step.action.href} target="_blank" rel="noreferrer">
                    {step.action.label}
                  </a>
                ))}
              {step.done && step.action.href && (
                <a className="co-link" href={step.action.href} target="_blank" rel="noreferrer">
                  {step.action.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------- Numbers ----------

function Kpis({ data }) {
  const kpis = [
    { label: "Active option sets", value: data.active, note: data.draft ? `${data.draft} in draft` : null },
    { label: "Products with options", value: data.productCount, of: data.totalProducts },
    { label: "Live questions", value: data.fieldCount, note: data.fieldCount ? `${data.requiredCount} required` : null },
    { label: "Paid options", value: data.pricedCount },
  ];
  return (
    <div className="co-kpis">
      {kpis.map((k) => (
        <Link key={k.label} to="/app/option-sets" className="co-glass co-kpi">
          <span className="co-kpi__label">{k.label}</span>
          <span className="co-kpi__value">
            {number.format(k.value)}
            {k.of != null && <small>{`of ${number.format(k.of)}`}</small>}
            {k.note && <small>{k.note}</small>}
          </span>
        </Link>
      ))}
    </div>
  );
}

// One fixed color per kind of question, in an order checked for color-blind separation
// (each neighbour pair, including last to first around the ring). Single and multiple
// checkboxes share a color: nine field types, eight distinguishable hues.
const TYPE_GROUPS = [
  { key: "text", types: ["text"], color: "#2a78d6" },
  { key: "textarea", types: ["textarea"], color: "#eb6834" },
  { key: "number", types: ["number"], color: "#1baf7a" },
  { key: "date", types: ["date"], color: "#eda100" },
  { key: "select", types: ["select"], color: "#e87ba4" },
  { key: "radio", types: ["radio"], color: "#008300" },
  { key: "swatch", types: ["swatch"], color: "#4a3aa7" },
  { key: "checkboxes", types: ["checkboxes", "checkbox"], color: "#e34948", label: "Checkboxes" },
];

function Insights({ data }) {
  const { productCount, totalProducts, fieldCount, typeCounts } = data;
  const without = Math.max(totalProducts - productCount, 0);
  const types = TYPE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label ?? FIELD_TYPES[g.key].label,
    color: g.color,
    value: g.types.reduce((sum, t) => sum + (typeCounts[t] ?? 0), 0),
  })).filter((t) => t.value > 0);

  return (
    <div className="co-two">
      <div className="co-glass co-chart">
        <h3 className="co-chart__title">Product coverage</h3>
        <Ring
          label={`${productCount} of ${totalProducts} products show options`}
          total={totalProducts}
          center={{ value: productCount, of: totalProducts, caption: "products with options" }}
          segments={[
            { key: "with", label: "With options", value: productCount, color: "#5b47e0" },
            { key: "without", label: "Without options", value: without, color: "#dcd8ec" },
          ]}
        />
      </div>
      <div className="co-glass co-chart">
        <h3 className="co-chart__title">Field types in use</h3>
        {types.length ? (
          <Ring
            label={`${fieldCount} questions across ${types.length} field types`}
            total={fieldCount}
            center={{ value: fieldCount, of: null, caption: fieldCount === 1 ? "question" : "questions" }}
            segments={types}
          />
        ) : (
          <div className="co-empty">Activate an option set with fields to see this.</div>
        )}
      </div>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
