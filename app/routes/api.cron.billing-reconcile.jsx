/* eslint-env node */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { enforceFreeDowngrade } from "../options.server";
import { forgetPlan } from "../billing.server";

/**
 * Background Cron Job: Reconciles expired paid-through subscription entitlements.
 * Runs on a schedule (e.g., via Vercel Cron) without requiring merchant dashboard visits.
 *
 * Scans ShopBilling records where effectivePlan is PRO, but plan is FREE and downgradeDate <= now().
 * For each expired shop, downgrades effectivePlan to FREE and removes options beyond the 100-product limit.
 */
export const loader = async ({ request }) => {
  return handleCron(request);
};

export const action = async ({ request }) => {
  return handleCron(request);
};

async function handleCron(request) {
  // Validate bearer token if CRON_SECRET is configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn("[CRON_RECONCILE] Unauthorized request rejected: invalid or missing Authorization header");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn("[CRON_RECONCILE] CRON_SECRET is not configured in production; rejecting request for safety");
    return new Response(JSON.stringify({ error: "Unauthorized: CRON_SECRET not configured" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  const now = new Date();
  console.log(`[CRON_RECONCILE] Running billing reconciliation at ${now.toISOString()}`);

  if (!prisma?.shopBilling) {
    return new Response(JSON.stringify({ message: "No database configured", count: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Find stores whose paid-through entitlement has expired (limit to 50 per execution to prevent serverless timeouts)
  const expiredShops = await prisma.shopBilling.findMany({
    where: {
      effectivePlan: "PRO",
      plan: "FREE",
      downgradeDate: {
        lte: now,
      },
    },
    take: 50,
  });

  console.log(`[CRON_RECONCILE] Found ${expiredShops.length} stores with expired paid-through dates`);

  const results = [];
  for (const record of expiredShops) {
    const shop = record.shop;
    try {
      // 1. Update database record to Free effectivePlan
      await prisma.shopBilling.update({
        where: { shop },
        data: {
          effectivePlan: "FREE",
          status: "ACTIVE",
          currentPeriodEnd: null,
          downgradeDate: null,
        },
      });

      // 2. Clear server memory cache
      forgetPlan(shop);

      // 3. Enforce 100-product Free entitlement on storefront if offline admin session exists
      try {
        if (typeof unauthenticated?.admin === "function") {
          const { admin } = await unauthenticated.admin(shop);
          if (admin) {
            await enforceFreeDowngrade(admin, shop);
          }
        }
      } catch (adminErr) {
        console.warn(`[CRON_RECONCILE] ${shop}: unable to enforce storefront metafields (offline session unavailable):`, adminErr?.message);
      }

      results.push({ shop, status: "downgraded_to_free" });
    } catch (err) {
      console.error(`[CRON_RECONCILE] ${shop}: error during downgrade enforcement:`, err);
      results.push({ shop, status: "error", error: err.message });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      timestamp: now.toISOString(),
      durationMs: Date.now() - startTime,
      reconciledCount: expiredShops.length,
      details: results,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
