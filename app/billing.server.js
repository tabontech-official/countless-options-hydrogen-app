import prisma from "./db.server";
import { FREE_PRODUCT_LIMIT, UNLIMITED_PLAN } from "./options";

// Pricing runs on Shopify's Billing API (app subscriptions), checked with each store's own access:
//   Free (default)  options on up to FREE_PRODUCT_LIMIT products. Every store starts here; nothing
//                   to pick or approve.
//   Unlimited       UNLIMITED_PRICE USD every 30 days, options on every product. Only when the
//                   merchant picks it on the Plans page: the app requests the subscription
//                   (shopify.server.js `billing`) and Shopify asks the merchant to approve it.
//                   "Switch to Free" on the same page cancels it.
// How the limit works: an option set save that would add products past it is refused
// (app.option-sets.$id.jsx), and syncProducts doesn't give options to new products past it (rule
// matches arriving by webhook). Products that have options keep them, so moving down never strips
// a store. Back from approving Unlimited, the dashboard re-applies every set (applyAllSets).

export { FREE_PRODUCT_LIMIT };
export const PLAN_CACHE_MS = 5 * 60 * 1000;

// ponytail: per server instance (Vercel runs several). Places where a stale answer would hurt ask
// with a smaller maxAge: the Plans page, back from approving, before refusing or leaving products out.
const plans = new Map(); // shop -> { plan, at }: the last confirmed answer
const pending = new Map(); // shop -> the check in flight, so simultaneous callers share one request

export class PlanUnknownError extends Error {}

/**
 * The shop's plan, at most `maxAge` ms old. If Shopify can't answer, the last known plan is used;
 * with none, it throws PlanUnknownError and the caller decides (say so, refuse to add, retry later).
 * @returns {Promise<{ unlimited: boolean, subscriptionId: string | null, devStore: boolean }>}
 *   subscriptionId: the active Unlimited subscription (to cancel it); devStore: charges are tests there
 */
export async function getPlan(admin, shop, { maxAge = PLAN_CACHE_MS } = {}) {
  const known = plans.get(shop);
  if (known && Date.now() - known.at < maxAge) return known.plan;
  if (!pending.has(shop)) {
    // Only the newest check writes the cache: forgetPlan drops a check still in flight, so its older answer can't come back.
    const check = fetchPlan(admin, shop)
      .then((plan) => {
        if (pending.get(shop) === check) plans.set(shop, { plan, at: Date.now() });
        return plan;
      })
      .finally(() => {
        if (pending.get(shop) === check) pending.delete(shop);
      });
    pending.set(shop, check);
  }
  try {
    return await pending.get(shop);
  } catch (error) {
    console.error(`[PLAN] ${shop}: couldn't check the plan:`, error?.message ?? error);
    // A read that asked for a fresh answer (maxAge 0) never falls back to an old one, so a reinstalled
    // shop can't inherit a previous install's Unlimited from this instance's memory.
    if (known && maxAge > 0) return known.plan;
    throw new PlanUnknownError(`Couldn't check the plan for ${shop}`);
  }
}

export const forgetPlan = (shop) => {
  plans.delete(shop);
  pending.delete(shop); // the next read asks Shopify again; a check still in flight can't write its answer back
};

// An upgrade waiting for the merchant's approval, or approved but not applied yet. It's a metafield on the app
// installation, not a URL parameter: the trip through Shopify's approval page can drop parameters.
async function installation(admin) {
  const res = await admin.graphql(`#graphql
    query Installation { currentAppInstallation { id metafield(namespace: "$app", key: "plan_upgrade_pending") { value } } }`);
  return (await res.json()).data.currentAppInstallation;
}

export async function upgradePending(admin) {
  return Boolean((await installation(admin)).metafield);
}

export async function setUpgradePending(admin, on) {
  const { id } = await installation(admin);
  const metafield = { ownerId: id, namespace: "$app", key: "plan_upgrade_pending" };
  if (on) {
    const res = await admin.graphql(
      `#graphql
      mutation SetUpgradePending($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { message } }
      }`,
      { variables: { metafields: [{ ...metafield, type: "single_line_text_field", value: "1" }] } },
    );
    const [error] = (await res.json()).data.metafieldsSet.userErrors;
    if (error) throw new Error(error.message);
  } else {
    await admin.graphql(
      `#graphql
      mutation ClearUpgradePending($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { message } }
      }`,
      { variables: { metafields: [metafield] } },
    );
  }
}

/** How many products may have options: FREE_PRODUCT_LIMIT on Free, Infinity on Unlimited. */
export const productLimit = async (admin, shop, options) =>
  (await getPlan(admin, shop, options)).unlimited ? Infinity : FREE_PRODUCT_LIMIT;

async function fetchPlan(admin, shop) {
  const res = await admin.graphql(
    `#graphql
    query PlanSubscriptions {
      currentAppInstallation {
        activeSubscriptions { id name status test }
      }
      shop { plan { partnerDevelopment } }
    }`,
  );
  const { data, errors } = await res.json();
  if (!data?.currentAppInstallation) throw new Error(`no subscription info from Shopify: ${JSON.stringify(errors)}`);
  const devStore = Boolean(data.shop.plan.partnerDevelopment);
  // A test charge only counts on a development store: if one is handed over to a merchant and
  // becomes a paying store, it drops to Free instead of keeping Unlimited without paying.
  const subscription = data.currentAppInstallation.activeSubscriptions.find(
    (s) => s.name === UNLIMITED_PLAN && s.status === "ACTIVE" && (!s.test || devStore),
  );
  console.log(`[PLAN] ${shop}: ${subscription ? "Unlimited" : "Free"}${subscription?.test ? " (test charge)" : ""}`);
  return { unlimited: Boolean(subscription), subscriptionId: subscription?.id ?? null, devStore };
}

/**
 * Distinct products that have options now (hand-picked or recorded rule matches, ACTIVE sets only),
 * optionally leaving out one set's products.
 */
export async function productsWithOptions(shop, { exceptSet } = {}) {
  const rows = await prisma.optionSetProduct.findMany({
    where: { optionSet: { shop, status: "ACTIVE", ...(exceptSet && { id: { not: exceptSet } }) } },
    distinct: ["productId"],
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}
