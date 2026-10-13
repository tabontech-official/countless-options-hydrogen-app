import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { forgetPlan, getPlan, productsWithOptions } from "../billing.server";
import { FREE_PRODUCT_LIMIT, UNLIMITED_PLAN, UNLIMITED_PRICE } from "../options";
import { PlanCard } from "../components/PlanCard";

// "Plans" in the nav: the shop's plan and usage, and the only place to change it. Free is every
// store's default. Upgrading requests the Unlimited subscription (Billing API): Shopify shows the
// merchant its approval page, then sends them back to the dashboard (returnUrl), which gives every
// product its options. Switching to Free cancels the subscription right here.
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const [plan, used] = await Promise.all([
    getPlan(admin, session.shop, { maxAge: 0 }).catch(() => null), // always the plan as it is now
    productsWithOptions(session.shop).then((ids) => ids.length),
  ]);
  // null when Shopify couldn't say: the page shows both plans without claiming either.
  return { current: plan ? (plan.unlimited ? "Unlimited" : "Free") : null, used };
};

export const action = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const { shop } = session;
  const { intent } = await request.json();
  let plan;
  try {
    plan = await getPlan(admin, shop, { maxAge: 0 });
  } catch {
    return { error: "We couldn’t reach Shopify. Try again in a minute." };
  }

  if (intent === "upgrade") {
    if (plan.unlimited) return { toast: "You’re already on Unlimited" };
    const res = await admin.graphql(
      `#graphql
      query AppHandle { currentAppInstallation { app { handle } } }`,
    );
    const { handle } = (await res.json()).data.currentAppInstallation.app;
    forgetPlan(shop); // read it again once they're back
    // Throws: sends the merchant to Shopify's approval page (outside the app's frame). Development
    // stores get a test charge, so they're never billed. Shopify adds charge_id when they come back.
    await billing.request({
      plan: UNLIMITED_PLAN,
      isTest: plan.devStore,
      returnUrl: `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/${handle}/app`,
    });
  }

  if (intent === "downgrade") {
    if (plan.subscriptionId) {
      // prorate: the merchant gets credit for the unused part of the month.
      await billing.cancel({ subscriptionId: plan.subscriptionId, isTest: plan.devStore, prorate: true });
      console.log(`[PLAN] ${shop}: moved to Free (subscription cancelled)`);
    }
    forgetPlan(shop);
    return { toast: "You’re on the Free plan now" };
  }
  return null;
};

const PLANS = [
  {
    name: "Free",
    price: "$0",
    features: [
      `Options on up to ${FREE_PRODUCT_LIMIT} products`,
      "Every answer type, conditions and paid add-ons",
      "Works with any Online Store 2.0 theme",
    ],
  },
  {
    name: "Unlimited",
    price: `$${UNLIMITED_PRICE}`,
    per: "/ month",
    features: ["Options on every product", "New products get options automatically", "Everything in Free"],
  },
];

export default function Plans() {
  const { current, used } = useLoaderData();
  const shopify = useAppBridge();
  const change = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const busy = change.state !== "idle" ? change.json?.intent : null;
  const post = (intent) => change.submit({ intent }, { method: "post", encType: "application/json" });

  useEffect(() => {
    if (change.data?.toast) shopify.toast.show(change.data.toast);
    if (change.data?.error) shopify.toast.show(change.data.error, { isError: true });
    if (change.data) setConfirming(false);
  }, [change.data, shopify]);

  return (
    <s-page heading="Plans" inlineSize="large">
      <div className="co-wrap co-animate">
        {current ? (
          <PlanCard unlimited={current === "Unlimited"} used={used} limit={FREE_PRODUCT_LIMIT} />
        ) : (
          <s-banner tone="warning" heading="We couldn’t check your plan right now">
            Reload the page in a minute. Your options keep working in the meantime.
          </s-banner>
        )}

        <div className="co-plans">
          {PLANS.map((p) => {
            const isCurrent = p.name === current;
            return (
              <section key={p.name} className={isCurrent ? "co-glass co-plantile co-plantile--current" : "co-glass co-plantile"}>
                <h3>
                  {p.name}
                  {isCurrent && <span className="co-plantile__tag">Current plan</span>}
                </h3>
                <p className="co-plantile__price">
                  {p.price}
                  {p.per && <small>{p.per}</small>}
                </p>
                <ul>
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {p.name === "Unlimited" && current === "Free" && (
                  <button type="button" className="co-btn co-btn--dark co-btn--small" disabled={Boolean(busy)} onClick={() => post("upgrade")}>
                    {busy === "upgrade" ? "Opening Shopify…" : "Upgrade to Unlimited"}
                  </button>
                )}
                {p.name === "Free" && current === "Unlimited" &&
                  (confirming ? (
                    <div className="co-plantile__confirm">
                      <span>Unlimited ends now, and you get credit for the rest of the month.</span>
                      <button type="button" className="co-btn co-btn--dark co-btn--small" disabled={Boolean(busy)} onClick={() => post("downgrade")}>
                        {busy === "downgrade" ? "Switching…" : "Switch to Free"}
                      </button>
                      <button type="button" className="co-btn co-btn--glass co-btn--small" disabled={Boolean(busy)} onClick={() => setConfirming(false)}>
                        Keep Unlimited
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="co-btn co-btn--glass co-btn--small" onClick={() => setConfirming(true)}>
                      Switch to Free
                    </button>
                  ))}
              </section>
            );
          })}
        </div>
        <p className="co-plans__note">
          Unlimited is billed by Shopify every 30 days on your Shopify bill. Switch back to Free anytime: products that
          already have options keep them.
        </p>
      </div>
    </s-page>
  );
}

// Carries the redirect to Shopify's approval page (an App Bridge header) when the upgrade is requested.
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
