const number = new Intl.NumberFormat("en-US");

// The shop's plan: on Free, how much of the product allowance is used. `children`: an optional
// action (the dashboard links to the Plans page).
export function PlanCard({ unlimited, used, limit, children }) {
  const full = !unlimited && used >= limit;
  return (
    <section className="co-glass co-setup">
      <div className="co-blockhead">
        <h2 className="co-heading co-heading--small">
          {unlimited ? (
            <>
              Unlimited plan · <em>every product</em>
            </>
          ) : (
            <>
              Free plan · <em>{`${number.format(used)} of ${limit} products`}</em>
            </>
          )}
        </h2>
        {!unlimited && (
          <span className="co-progress">
            <span
              className={full ? "co-meter co-meter--full" : "co-meter"}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(used, limit)}
              aria-valuetext={`${number.format(used)} of ${limit} products`}
              aria-label="Products with options on the Free plan"
            >
              <span className="co-meter__fill" style={{ inlineSize: `${Math.min(used / limit, 1) * 100}%` }} />
            </span>
            <span className="co-mono">{`${number.format(used)} / ${limit}`}</span>
          </span>
        )}
      </div>
      <div className="co-plan">
        <p>
          {unlimited
            ? "Options can go on every product, including ones you add later."
            : full
              ? "You’ve reached the Free plan’s limit. New products won’t get options until you upgrade."
              : `Options show on up to ${limit} products for free. Unlimited puts them on every product.`}
        </p>
        {children}
      </div>
    </section>
  );
}
