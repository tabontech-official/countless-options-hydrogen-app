import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { validateOptionSet } from "../options";
import { TEMPLATES, findTemplate, templateFields } from "../templates";
import { TemplateGallery } from "../components/TemplateGallery";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

// "Use template": saves a copy as one of this store's option sets and opens it.
// Active but without products, so nothing shows on the storefront until products are chosen.
export const action = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  const template = findTemplate((await request.formData()).get("template"));
  if (!template) throw new Response("Template not found", { status: 404 });

  // Stored exactly as a normal save would store it.
  const { errors, data } = validateOptionSet({ name: template.name, status: "ACTIVE", fields: templateFields(template) });
  if (errors.length) throw new Error(`Template ${template.id} is invalid: ${errors.join(" ")}`);
  const set = await prisma.optionSet.create({
    data: { shop: session.shop, name: data.name, status: data.status, fields: data.fields },
  });
  return redirect(`/app/option-sets/${set.id}?created`);
};

const CATEGORIES = ["All", ...new Set(TEMPLATES.map((t) => t.category))];

export default function Templates() {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = TEMPLATES.filter(
    (t) =>
      (category === "All" || t.category === category) &&
      (!needle || [t.name, t.category, t.description, ...t.fields.map((f) => f.label)].some((s) => s.toLowerCase().includes(needle))),
  );

  return (
    <s-page heading="Templates" inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>
      <s-button slot="primary-action" href="/app/option-sets/new">
        Start from scratch
      </s-button>
      <div className="co-stack co-animate">
        <header className="co-pagehead">
          <span className="co-kicker">{`${TEMPLATES.length} ready-made option sets`}</span>
          <h1 className="co-display">
            Start with something <em>beautiful.</em>
          </h1>
          <p className="co-lede">
            Choose a template and it’s added to your store as an option set. Rename, reprice or remove anything, then
            pick the products it appears on.
          </p>
        </header>

        <div className="co-toolbar">
          <div className="co-pills" role="tablist" aria-label="Categories">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={category === c}
                className="co-pill"
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <s-search-field
            label="Search templates"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search templates"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>

        {shown.length ? (
          <TemplateGallery templates={shown} />
        ) : (
          <div className="co-card co-empty">
            <s-icon type="search" tone="neutral" />
            No templates match. Try another category or search.
          </div>
        )}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
