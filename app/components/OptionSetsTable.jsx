export function StatusBadge({ status }) {
  return status === "ACTIVE" ? (
    <s-badge tone="success">Active</s-badge>
  ) : (
    <s-badge>Draft</s-badge>
  );
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "Metal type, Engraving + 2 more": what the set asks, at a glance.
function fieldPreview(names) {
  if (!names.length) return "No fields yet";
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} + ${names.length - 2} more` : shown;
}

export function OptionSetsTable({ sets, filters }) {
  return (
    <s-table>
      {filters}
      <s-table-header-row>
        <s-table-header listSlot="primary">Name</s-table-header>
        <s-table-header listSlot="inline">Status</s-table-header>
        <s-table-header listSlot="labeled" format="numeric">
          Fields
        </s-table-header>
        <s-table-header listSlot="labeled" format="numeric">
          Products
        </s-table-header>
        <s-table-header listSlot="secondary">Last updated</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {sets.map((set) => (
          <s-table-row key={set.id} clickDelegate={`set-${set.id}`}>
            <s-table-cell>
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-link id={`set-${set.id}`} href={`/app/option-sets/${set.id}`}>
                    {set.name}
                  </s-link>
                  {set.priced && (
                    <s-badge icon="money" tone="info">
                      Paid options
                    </s-badge>
                  )}
                </s-stack>
                <s-text color="subdued">{fieldPreview(set.fieldNames)}</s-text>
              </s-stack>
            </s-table-cell>
            <s-table-cell>
              <StatusBadge status={set.status} />
            </s-table-cell>
            <s-table-cell>{set.fieldCount}</s-table-cell>
            <s-table-cell>
              {set.productCount ? (
                set.productCount
              ) : (
                <s-badge tone="warning">None</s-badge>
              )}
            </s-table-cell>
            <s-table-cell>{set.updatedAt}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}
