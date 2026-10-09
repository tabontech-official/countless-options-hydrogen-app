import { Link } from "react-router";

// The dashboard's status pill: a green dot when live, amber in draft.
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
  if (!names.length) return "No fields yet";
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} + ${names.length - 2} more` : shown;
}

// A glass list with a classic header row; each row is one link, and on phones it stacks.
export function OptionSetsTable({ sets }) {
  return (
    <div className="co-glass co-sets">
      <div className="co-sets__head" aria-hidden="true">
        <span>Name</span>
        <span>Status</span>
        <span>Fields</span>
        <span>Products</span>
        <span>Updated</span>
        <span />
      </div>
      <ul>
        {sets.map((set) => (
          <li key={set.id}>
            <Link className="co-set" to={`/app/option-sets/${set.id}`}>
              <span className="co-set__main">
                <span className="co-set__name">
                  {set.name}
                  {set.priced && <span className="co-tag">Paid options</span>}
                </span>
                <span className="co-set__fields">{fieldPreview(set.fieldNames)}</span>
              </span>
              <StatusBadge status={set.status} />
              <span className="co-set__stat">{plural(set.fieldCount, "field")}</span>
              <span className={set.productCount ? "co-set__stat" : "co-set__stat co-up"}>
                {set.productCount ? plural(set.productCount, "product") : "No products"}
              </span>
              <span className="co-set__date">{set.updatedAt}</span>
              <span className="co-set__arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
