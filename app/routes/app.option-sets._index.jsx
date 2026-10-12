import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
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
  const shopify = useAppBridge();

  // Delete from the list: the editor's own delete action (it takes the options off the
  // products first), sent from a fetcher so the page stays put.
  const [doomed, setDoomed] = useState(null);
  const remover = useFetcher();
  const deleting = remover.state !== "idle";
  const remove = () =>
    remover.submit({ intent: "delete" }, { method: "post", action: `/app/option-sets/${doomed.id}`, encType: "application/json" });
  // Once the delete and the list reload finish: close the card and say how it went.
  const wasDeleting = useRef(false);
  const stillThere = Boolean(doomed && sets.some((s) => s.id === doomed.id));
  useEffect(() => {
    if (deleting) {
      wasDeleting.current = true;
      return;
    }
    if (!wasDeleting.current) return;
    wasDeleting.current = false;
    document.getElementById("delete-set-modal")?.hideOverlay?.();
    shopify.toast.show(stillThere ? "Couldn't delete the option set. Try again." : "Option set deleted", { isError: stillThere });
  }, [deleting, stillThere, shopify]);

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
            deleteModal="delete-set-modal"
            onDelete={setDoomed}
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

      <s-modal id="delete-set-modal" heading="Delete option set?">
        <s-paragraph>
          {doomed &&
            `"${doomed.name}" will be removed from ${plural(doomed.productCount, "product")}. Customers won't see its questions anymore. This can't be undone.`}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={deleting ? "" : undefined}
          disabled={deleting}
          onClick={remove}
        >
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-set-modal" command="--hide" disabled={deleting}>
          Cancel
        </s-button>
      </s-modal>
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
