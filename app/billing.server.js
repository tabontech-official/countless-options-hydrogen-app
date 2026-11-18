import prisma from "./db.server";
import { FREE_PRODUCT_LIMIT, PLAN_FREE, PLAN_PRO, PRO_PRICE } from "./options";

// Shopify App Pricing integration for Countless Options
// Plans:
//   Free: $0/month, up to 100 distinct assigned products across all active option sets.
//   Pro:  $10.99 per 30-day billing cycle, unlimited assigned products.
// Both plans share the same customization features; only product limit differs.

export { FREE_PRODUCT_LIMIT, PLAN_FREE, PLAN_PRO, PRO_PRICE };
export const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "infinite-option-2";
export const PLAN_CACHE_MS = 60 * 1000; // 1 minute in-memory cache per server instance

const plans = new Map(); // shop -> { plan, at }
const pending = new Map(); // shop -> promise in flight

export class PlanUnknownError extends Error {}

/**
 * Validates and formats an appId to a valid Shopify Global ID (GID).
 * e.g., "12345678" -> "gid://shopify/App/12345678"
 */
export function toAppGid(appId) {
  if (!appId) return null;
  const str = String(appId).trim();
  if (str.startsWith("gid://shopify/App/")) return str;
  const num = str.replace(/\D/g, "");
  return num ? `gid://shopify/App/${num}` : null;
}

/**
 * Validates and formats a shopId to a valid Shopify Global ID (GID).
 * e.g., "87654321" -> "gid://shopify/Shop/87654321"
 */
export function toShopGid(shopId) {
  if (!shopId) return null;
  const str = String(shopId).trim();
  if (str.startsWith("gid://shopify/Shop/")) return str;
  const num = str.replace(/\D/g, "");
  return num ? `gid://shopify/Shop/${num}` : null;
}

/**
 * Returns Shopify's hosted subscription selection and management URL.
 * Shopify App Pricing hosts plan selection and approval at this URL.
 */
export function getPricingPlansUrl() {
  // App Bridge resolves shopify://admin/... deep links and opens them in the top-level admin window.
  return `shopify://admin/charges/${APP_HANDLE}/pricing_plans`;
}

/**
 * Helper to determine if a subscription record from Shopify represents an active Pro tier.
 * Matches "Pro", "pro", legacy "Unlimited", or any recurring line item with price > 0.
 */
export function isProSubscription(sub) {
  if (!sub) return false;
  if (sub.status !== "ACTIVE") return false;
  // Test subscriptions are accepted: only development stores can approve test charges, and this app never
  // creates charges itself (Shopify's hosted pricing page does), so `test` can't be forged by a merchant.

  const name = String(sub.name || "").trim().toLowerCase();

  // Explicit free tier names configured in Shopify
  if (name === "free" || name === "explore" || name.includes("free")) {
    return false;
  }

  // Known paid plan names: "The Elevate", "Pro", "Unlimited"
  if (
    name.includes("elevate") ||
    name.includes("pro") ||
    name.includes("unlimited")
  ) {
    return true;
  }

  // Any non-free active plan with amount > 0
  const lineItems = sub.lineItems || [];
  for (const item of lineItems) {
    const amount = Number(item.plan?.pricingDetails?.price?.amount);
    if (Number.isFinite(amount) && amount > 0) return true;
  }

  // Any other active subscription that isn't named free/explore is a paid subscription
  return name.length > 0;
}

/**
 * Creates an AppSubscription for the paid Pro tier ("The Elevate") directly via Admin GraphQL
 * and returns the Shopify charge approval confirmation URL.
 */
