import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listOptionSets } from "../options.server";
import { OptionSetsTable, plural } from "../components/OptionSetsTable";
import { TemplateGallery } from "../components/TemplateGallery";
import { TEMPLATES } from "../templates";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { sets: await listOptionSets(session.shop) };
};

const STATUSES = [
  { value: "", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Draft" },
];

export default function OptionSets() {
  const { sets } = useLoaderData();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  // ponytail: filtered in the browser; every set is already loaded for the list.
  const needle = query.trim().toLowerCase();
  const shown = sets.filter(
    (s) =>
      (!status || s.status === status) &&
      (!needle || [s.name, ...s.fieldNames].some((text) => text.toLowerCase().includes(needle))),
  );
  const count = (value) => (value ? sets.filter((s) => s.status === value).length : sets.length);

  return (
    <s-page heading="Option sets" inlineSize="large">
      <s-button slot="primary-action" variant="primary" href="/app/option-sets/new">
        Create option set
      </s-button>
      <div className="co-wrap co-animate">
        <header className="co-pagehead">
          <span className="co-kicker">
            {sets.length ? `${plural(sets.length, "option set")} · ${count("ACTIVE")} active` : "No option sets yet"}
          </span>
          <h1 className="co-display">
            Your <em>option sets</em>
          </h1>
          <p className="co-lede">
            Each set is a group of questions customers answer on the product page. Open one to edit its questions,
            prices and products.
          </p>
        </header>

        {sets.length ? (
          <OptionSetsTable
            sets={shown}
            toolbar={
              <>
                <div className="co-tabs" role="tablist" aria-label="Status">
                  {STATUSES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      role="tab"
                      aria-selected={status === s.value}
                      className="co-tab"
                      onClick={() => setStatus(s.value)}
                    >
                      {s.label}
                      <span>{count(s.value)}</span>
                    </button>
                  ))}
                </div>
                <div className="co-table__search">
                  <s-search-field
                    label="Search option sets"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="Search by name or question"
                    value={query}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                </div>
              </>
            }
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </s-page>
  );
}

function EmptyState() {
  return (
    <>
      <section className="co-glass co-card co-start">
        <h2 className="co-heading co-heading--small">
          Add custom options <em>to your products</em>
        </h2>
        <p>Collect engraving text, gift messages, color choices and more, without creating extra variants.</p>
        <div className="co-hero__actions">
          <Link className="co-btn co-btn--dark" to="/app/option-sets/new">
            Start from scratch
          </Link>
          <Link className="co-btn co-btn--glass" to="/app/templates">
            Browse all templates
          </Link>
        </div>
      </section>
      <section className="co-block">
        <div className="co-blockhead">
          <h2 className="co-heading co-heading--small">
            Or start from a <em>template</em>
          </h2>
          <Link className="co-link" to="/app/templates">
            All templates
          </Link>
        </div>
        <TemplateGallery templates={TEMPLATES.slice(0, 4)} />
      </section>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
