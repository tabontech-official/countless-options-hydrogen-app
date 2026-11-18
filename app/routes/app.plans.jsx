import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  cancelSubscription,
  configuredProducts,
  forgetPlan,
  getEntitledProductIds,
  getPlan,
  setChosenDowngradeProducts,
} from "../billing.server";
import { enforceFreeDowngrade, getProducts } from "../options.server";
import { FREE_PRODUCT_LIMIT, PLAN_FREE, PLAN_PRO, PRO_PRICE } from "../options";
import { PlanCard, formatDate } from "../components/PlanCard";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [plan, allAssignedIds] = await Promise.all([
    getPlan(admin, shop, { maxAge: 0 }).catch(() => null),
    configuredProducts(shop),
  ]);

  const isOverLimit = allAssignedIds.length > FREE_PRODUCT_LIMIT;

  let assignedProductsList = [];
  let currentlyEntitled = [];
  if (isOverLimit) {
    [currentlyEntitled, assignedProductsList] = await Promise.all([
      getEntitledProductIds(shop, FREE_PRODUCT_LIMIT),
      getProducts(admin, allAssignedIds.slice(0, 250)),
    ]);
  }

  return {
    shop,
    plan,
    configuredCount: allAssignedIds.length,
    isOverLimit,
    assignedProductsList,
    entitledProductIds: currentlyEntitled,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;

  let body = {};
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await request.json();
  } else {
    const formData = await request.formData();
    body = Object.fromEntries(formData.entries());
  }

  const { intent } = body;

  if (intent === "downgrade_to_free") {
    try {
      await cancelSubscription(admin, shop);
      await enforceFreeDowngrade(admin, shop);
      return { toast: "Pro plan cancelled. Downgrade scheduled for end of billing cycle." };
    } catch (err) {
      console.error("[PLANS] Downgrade failed:", err);
      return { error: err?.message || "Failed to cancel Pro plan." };
    }
  }

  if (intent === "save_chosen_products") {
    const { productIds } = body;
    if (!Array.isArray(productIds)) {
      return { error: "Invalid product selection." };
    }
    const chosen = await setChosenDowngradeProducts(shop, productIds);
    forgetPlan(shop);
    const plan = await getPlan(admin, shop, { maxAge: 0 }).catch(() => null);
    if (plan && plan.effectivePlan === PLAN_FREE) {
      await enforceFreeDowngrade(admin, shop);
    }
    return { toast: `Saved ${chosen.length} active products for Free plan.` };
  }

  return null;
};

const PLANS = [
  {
    name: PLAN_FREE,
    price: "$0",
    interval: "forever",
    features: [
      `Options on up to ${FREE_PRODUCT_LIMIT} distinct assigned products`,
      "Every answer type, conditions and paid add-ons",
      "Works with any Online Store 2.0 theme",
      "Saved configurations preserved on downgrade",
    ],
  },
  {
    name: PLAN_PRO,
    price: `$${PRO_PRICE}`,
    interval: "/ 30 days",
    features: [
      "Unlimited assigned products",
      "New products get options automatically",
      "All answer types, conditions and add-on transforms",
      "Priority feature access & instant restoration",
    ],
  },
];

