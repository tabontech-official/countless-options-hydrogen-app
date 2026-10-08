// The app's name and ∞ mark, as it sits at the top of the dashboard, landing and login pages.
export function Brand() {
  return (
    <span className="co-brand">
      <span className="co-brand__mark" aria-hidden="true">
        ∞
      </span>
      <span>
        <strong>Countless</strong>
        <small>Product Options</small>
      </span>
    </span>
  );
}
