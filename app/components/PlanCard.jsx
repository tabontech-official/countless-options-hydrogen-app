import { Link } from "react-router";

const number = new Intl.NumberFormat("en-US");

export function formatDate(isoString) {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

/**
 * PlanCard displays current plan, effective feature access, product limits, and downgrade notifications.
 */
export function PlanCard({
  unlimited,
  used,
  limit,
  selectedPlan,
  effectivePlan,
  isDowngrading,
  currentPeriodEnd,
  configuredCount,
  children,
}) {
  const isPro = Boolean(unlimited || effectivePlan === "Pro");
  const isDowngradingMode = Boolean(
    isDowngrading ||
    (selectedPlan === "Free" && effectivePlan === "Pro" && currentPeriodEnd)
  );
  const configured = configuredCount != null ? configuredCount : used;
  const activeCount = isPro ? configured : Math.min(configured, limit);
  const full = !isPro && activeCount >= limit;
  const overConfigured = configured > limit;
  const formattedPaidThrough = formatDate(currentPeriodEnd);

  return (
    <section className="co-glass co-setup">
      <div className="co-blockhead">
        <h2 className="co-heading co-heading--small">
          {isPro ? (
            <>
              Pro plan · <em>{configured > 0 ? `${number.format(configured)} products` : "unlimited products"}</em>
            </>
          ) : (
            <>
              Free plan · <em>{`${number.format(activeCount)} of ${limit} products`}</em>
            </>
          )}
        </h2>
        {!isPro && (
          <span className="co-progress">
            <span
              className={full ? "co-meter co-meter--full" : "co-meter"}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(activeCount, limit)}
              aria-valuetext={`${number.format(activeCount)} of ${limit} products`}
              aria-label="Products with options on the Free plan"
            >
              <span className="co-meter__fill" style={{ inlineSize: `${Math.min(activeCount / limit, 1) * 100}%` }} />
            </span>
            <span className="co-mono">{`${number.format(activeCount)} / ${limit}`}</span>
          </span>
        )}
      </div>

      <div className="co-plan">
        {isDowngradingMode ? (
          <div>
            <p>
              Your Pro features remain available until {formattedPaidThrough}. After that, your store will use the Free plan with a 100-product limit.
            </p>
            {overConfigured && (
              <p style={{ marginTop: "8px" }}>
                You have <strong>{number.format(configured)} configured products</strong>. Because the Free plan covers up to 100 products, you can select which 100 products stay active after expiry.
              </p>
            )}
          </div>
        ) : isPro ? (
          <p>
            Options can go on every product, including ones you add later. All {number.format(configured)} assigned products are active.
          </p>
        ) : (
          <div>
            <p>
              {overConfigured
                ? `You have ${number.format(configured)} products configured in your option sets. On the Free plan, options are enabled on ${limit} products; your other ${number.format(configured - limit)} product configurations are preserved.`
                : full
                  ? "You’ve reached the Free plan’s 100-product limit. New products won’t get options until you upgrade to Pro."
                  : `Options show on up to ${limit} products for free. Pro puts them on unlimited products.`}
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "12px" }}>
          {children}
          {overConfigured && (
            <Link to="/app/plans" className="co-btn co-btn--glass co-btn--small">
              Manage 100 active products
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
