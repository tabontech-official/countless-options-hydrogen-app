import { Link } from "react-router";

// The dashboard's status pill: a green dot when live, amber in draft (plain text inside the table).
export function StatusBadge({ status }) {
  return status === "ACTIVE" ? (
    <span className="co-state co-state--live">Active</span>
  ) : (
    <span className="co-state">Draft</span>
  );
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "Metal type, Engraving + 2 more": what the set asks, at a glance.
function fieldPreview(names) {
  if (!names.length) return "No questions yet";
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} + ${names.length - 2} more` : shown;
}

// A table number. Its unit is always read aloud, and shown on phones, where there's no header row.
function Count({ n, word }) {
  return (
    <span className={n ? "co-set__num" : "co-set__num is-zero"}>
      {n}
      <span className="co-set__unit">{` ${word}${n === 1 ? "" : "s"}`}</span>
    </span>
  );
}

// One glass card, laid out like a classic index table: filters on top, a header row, one link per row.
export function OptionSetsTable({ sets, toolbar }) {
  return (
    <div className="co-glass co-table">
      <div className="co-table__bar">{toolbar}</div>
      {sets.length ? (
        <>
          <div className="co-table__head" aria-hidden="true">
            <span>Name</span>
            <span>Status</span>
            <span>Questions</span>
            <span>Products</span>
            <span>Updated</span>
          </div>
          <ul className="co-table__rows">
            {sets.map((set) => (
              <li key={set.id}>
                <Link className="co-set" to={`/app/option-sets/${set.id}`}>
                  <span className="co-set__main">
                    <span className="co-set__name">{set.name}</span>
                    <span className="co-set__fields">{fieldPreview(set.fieldNames)}</span>
                  </span>
                  <StatusBadge status={set.status} />
                  <Count n={set.fieldCount} word="question" />
                  <Count n={set.productCount} word="product" />
                  <span className="co-set__date">{set.updatedAt}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="co-empty">
          <s-icon type="search" tone="neutral" />
          No option sets match. Try a different search or status.
        </div>
      )}
    </div>
  );
}
