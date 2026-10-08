import { useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listOptionSets } from "../options.server";
import { OptionSetsTable } from "../components/OptionSetsTable";
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

  // ponytail: filtered in the browser; every set is already loaded for the table.
  const needle = query.trim().toLowerCase();
  const shown = sets.filter(
    (s) =>
      (!status || s.status === status) &&
      (!needle || [s.name, ...s.fieldNames].some((text) => text.toLowerCase().includes(needle))),
  );

  return (
    <s-page heading="Option sets">
      <s-button slot="primary-action" variant="primary" href="/app/option-sets/new">
        Create option set
      </s-button>
      {sets.length ? (
        <s-section padding="none" accessibilityLabel="Option sets">
          <OptionSetsTable
            sets={shown}
            filters={
              <s-grid slot="filters" gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
                <s-search-field
                  label="Search option sets"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search by name or question"
                  value={query}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                />
                <s-select
                  label="Status"
                  labelAccessibilityVisibility="exclusive"
                  value={status}
                  onChange={(e) => setStatus(e.currentTarget.value)}
                >
                  {STATUSES.map((s) => (
                    <s-option key={s.value} value={s.value}>
                      {s.value ? s.label : "All statuses"}
                    </s-option>
                  ))}
                </s-select>
              </s-grid>
            }
          />
          {shown.length === 0 && (
            <s-box padding="large">
              <s-stack alignItems="center" gap="small-200">
                <s-icon type="search" tone="neutral" />
                <s-text type="strong">No option sets match</s-text>
                <s-text color="subdued">Try a different search or status.</s-text>
              </s-stack>
            </s-box>
          )}
        </s-section>
      ) : (
        <EmptyState />
      )}
    </s-page>
  );
}

function EmptyState() {
  return (
    <div className="co-stack">
      <s-section accessibilityLabel="No option sets yet">
        <s-grid gap="base" justifyItems="center" paddingBlock="large">
          <s-grid justifyItems="center" maxInlineSize="460px" gap="base">
            <s-stack alignItems="center" gap="small-200">
              <s-heading>Add custom options to your products</s-heading>
              <s-paragraph color="subdued">
                Collect engraving text, gift messages, color choices and more, without creating extra variants.
              </s-paragraph>
            </s-stack>
            <s-stack direction="inline" gap="small-200">
              <s-button variant="primary" href="/app/option-sets/new">
                Start from scratch
              </s-button>
              <s-button href="/app/templates">Browse all templates</s-button>
            </s-stack>
          </s-grid>
        </s-grid>
      </s-section>
      <TemplateGallery templates={TEMPLATES.slice(0, 3)} />
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