export async function createUpgradeCharge(admin, session) {
  const shop = session.shop;
  const cleanShop = shop.replace(".myshopify.com", "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "infinite-option-2";
  const returnUrl = `https://admin.shopify.com/store/${cleanShop}/apps/${appHandle}/app?charge_id=approved`;
  const planName = process.env.SHOPIFY_BILLING_PLAN || "The Elevate";

  let isTest = true;
  try {
    const shopQuery = await admin.graphql(
      `#graphql
      query CheckDevShop {
        shop {
          plan {
            partnerDevelopment
          }
        }
      }`
    );
    const shopJson = await shopQuery.json();
    const partnerDev = shopJson?.data?.shop?.plan?.partnerDevelopment;
    isTest = Boolean(partnerDev) || process.env.NODE_ENV !== "production";
  } catch (err) {
    console.warn("[BILLING] Could not check partnerDevelopment, using test=true:", err?.message);
    isTest = true;
  }

  const response = await admin.graphql(
    `#graphql
    mutation AppSubscriptionCreate(
      $name: String!
      $returnUrl: URL!
      $test: Boolean
      $lineItems: [AppSubscriptionLineItemInput!]!
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        test: $test
        lineItems: $lineItems
      ) {
        appSubscription {
          id
          name
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: planName,
        returnUrl,
        test: isTest,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                interval: "EVERY_30_DAYS",
                price: {
                  amount: PRO_PRICE,
                  currencyCode: "USD",
                },
              },
            },
          },
        ],
      },
    }
  );

  const json = await response.json();
  const data = json?.data?.appSubscriptionCreate;
  if (data?.userErrors?.length) {
    const errMsg = data.userErrors.map((e) => e.message).join(", ");
    throw new Error(errMsg);
  }
  if (!data?.confirmationUrl) {
    throw new Error("No confirmationUrl returned by Shopify AppSubscriptionCreate");
  }

  return data.confirmationUrl;
}

/**
 * Cancels active Shopify app subscriptions for a store and returns it to the Free tier.
 * Runs completely in-app via Shopify GraphQL without forcing merchant to navigate out.
 */
export async function cancelSubscription(admin, shop) {
  const response = await admin.graphql(
    `#graphql
    query GetActiveSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          currentPeriodEnd
        }
      }
    }`
  );
  const json = await response.json();
  const subs = json?.data?.currentAppInstallation?.activeSubscriptions || [];

  let paidThroughDate = null;
  for (const sub of subs) {
    if (sub.status === "ACTIVE") {
      if (sub.currentPeriodEnd) {
        paidThroughDate = new Date(sub.currentPeriodEnd);
      }
      try {
        const cancelResponse = await admin.graphql(
          `#graphql
          mutation CancelSubscription($id: ID!) {
            appSubscriptionCancel(id: $id, prorate: true) {
              appSubscription {
                id
                status
                currentPeriodEnd
              }
              userErrors {
                field
                message
              }
            }
          }`,
          { variables: { id: sub.id } }
        );
        const cancelJson = await cancelResponse.json();
        const cancelledSub = cancelJson?.data?.appSubscriptionCancel?.appSubscription;
        if (cancelledSub?.currentPeriodEnd) {
          paidThroughDate = new Date(cancelledSub.currentPeriodEnd);
        }
      } catch (err) {
        console.error(`[BILLING] Failed to cancel sub ${sub.id}:`, err?.message);
      }
    }
  }

  const hasFuturePaidPeriod = paidThroughDate && paidThroughDate.getTime() > Date.now();

  try {
    await prisma.shopBilling.upsert({
      where: { shop },
      create: {
        shop,
        activePlan: "Free",
        effectivePlan: hasFuturePaidPeriod ? "Pro" : "Free",
        status: "CANCELLED",
        isPro: Boolean(hasFuturePaidPeriod),
        currentPeriodEnd: paidThroughDate,
        downgradeDate: paidThroughDate,
      },
      update: {
        activePlan: "Free",
        effectivePlan: hasFuturePaidPeriod ? "Pro" : "Free",
        status: "CANCELLED",
        isPro: Boolean(hasFuturePaidPeriod),
        currentPeriodEnd: paidThroughDate,
        downgradeDate: paidThroughDate,
      },
    });
  } catch (err) {
    console.warn(`[BILLING] Could not update ShopBilling for ${shop}:`, err?.message);
  }

  forgetPlan(shop);
}

/**
 * Queries the authoritative Shopify Partner API activeSubscription query.
 * Strictly adheres to the Shopify Partner API 2026-10 GraphQL schema.
 */
export async function queryPartnerActiveSubscription({
  partnerId = process.env.SHOPIFY_PARTNER_ID,
  partnerToken = process.env.SHOPIFY_PARTNER_TOKEN,
  appId = process.env.SHOPIFY_APP_ID || process.env.SHOPIFY_API_KEY,
  shopId,
  apiVersion = process.env.SHOPIFY_PARTNER_API_VERSION || "2026-10",
  fetchImpl = fetch,
} = {}) {
  if (!partnerId || !partnerToken || !appId || !shopId) {
    return null;
  }

  const cleanPartnerId = String(partnerId).replace(/^gid:\/\/shopify\/(?:Partner|Organization)\//i, "").trim();
  const formattedAppId = toAppGid(appId);
  const formattedShopId = toShopGid(shopId);

  if (!formattedAppId) {
    throw new Error(`Invalid appId for Partner API: "${appId}". Must be a numeric ID or gid://shopify/App/<id>`);
  }
  if (!formattedShopId) {
    throw new Error(`Invalid shopId for Partner API: "${shopId}". Must be a numeric ID or gid://shopify/Shop/<id>`);
  }

  const url = `https://partners.shopify.com/${cleanPartnerId}/api/${apiVersion}/graphql.json`;

  const query = `#graphql
    query PartnerActiveSubscription($appId: ID!, $shopId: ID!) {
      activeSubscription(appId: $appId, shopId: $shopId) {
        legacySubscriptionId
        billingPeriod
        cancelAtEndOfCycle
        trialEndsAt
        currentBillingCycle {
          startTime
          endTime
        }
        items {
          handle
          description
          price {
            __typename
            ... on FlatRatePrice {
              amount
              currency
            }
          }
        }
        pendingUpdate {
          billingPeriod
          legacySubscriptionId
          items {
            handle
            description
            price {
              __typename
              ... on FlatRatePrice {
                amount
                currency
              }
            }
          }
        }
        shop {
          id
          myshopifyDomain
          name
        }
        app {
          id
          name
        }
      }
    }
  `;

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": partnerToken,
    },
    body: JSON.stringify({
      query,
      variables: { appId: formattedAppId, shopId: formattedShopId },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Partner API HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  if (result.errors?.length) {
    const msg = result.errors.map((e) => e.message).join("; ");
    throw new Error(`Partner API GraphQL: ${msg}`);
  }

  if (!result || typeof result !== "object" || !("data" in result)) {
    throw new Error("Invalid response format received from Partner API");
  }

  return result.data?.activeSubscription ?? null;
}

/**
 * Evaluates subscription status from the Partner API ActiveSubscription object.
 * Authoritatively inspects items, currentBillingCycle.endTime, and pendingUpdate.
 */
export function evaluatePartnerSubscription(partnerSub, existingDbRecord = null, now = new Date()) {
  const isNowAfter = (dateStr) => Boolean(dateStr && new Date(dateStr).getTime() <= now.getTime());
  const isNowBefore = (dateStr) => Boolean(dateStr && new Date(dateStr).getTime() > now.getTime());

  let plan = PLAN_FREE;
  let effectivePlan = PLAN_FREE;
  let status = "ACTIVE";
  let subscriptionId = null;
  let currentPeriodEnd = null;
  let downgradeDate = null;
  let test = Boolean(existingDbRecord?.test);

  if (partnerSub) {
    subscriptionId = partnerSub.legacySubscriptionId || existingDbRecord?.subscriptionId || null;
    status = "ACTIVE";

    // Inspect active items to determine whether current plan is Pro
    const items = partnerSub.items || [];
    const isCurrentlyPro = items.some((item) => {
      const handle = String(item.handle || "").toLowerCase().trim();
      const amount = Number(item.price?.amount);
      if (handle === "free" || handle === "explore") return false;
      return (
        handle.includes("elevate") ||
        handle.includes("pro") ||
        handle.includes("unlimited") ||
        (Number.isFinite(amount) && amount > 0)
      );
    });

    // Check if there is a pending cancellation or downgrade
    const isCancelledAtEnd = Boolean(partnerSub.cancelAtEndOfCycle);
    const pendingItems = partnerSub.pendingUpdate?.items || [];
    const isPendingFree = Boolean(
      partnerSub.pendingUpdate &&
        (!pendingItems.length ||
          pendingItems.some((item) => {
            const h = String(item.handle || "").toLowerCase().trim();
            const amt = Number(item.price?.amount);
            return h === "free" || h === "explore" || h === "plan-free" || (!h.includes("pro") && !h.includes("elevate") && (!amt || amt === 0));
          })),
    );

    const cycleEndTime = partnerSub.currentBillingCycle?.endTime || partnerSub.trialEndsAt || existingDbRecord?.currentPeriodEnd || null;

    if (isCurrentlyPro) {
      if (isCancelledAtEnd || isPendingFree) {
        // Merchant scheduled downgrade to Free; paid period continues until cycleEndTime
        currentPeriodEnd = cycleEndTime;
        downgradeDate = cycleEndTime;

        if (cycleEndTime && isNowAfter(cycleEndTime)) {
          // Paid period has elapsed
          plan = "FREE";
          effectivePlan = "FREE";
          status = "CANCELLED";
          currentPeriodEnd = null;
          downgradeDate = null;
        } else {
          // Still within verified paid period
          plan = "FREE";
          effectivePlan = "PRO";
          status = isCancelledAtEnd ? "CANCELLED" : "ACTIVE";
        }
      } else {
        // Normal active Pro subscription
        plan = "PRO";
        effectivePlan = "PRO";
        status = "ACTIVE";
        currentPeriodEnd = cycleEndTime;
        downgradeDate = null;
      }
    } else {
      // Current item is Free
      plan = "FREE";
      if (existingDbRecord?.currentPeriodEnd && isNowBefore(existingDbRecord.currentPeriodEnd)) {
        effectivePlan = "PRO";
        status = "CANCELLED";
        currentPeriodEnd = existingDbRecord.currentPeriodEnd;
        downgradeDate = existingDbRecord.currentPeriodEnd;
      } else {
        effectivePlan = "FREE";
        status = "ACTIVE";
        currentPeriodEnd = null;
        downgradeDate = null;
      }
    }
  } else {
    // partnerSub is explicitly null (Shopify App Pricing returned no active contract)
    subscriptionId = existingDbRecord?.subscriptionId || null;
    if (existingDbRecord?.currentPeriodEnd && isNowBefore(existingDbRecord.currentPeriodEnd)) {
      plan = "FREE";
      effectivePlan = "PRO"; // Retain Pro entitlement until paid period end
      status = "CANCELLED";
      currentPeriodEnd = existingDbRecord.currentPeriodEnd;
      downgradeDate = existingDbRecord.currentPeriodEnd;
    } else {
      plan = "FREE";
      effectivePlan = "FREE";
      status = "ACTIVE";
      currentPeriodEnd = null;
      downgradeDate = null;
    }
  }

  const isDowngrading = plan === "FREE" && effectivePlan === "PRO";
  return {
    plan,
    effectivePlan,
    status,
    subscriptionId,
    currentPeriodEnd: currentPeriodEnd ? (currentPeriodEnd instanceof Date ? currentPeriodEnd : new Date(currentPeriodEnd)) : null,
    downgradeDate: downgradeDate ? (downgradeDate instanceof Date ? downgradeDate : new Date(downgradeDate)) : null,
    test,
    isDowngrading,
  };
}

/**
 * Retrieves the shop's verified plan and entitlement status.
 * Distinguishes selected plan, billing status, effective entitlement, and paid-through date.
 */
export async function getPlan(admin, shop, { maxAge = PLAN_CACHE_MS } = {}) {
  const now = Date.now();
  const known = plans.get(shop);
  if (known && now - known.at < maxAge) {
    return checkPaidThroughDate(known.plan);
  }

  if (!pending.has(shop)) {
    const check = fetchAndReconcilePlan(admin, shop)
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
    const plan = await pending.get(shop);
    return checkPaidThroughDate(plan);
  } catch (error) {
    console.error(`[PLAN] ${shop}: couldn't check plan with Shopify:`, error?.message ?? error);

    // Fallback to database record if available
    try {
      const dbRecord = prisma?.shopBilling ? await prisma.shopBilling.findUnique({ where: { shop } }) : null;
      if (dbRecord) {
        const plan = formatPlanFromDb(dbRecord);
        if (known && maxAge > 0) return checkPaidThroughDate(known.plan);
        return checkPaidThroughDate(plan);
      }
    } catch (dbErr) {
      console.error(`[PLAN] ${shop}: database fallback check failed:`, dbErr?.message ?? dbErr);
    }

    if (known && maxAge > 0) return checkPaidThroughDate(known.plan);
    throw new PlanUnknownError(`Couldn't check the plan for ${shop}`);
  }
}

export const forgetPlan = (shop) => {
  plans.delete(shop);
  pending.delete(shop);
};

/**
 * Ensures effectivePlan dynamically reflects paid-through expiry even before database update.
 */
function checkPaidThroughDate(plan) {
  if (!plan) return plan;
  if (plan.effectivePlan === PLAN_PRO && plan.selectedPlan === PLAN_FREE && plan.currentPeriodEnd) {
    const expired = new Date(plan.currentPeriodEnd).getTime() <= Date.now();
    if (expired) {
      return {
        ...plan,
        effectivePlan: PLAN_FREE,
        unlimited: false,
        isPro: false,
        isDowngrading: false,
      };
    }
  }
  return plan;
}

function formatPlanFromDb(record, devStore = false) {
  const isPaidPeriodActive = record.currentPeriodEnd && new Date(record.currentPeriodEnd).getTime() > Date.now();
  const effectivePlan = record.plan === "PRO" || (record.effectivePlan === "PRO" && isPaidPeriodActive) ? PLAN_PRO : PLAN_FREE;
  const isDowngrading = record.plan === "FREE" && record.effectivePlan === "PRO" && isPaidPeriodActive;

  return {
    unlimited: effectivePlan === PLAN_PRO,
    isPro: effectivePlan === PLAN_PRO,
    selectedPlan: record.plan === "PRO" ? PLAN_PRO : PLAN_FREE,
    effectivePlan,
    billingStatus: record.status || "ACTIVE",
    subscriptionId: record.subscriptionId || null,
    currentPeriodEnd: record.currentPeriodEnd ? record.currentPeriodEnd.toISOString() : null,
    downgradeDate: record.downgradeDate ? record.downgradeDate.toISOString() : null,
    isDowngrading: Boolean(isDowngrading),
    devStore: Boolean(record.test || devStore),
    chosenProductIds: Array.isArray(record.chosenProductIds) ? record.chosenProductIds : [],
  };
}

/**
 * Core query and reconciliation against Shopify's authoritative subscription data.
 */
async function fetchAndReconcilePlan(admin, shop) {
  const res = await admin.graphql(
    `#graphql
    query PlanSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          currentPeriodEnd
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                  interval
                }
              }
            }
          }
        }
      }
      shop {
        id
        myshopifyDomain
        plan { partnerDevelopment }
      }
    }`,
  );

  const { data, errors } = await res.json();
  if (!data?.currentAppInstallation) {
    throw new Error(`no subscription info from Shopify: ${JSON.stringify(errors)}`);
  }

  const devStore = Boolean(data.shop?.plan?.partnerDevelopment);
  const activeSubs = data.currentAppInstallation.activeSubscriptions || [];
  // Non-sensitive diagnostics: what Shopify says this installation is subscribed to.
  console.log(
    `[PLAN] ${shop}: Shopify reports ${activeSubs.length} active subscription(s):`,
    JSON.stringify(
      activeSubs.map((s) => ({
        name: s.name,
        status: s.status,
        test: s.test,
        currentPeriodEnd: s.currentPeriodEnd,
        amounts: (s.lineItems || []).map((i) => i.plan?.pricingDetails?.price?.amount ?? null),
      })),
    ),
  );

  // Find active Pro subscription in Admin API data (used directly or as fallback)
  const activePro = activeSubs.find((s) => isProSubscription(s));

  // Fetch current database record to preserve currentPeriodEnd on cancellations/downgrades
  let existing = null;
  if (prisma?.shopBilling) {
    try {
      existing = await prisma.shopBilling.findUnique({ where: { shop } });
    } catch (e) {
      console.warn(`[PLAN] ${shop}: unable to read shopBilling:`, e.message);
    }
  }

  const now = new Date();
  let evaluated = null;

  // 1. Authoritative Shopify Partner API query (Official Shopify App Pricing recommendation)
  if (process.env.SHOPIFY_PARTNER_ID && process.env.SHOPIFY_PARTNER_TOKEN && data.shop?.id) {
    try {
      const partnerSub = await queryPartnerActiveSubscription({
        shopId: data.shop.id,
      });
      evaluated = evaluatePartnerSubscription(partnerSub, existing, now);
      console.log(`[PLAN] ${shop}: reconciled via Partner API activeSubscription`);
    } catch (partnerErr) {
      console.error(`[PLAN] ${shop}: Partner API query failed:`, partnerErr?.message);
      // Never silently fall back to Admin API or assume Free if Partner query fails;
      // re-throwing allows getPlan to rely on verified database records or fail safely.
      throw partnerErr;
    }
  }

  // 2. Admin GraphQL fallback (used when Partner API is unconfigured, offline, or in test environments)
  if (!evaluated) {
    let plan = PLAN_FREE;
    let status = "ACTIVE";
    let effectivePlan = PLAN_FREE;
    let subscriptionId = null;
    let currentPeriodEnd = null;
    let downgradeDate = null;
    let test = false;

    if (activePro) {
      // Pro is actively subscribed and verified
      plan = "PRO";
      status = activePro.status || "ACTIVE";
      effectivePlan = "PRO";
      subscriptionId = activePro.id;
      currentPeriodEnd = activePro.currentPeriodEnd ? new Date(activePro.currentPeriodEnd) : existing?.currentPeriodEnd || null;
      downgradeDate = null;
      test = Boolean(activePro.test);
    } else {
      // No active Pro subscription
      subscriptionId = existing?.subscriptionId || null;
      test = Boolean(existing?.test);

      // Check if store was previously on Pro and paid-through period has not expired yet
      if (existing?.currentPeriodEnd && new Date(existing.currentPeriodEnd).getTime() > now.getTime()) {
        plan = "FREE";
        status = "CANCELLED";
        effectivePlan = "PRO"; // Retain Pro entitlement until paid period end!
        currentPeriodEnd = existing.currentPeriodEnd;
        downgradeDate = existing.currentPeriodEnd;
      } else {
        plan = "FREE";
        status = "ACTIVE";
        effectivePlan = "FREE";
        currentPeriodEnd = null;
        downgradeDate = null;
      }
    }
    evaluated = { plan, effectivePlan, status, subscriptionId, currentPeriodEnd, downgradeDate, test };
  }

  const { plan, effectivePlan, status, subscriptionId, currentPeriodEnd, downgradeDate, test } = evaluated;

  // Persist reconciled state to database if model exists
  if (prisma?.shopBilling) {
    try {
      await prisma.shopBilling.upsert({
        where: { shop },
        create: {
          shop,
          plan,
          status,
          effectivePlan,
          subscriptionId,
          currentPeriodEnd,
          downgradeDate,
          test,
        },
        update: {
          plan,
          status,
          effectivePlan,
          subscriptionId,
          currentPeriodEnd,
          downgradeDate,
          test,
        },
      });
    } catch (dbErr) {
      console.error(`[PLAN] ${shop}: failed to upsert shopBilling:`, dbErr.message);
    }
  }

  const isDowngrading = plan === "FREE" && effectivePlan === "PRO";
  const result = {
    unlimited: effectivePlan === "PRO",
    isPro: effectivePlan === "PRO",
    selectedPlan: plan === "PRO" ? PLAN_PRO : PLAN_FREE,
    effectivePlan: effectivePlan === "PRO" ? PLAN_PRO : PLAN_FREE,
    billingStatus: status,
    subscriptionId,
    currentPeriodEnd: currentPeriodEnd ? currentPeriodEnd.toISOString() : null,
    downgradeDate: downgradeDate ? downgradeDate.toISOString() : null,
    isDowngrading,
    devStore,
    chosenProductIds: Array.isArray(existing?.chosenProductIds) ? existing.chosenProductIds : [],
  };

  console.log(
    `[PLAN] ${shop}: Selected=${result.selectedPlan}, Entitlement=${result.effectivePlan}, Status=${result.billingStatus}${result.isDowngrading ? ` (Paid-through: ${result.currentPeriodEnd})` : ""}`,
  );
  return result;
}

/**
 * How many products may have options: FREE_PRODUCT_LIMIT on Free, Infinity on Pro.
 */
export async function productLimit(admin, shop, options) {
  const plan = await getPlan(admin, shop, options);
  return plan.unlimited ? Infinity : FREE_PRODUCT_LIMIT;
}

/**
 * Checks whether an upgrade is currently pending in metafields.
 */
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

/**
 * Distinct product IDs assigned across all active option sets in the database.
 */
export async function configuredProducts(shop, { exceptSet } = {}) {
  const rows = await prisma.optionSetProduct.findMany({
    where: { optionSet: { shop, status: "ACTIVE", ...(exceptSet && { id: { not: exceptSet } }) } },
    distinct: ["productId"],
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}

/**
 * Distinct products that currently have options active on the storefront.
 * On Pro: all configured products.
 * On Free: the first 100 entitled products.
 */
export async function productsWithOptions(shop, { exceptSet } = {}) {
  return configuredProducts(shop, { exceptSet });
}

/**
 * Deterministically resolves which up-to-100 products remain active on Free plan:
 * 1. Prioritizes merchant's explicitly chosen product IDs (if any).
 * 2. Deterministic fallback: orders assigned products by OptionSet createdAt ASC, OptionSet id ASC, productId ASC.
 * Never random, never database-order-dependent.
 */
export async function getEntitledProductIds(shop, limit = FREE_PRODUCT_LIMIT) {
  const activeSets = await prisma.optionSet.findMany({
    where: { shop, status: "ACTIVE" },
    include: { products: { select: { productId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Maintain deterministic order from option sets
  const assignedOrder = [];
  const seen = new Set();
  for (const set of activeSets) {
    const sortedProducts = [...set.products].sort((a, b) => a.productId.localeCompare(b.productId));
    for (const p of sortedProducts) {
      if (!seen.has(p.productId)) {
        seen.add(p.productId);
        assignedOrder.push(p.productId);
      }
    }
  }

  if (assignedOrder.length <= limit) {
    return assignedOrder;
  }

  // Check merchant selection
  let chosen = [];
  if (prisma?.shopBilling) {
    const billing = await prisma.shopBilling.findUnique({ where: { shop } });
    if (billing?.chosenProductIds && Array.isArray(billing.chosenProductIds)) {
      chosen = billing.chosenProductIds.filter((id) => seen.has(id));
    }
  }

  const entitled = new Set(chosen.slice(0, limit));
  if (entitled.size < limit) {
    for (const id of assignedOrder) {
      if (!entitled.has(id)) {
        entitled.add(id);
        if (entitled.size >= limit) break;
      }
    }
  }

  return Array.from(entitled);
}

/**
 * Saves the merchant's explicit selection of products to keep active upon downgrade.
 */
export async function setChosenDowngradeProducts(shop, productIds) {
  const validIds = [...new Set(productIds)].slice(0, FREE_PRODUCT_LIMIT);
  if (prisma?.shopBilling) {
    await prisma.shopBilling.upsert({
      where: { shop },
      create: { shop, chosenProductIds: validIds },
      update: { chosenProductIds: validIds },
    });
  }
  return validIds;
}
