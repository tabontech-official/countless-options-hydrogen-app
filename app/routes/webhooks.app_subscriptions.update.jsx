import { authenticate } from "../shopify.server";
import { forgetPlan, getPlan } from "../billing.server";
import { applyAllSets, enforceFreeDowngrade } from "../options.server";
import { PLAN_FREE, PLAN_PRO } from "../options";

/**
 * Webhook handler for app_subscriptions/update.
 * NOTE: As of April 28, 2026, Shopify App Pricing officially stopped emitting APP_SUBSCRIPTIONS_UPDATE webhooks.
 * Subscription reconciliation is now primarily driven by Partner API activeSubscription queries and scheduled cron jobs.
 * This handler is maintained for legacy backwards-compatibility, receiving any lingering events idempotently.
 */
export const action = async ({ request }) => {
  const { shop, admin, topic, payload } = await authenticate.webhook(request);
  if (!admin) return new Response(); // store uninstalled

  console.log(`[BILLING_WEBHOOK] Received ${topic} for ${shop}`, {
    status: payload?.app_subscription?.status,
    name: payload?.app_subscription?.name,
  });

  try {
    // Drop cache and reconcile authoritative state from Shopify
    forgetPlan(shop);
    const plan = await getPlan(admin, shop, { maxAge: 0 });

    console.log(`[BILLING_WEBHOOK] ${shop}: reconciled plan:`, {
      selectedPlan: plan.selectedPlan,
      effectivePlan: plan.effectivePlan,
      status: plan.billingStatus,
      isDowngrading: plan.isDowngrading,
      paidThrough: plan.currentPeriodEnd,
    });

    if (plan.effectivePlan === PLAN_PRO) {
      // Pro active: restore options for all configured products idempotently
      await applyAllSets(admin, shop);
    } else if (plan.effectivePlan === PLAN_FREE) {
      // Free active: enforce 100-product entitlement deterministically
      await enforceFreeDowngrade(admin, shop);
    }
  } catch (error) {
    console.error(`[BILLING_WEBHOOK] ${shop}: reconciliation failed:`, error?.message ?? error);
    // Rethrow to let Shopify retry if transient
    throw error;
  }

  return new Response(null, { status: 200 });
};