export default function Plans() {
  const {
    plan,
    configuredCount,
    isOverLimit,
    assignedProductsList,
    entitledProductIds,
  } = useLoaderData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();

  const [selectedIds, setSelectedIds] = useState(new Set(entitledProductIds || []));
  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    if (fetcher.data?.toast) shopify.toast.show(fetcher.data.toast);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  const effectivePlan = plan?.effectivePlan || PLAN_FREE;
  const isPro = effectivePlan === PLAN_PRO;
  const isDowngrading = Boolean(plan?.isDowngrading);

  const toggleProduct = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= FREE_PRODUCT_LIMIT) {
          shopify.toast.show(`Maximum ${FREE_PRODUCT_LIMIT} products can be selected on Free plan.`, { isError: true });
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const saveSelection = () => {
    fetcher.submit(
      { intent: "save_chosen_products", productIds: Array.from(selectedIds) },
      { method: "post", encType: "application/json" }
    );
  };

  const filteredProducts = assignedProductsList.filter((p) =>
    p.title.toLowerCase().includes(filterText.toLowerCase())
  );

  const upgradeFetcher = useFetcher();
  const isUpgrading = upgradeFetcher.state !== "idle";

  const downgradeFetcher = useFetcher();
  const isDowngradingToFree = downgradeFetcher.state !== "idle";
  const wasDowngrading = useRef(false);

  const handleUpgrade = () => {
    upgradeFetcher.submit({}, { method: "POST", action: "/app/upgrade" });
  };

  const openDowngradeModal = () => {
    const modal = document.getElementById("downgrade-modal");
    if (modal?.showOverlay) {
      modal.showOverlay();
    } else if (modal?.show) {
      modal.show();
    }
  };

  const closeDowngradeModal = () => {
    const modal = document.getElementById("downgrade-modal");
    if (modal?.hideOverlay) {
      modal.hideOverlay();
    } else if (modal?.hide) {
      modal.hide();
    }
  };

  const confirmDowngrade = () => {
    downgradeFetcher.submit({ intent: "downgrade_to_free" }, { method: "POST" });
  };

  useEffect(() => {
    if (isDowngradingToFree) {
      wasDowngrading.current = true;
      return;
    }
    if (!wasDowngrading.current) return;
    wasDowngrading.current = false;
    closeDowngradeModal();
    if (downgradeFetcher.data?.toast) {
      shopify.toast.show(downgradeFetcher.data.toast);
    }
    if (downgradeFetcher.data?.error) {
      shopify.toast.show(downgradeFetcher.data.error, { isError: true });
    }
  }, [isDowngradingToFree, downgradeFetcher.data, shopify]);

  useEffect(() => {
    if (upgradeFetcher.data?.confirmationUrl) {
      if (window.top) {
        window.top.location.href = upgradeFetcher.data.confirmationUrl;
      } else {
        window.location.href = upgradeFetcher.data.confirmationUrl;
      }
    } else if (upgradeFetcher.data?.error) {
      shopify.toast.show(upgradeFetcher.data.error, { isError: true });
    }
  }, [upgradeFetcher.data, shopify]);

  return (
    <s-page heading="Plans & Subscriptions" inlineSize="large">
      <div className="co-wrap co-animate">
        {isDowngrading && (
          <s-banner tone="warning" heading="Downgrade scheduled">
            Your Pro features remain available until {formatDate(plan?.currentPeriodEnd || plan?.downgradeDate)}. After that, your store will use the Free plan with a 100-product limit.
          </s-banner>
        )}
        {plan ? (
          <PlanCard
            unlimited={isPro}
            used={configuredCount}
            limit={FREE_PRODUCT_LIMIT}
            selectedPlan={plan.selectedPlan}
            effectivePlan={plan.effectivePlan}
            isDowngrading={isDowngrading}
            currentPeriodEnd={plan.currentPeriodEnd}
            configuredCount={configuredCount}
          >
            {isDowngrading ? null : isPro ? (
              <button
                type="button"
                onClick={openDowngradeModal}
                disabled={isDowngradingToFree}
                className="co-btn co-btn--glass co-btn--small"
              >
                {isDowngradingToFree ? "Cancelling Pro plan..." : "Cancel Pro plan"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUpgrade}
                disabled={isUpgrading}
                className="co-btn co-btn--dark co-btn--small"
              >
                {isUpgrading ? "Redirecting to Shopify..." : "Upgrade to Pro"}
              </button>
            )}
          </PlanCard>
        ) : (
          <s-banner tone="warning" heading="We couldn’t check your plan right now">
            Reload the page in a minute. Your options keep working in the meantime.
          </s-banner>
        )}

        <div className="co-plans">
          {PLANS.map((p) => {
            const isCurrent = (p.name === PLAN_PRO && isPro) || (p.name === PLAN_FREE && !isPro);
            return (
              <section
                key={p.name}
                className={isCurrent ? "co-glass co-plantile co-plantile--current" : "co-glass co-plantile"}
              >
                <h3>
                  {p.name}
                  {isCurrent && <span className="co-plantile__tag">Current feature access</span>}
                </h3>
                <p className="co-plantile__price">
                  {p.price}
                  {p.interval && <small>{p.interval}</small>}
                </p>
                <ul>
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div style={{ marginTop: "16px" }}>
                  {p.name === PLAN_PRO && !isPro && (
                    <button
                      type="button"
                      onClick={handleUpgrade}
                      disabled={isUpgrading}
                      className="co-btn co-btn--dark co-btn--small"
                    >
                      {isUpgrading ? "Redirecting to Shopify..." : "Upgrade to Pro"}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {isOverLimit && (
          <section className="co-glass" style={{ padding: "20px", marginTop: "24px", borderRadius: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
                  Choose Active Products for Free Plan
                </h3>
                <p style={{ margin: "4px 0 0", color: "#666", fontSize: "14px" }}>
                  You have {configuredCount} products configured across active option sets. On Free, select up to {FREE_PRODUCT_LIMIT} products that remain enabled ({selectedIds.size} selected). The other {configuredCount - selectedIds.size} remain saved safely in your database.
                </p>
              </div>
              <button
                type="button"
                className="co-btn co-btn--dark co-btn--small"
                disabled={fetcher.state !== "idle"}
                onClick={saveSelection}
              >
                {fetcher.state !== "idle" ? "Saving…" : "Save active 100 products"}
              </button>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <input
                type="text"
                placeholder="Search assigned products…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                style={{
                  width: "100%",
                  maxWidth: "400px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                }}
              />
            </div>

            <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #e1e3e5", borderRadius: "8px", background: "#fff" }}>
              {filteredProducts.map((p) => {
                const checked = selectedIds.has(p.id);
                return (
                  <label
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 14px",
                      borderBottom: "1px solid #f1f2f3",
                      cursor: "pointer",
                      background: checked ? "#f4f6f8" : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProduct(p.id)}
                    />
                    {p.image && (
                      <img
                        src={p.image}
                        alt=""
                        style={{ width: "32px", height: "32px", objectFit: "cover", borderRadius: "4px" }}
                      />
                    )}
                    <span style={{ fontWeight: checked ? 600 : 400, flex: 1 }}>{p.title}</span>
                    <span style={{ fontSize: "12px", color: checked ? "#2c6ecb" : "#8c9196" }}>
                      {checked ? "Active on Free" : "Preserved in database"}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        )}

        <p className="co-plans__note" style={{ marginTop: "24px" }}>
          Countless Options subscriptions are billed through Shopify App Pricing every 30 days. You can upgrade, downgrade, or cancel anytime through Shopify. On downgrade, your Pro feature access remains fully active until the end of your verified paid billing period.
        </p>
      </div>

      <s-modal id="downgrade-modal" heading="Cancel Pro plan?">
        <s-paragraph>
          Are you sure you want to cancel your Pro plan?
        </s-paragraph>
        <s-paragraph>
          {`Your Pro features will remain active until the end of your billing cycle${
            plan?.currentPeriodEnd ? ` (${formatDate(plan.currentPeriodEnd)})` : ""
          }. After that, your store will use the Free plan with a 100-product limit. All your option sets and configurations are preserved.`}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={isDowngradingToFree ? "" : undefined}
          disabled={isDowngradingToFree}
          onClick={confirmDowngrade}
        >
          Cancel Pro plan
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor="downgrade-modal"
          command="--hide"
          disabled={isDowngradingToFree}
          onClick={closeDowngradeModal}
        >
          Keep Pro
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
