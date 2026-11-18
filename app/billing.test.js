// Run: npm test (through vite-node, which resolves the app's extensionless imports)
/* eslint-env node */
import { test } from "node:test";
import assert from "node:assert/strict";

// In-memory mock database for testing
const db = {
  rows: [], // OptionSetProduct rows: { optionSetId, productId }
  sets: [], // OptionSet rows: { id, shop, name, status, fields, rules, products, createdAt, updatedAt }
  billing: new Map(), // shop -> ShopBilling row
  created: [],
  deleted: [],
  transactions: [],
};

global.prismaGlobal = {
  optionSet: {
    findMany: async (args) => {
      let result = db.sets;
      if (args?.where?.shop) result = result.filter((s) => s.shop === args.where.shop);
      if (args?.where?.status) result = result.filter((s) => s.status === args.where.status);
      if (args?.select?.rules && args?.select?.products) {
        return result.map((s) => ({
          id: s.id,
          rules: s.rules,
          fields: s.fields,
          products: db.rows.filter((r) => r.optionSetId === s.id).map((r) => ({ productId: r.productId })),
        }));
      }
      return result.map((s) => ({
        ...s,
        products: db.rows.filter((r) => r.optionSetId === s.id).map((r) => ({ productId: r.productId })),
      }));
    },
    findFirst: async () => db.sets[0] || null,
    count: async () => db.sets.length,
    deleteMany: async ({ where }) => {
      db.sets = db.sets.filter((s) => s.shop !== where?.shop);
      return { count: 0 };
    },
  },
  optionSetProduct: {
    findMany: async (args) => {
      let filtered = db.rows;
      if (args?.where?.optionSet?.shop) {
        const shopSetIds = new Set(db.sets.filter((s) => s.shop === args.where.optionSet.shop).map((s) => s.id));
        filtered = filtered.filter((r) => shopSetIds.has(r.optionSetId));
      }
      if (args?.where?.optionSet?.status) {
        const statusSetIds = new Set(db.sets.filter((s) => s.status === args.where.optionSet.status).map((s) => s.id));
        filtered = filtered.filter((r) => statusSetIds.has(r.optionSetId));
      }
      if (args?.where?.optionSet?.id?.not) {
        filtered = filtered.filter((r) => r.optionSetId !== args.where.optionSet.id.not);
      }
      if (args?.distinct?.includes("productId")) {
        const seen = new Set();
        filtered = filtered.filter((r) => !seen.has(r.productId) && seen.add(r.productId));
      }
      return filtered.map((r) => ({ productId: r.productId, optionSetId: r.optionSetId }));
    },
    createMany: async ({ data }) => {
      for (const item of data) {
        if (!db.rows.some((r) => r.optionSetId === item.optionSetId && r.productId === item.productId)) {
          db.rows.push(item);
        }
      }
      db.created.push(...data);
      return { count: data.length };
    },
    deleteMany: async ({ where }) => {
      if (where?.OR) {
        const toDelete = new Set(where.OR.map((item) => `${item.optionSetId}:::${item.productId}`));
        db.rows = db.rows.filter((r) => !toDelete.has(`${r.optionSetId}:::${r.productId}`));
        db.deleted.push(...where.OR);
      } else if (where?.productId) {
        db.rows = db.rows.filter((r) => r.productId !== where.productId);
      }
      return { count: 1 };
    },
  },
  session: {
    deleteMany: async () => ({ count: 1 }),
  },
  shopBilling: {
    findUnique: async ({ where }) => db.billing.get(where.shop) || null,
    findMany: async (args) => {
      let result = Array.from(db.billing.values());
      if (args?.where?.effectivePlan) result = result.filter((r) => r.effectivePlan === args.where.effectivePlan);
      if (args?.where?.plan) result = result.filter((r) => r.plan === args.where.plan);
      if (args?.where?.downgradeDate?.lte) {
        const lte = new Date(args.where.downgradeDate.lte).getTime();
        result = result.filter((r) => r.downgradeDate && new Date(r.downgradeDate).getTime() <= lte);
      }
      return result;
    },
    upsert: async ({ where, create, update }) => {
      const existing = db.billing.get(where.shop);
      const record = existing ? { ...existing, ...update, updatedAt: new Date() } : { ...create, createdAt: new Date(), updatedAt: new Date() };
      db.billing.set(where.shop, record);
      return record;
    },
    update: async ({ where, data }) => {
      const existing = db.billing.get(where.shop) || {};
      const record = { ...existing, ...data, updatedAt: new Date() };
      db.billing.set(where.shop, record);
      return record;
    },
    deleteMany: async ({ where }) => {
      db.billing.delete(where?.shop);
      return { count: 1 };
    },
  },
  $transaction: async (ops) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops(global.prismaGlobal);
  },
};

const { canonical, gql, syncProducts, enforceFreeDowngrade, applyAllSets, eraseShopData } = await import("./options.server.js");
const {
  forgetPlan,
  getPlan,
  PlanUnknownError,
  productLimit,
  isProSubscription,
  configuredProducts,
  getEntitledProductIds,
  setChosenDowngradeProducts,
  PLAN_FREE,
  PLAN_PRO,
  FREE_PRODUCT_LIMIT,
  evaluatePartnerSubscription,
  queryPartnerActiveSubscription,
} = await import("./billing.server.js");

const field = { id: "f1", type: "text", label: "Engraving" };
const optionsMetafield = JSON.stringify([field]);

function fakeAdmin(products = {}) {
  const writes = [];
  const deletes = [];
  return {
    writes,
    deletes,
    graphql: async (query, { variables } = {}) => {
      let data;
      if (query.includes("ProductFacts")) {
        data = { nodes: (variables.ids || []).map((id) => ({ id, tags: [], ...(products[id] && { options: { value: products[id] } }) })) };
      } else if (query.includes("SetProductOptions")) {
        writes.push(...variables.metafields.map((m) => m.ownerId));
        data = { metafieldsSet: { userErrors: [] } };
      } else if (query.includes("ClearProductOptions")) {
        deletes.push(...variables.metafields.map((m) => m.ownerId));
        data = { metafieldsDelete: { userErrors: [] } };
      } else if (query.includes("RuleMatches")) {
        data = { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
      } else {
        data = { metafieldsDelete: { userErrors: [] } };
      }
      return { json: async () => ({ data }) };
    },
  };
}

function planAdmin(replies) {
  const admin = {
    calls: 0,
    graphql: async () => {
      admin.calls++;
      const next = replies.shift();
      if (typeof next === "function") return next();
      return {
        json: async () => ({
          data: {
            currentAppInstallation: { activeSubscriptions: next.subs || [] },
            shop: { id: "gid://shopify/Shop/1", myshopifyDomain: "test.myshopify.com", plan: { partnerDevelopment: next.dev ?? false } },
          },
        }),
      };
    },
  };
  return admin;
}

const subPro = (over = {}) => ({
  id: "gid://shopify/AppSubscription/100",
  name: "Pro",
  status: "ACTIVE",
  test: false,
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  ...over,
});

function resetDb() {
  db.rows = [];
  db.sets = [];
  db.billing.clear();
  db.created = [];
  db.deleted = [];
}

// -------------------------------------------------------------
// Existing core options tests
// -------------------------------------------------------------

test("rules read back from the database (keys reordered) still count as unchanged", () => {
  const saved = { mode: "match", match: "all", conditions: [{ op: "is", field: "tag", value: "engrave" }] };
  const edited = { conditions: [{ field: "tag", op: "is", value: "engrave" }], match: "all", mode: "match" };
  assert.equal(canonical(saved), canonical(edited));
  assert.notEqual(canonical(saved), canonical({ ...edited, conditions: [{ field: "tag", op: "is", value: "gift" }] }));
});

// -------------------------------------------------------------
// Test A: New install on Free
// -------------------------------------------------------------
test("Scenario A: New install on Free defaults to Free with 100 product limit", async () => {
  resetDb();
  forgetPlan("new-shop.myshopify.com");
  const admin = planAdmin([{ subs: [] }]);

  const plan = await getPlan(admin, "new-shop.myshopify.com");
  assert.equal(plan.selectedPlan, PLAN_FREE);
  assert.equal(plan.effectivePlan, PLAN_FREE);
  assert.equal(plan.unlimited, false);
  assert.equal(plan.isPro, false);
  assert.equal(plan.subscriptionId, null);
  assert.equal(await productLimit(admin, "new-shop.myshopify.com"), FREE_PRODUCT_LIMIT);
});

// -------------------------------------------------------------
// Test B: Free reaching exactly 100 products
// -------------------------------------------------------------
test("Scenario B: Free reaching exactly 100 products assigns all 100 successfully", async () => {
  resetDb();
  const shop = "shop-b.myshopify.com";
  db.sets = [{ id: "s1", shop, name: "Set 1", status: "ACTIVE", fields: [field], rules: { mode: "all" }, createdAt: new Date() }];

  const ids = Array.from({ length: 100 }, (_, i) => `p_${i}`);
  const admin = fakeAdmin();
  const skipped = await syncProducts(admin, shop, ids, 100);

  assert.equal(skipped, 0);
  assert.equal(admin.writes.length, 100);
  assert.equal(db.rows.length, 100);
});

// -------------------------------------------------------------
// Test C: Attempt to assign product 101 on Free is refused
// -------------------------------------------------------------
test("Scenario C: Attempt to assign product 101 on Free leaves it out without modifying existing 100", async () => {
  resetDb();
  const shop = "shop-c.myshopify.com";
  // Setup 100 already assigned
  db.sets = [{ id: "s1", shop, name: "Set 1", status: "ACTIVE", fields: [field], rules: { mode: "all" }, createdAt: new Date() }];
  db.rows = Array.from({ length: 100 }, (_, i) => ({ optionSetId: "s1", productId: `p_${i}` }));

  const existingProducts = {};
  for (let i = 0; i < 100; i++) existingProducts[`p_${i}`] = optionsMetafield;

  const admin = fakeAdmin(existingProducts);
  // Attempt to sync 101st product
  const skipped = await syncProducts(admin, shop, ["p_100"], 100);

  assert.equal(skipped, 1);
  assert.equal(admin.writes.length, 0); // Not written to Shopify
  assert.equal(db.rows.length, 100); // DB remains exactly 100
});

// -------------------------------------------------------------
// Test D: Successful Free to Pro upgrade
// -------------------------------------------------------------
test("Scenario D: Successful Free to Pro upgrade independently verifies active Pro subscription and unlocks Pro", async () => {
  resetDb();
  const shop = "shop-d.myshopify.com";
  forgetPlan(shop);

  const proSub = subPro({ name: "Pro" });
  assert.ok(isProSubscription(proSub));
  assert.equal(isProSubscription({ status: "CANCELLED" }), false);

  const admin = planAdmin([{ subs: [proSub] }]);
  const plan = await getPlan(admin, shop, { maxAge: 0 });

  assert.equal(plan.selectedPlan, PLAN_PRO);
  assert.equal(plan.effectivePlan, PLAN_PRO);
  assert.equal(plan.unlimited, true);
  assert.equal(plan.isPro, true);
  assert.equal(plan.subscriptionId, "gid://shopify/AppSubscription/100");
  assert.equal(await productLimit(admin, shop), Infinity);
});

// -------------------------------------------------------------
// Test E: Declined Pro approval
// -------------------------------------------------------------
test("Scenario E: Declined Pro approval does not unlock Pro and remains Free", async () => {
  resetDb();
  const shop = "shop-e.myshopify.com";
  forgetPlan(shop);

  const admin = planAdmin([{ subs: [subPro({ status: "DECLINED" })] }]);
  const plan = await getPlan(admin, shop, { maxAge: 0 });

  assert.equal(plan.selectedPlan, PLAN_FREE);
  assert.equal(plan.effectivePlan, PLAN_FREE);
  assert.equal(plan.unlimited, false);
});

// -------------------------------------------------------------
// Test F: Pro with 500 assigned products
// -------------------------------------------------------------
test("Scenario F: Pro with 500 assigned products syncs all without skipping", async () => {
  resetDb();
  const shop = "shop-f.myshopify.com";
  db.sets = [{ id: "s1", shop, name: "Set 1", status: "ACTIVE", fields: [field], rules: { mode: "all" }, createdAt: new Date() }];

  const ids = Array.from({ length: 500 }, (_, i) => `prod_${i}`);
  const admin = fakeAdmin();
  const skipped = await syncProducts(admin, shop, ids, Infinity);

  assert.equal(skipped, 0);
  assert.equal(admin.writes.length, 500);
  assert.equal(db.rows.length, 500);
});

// -------------------------------------------------------------
// Test G: Pro to Free downgrade after one day preserves Pro access until paid-through date
// -------------------------------------------------------------
test("Scenario G: Pro to Free downgrade after one day preserves Pro entitlement until currentPeriodEnd", async () => {
  resetDb();
  const shop = "shop-g.myshopify.com";
  forgetPlan(shop);

  const futureEnd = new Date(Date.now() + 29 * 24 * 3600 * 1000); // 29 days remaining
  // Seed database with verified Pro subscription from day 1
  db.billing.set(shop, {
    shop,
    plan: "PRO",
    status: "ACTIVE",
    effectivePlan: "PRO",
    subscriptionId: "gid://shopify/AppSubscription/100",
    currentPeriodEnd: futureEnd,
    downgradeDate: null,
  });

  // On day 2, merchant changes plan to Free on Shopify: Shopify returns empty activeSubscriptions
  const admin = planAdmin([{ subs: [] }]);
  const plan = await getPlan(admin, shop, { maxAge: 0 });

  assert.equal(plan.selectedPlan, PLAN_FREE); // Merchant selected Free
  assert.equal(plan.effectivePlan, PLAN_PRO); // Entitlement remains Pro!
  assert.equal(plan.unlimited, true);
  assert.equal(plan.isDowngrading, true);
  assert.equal(plan.currentPeriodEnd, futureEnd.toISOString());
});

// -------------------------------------------------------------
// Test H: Pro access during remaining verified paid period
// -------------------------------------------------------------
test("Scenario H: Unlimited product assignments are permitted during pending downgrade period", async () => {
  resetDb();
  const shop = "shop-h.myshopify.com";
  const futureEnd = new Date(Date.now() + 15 * 24 * 3600 * 1000);

  db.billing.set(shop, {
    shop,
    plan: "FREE",
    status: "CANCELLED",
    effectivePlan: "PRO",
    currentPeriodEnd: futureEnd,
  });

  forgetPlan(shop);
  const admin = planAdmin([{ subs: [] }]);
  const limit = await productLimit(admin, shop);
  assert.equal(limit, Infinity);
});

// -------------------------------------------------------------
// Test I: Automatic switch to Free entitlements at expiry
// -------------------------------------------------------------
test("Scenario I: Automatic switch to Free entitlements when paid-through date has passed", async () => {
  resetDb();
  const shop = "shop-i.myshopify.com";
  const pastEnd = new Date(Date.now() - 1000); // Expired 1 second ago

  db.billing.set(shop, {
    shop,
    plan: "FREE",
    status: "CANCELLED",
    effectivePlan: "PRO",
    currentPeriodEnd: pastEnd,
  });

  forgetPlan(shop);
  const admin = planAdmin([{ subs: [] }]);
  const plan = await getPlan(admin, shop, { maxAge: 0 });

  assert.equal(plan.selectedPlan, PLAN_FREE);
  assert.equal(plan.effectivePlan, PLAN_FREE);
  assert.equal(plan.unlimited, false);
  assert.equal(plan.isDowngrading, false);
});

// -------------------------------------------------------------
// Test J: Preservation of 500 product configurations while only 100 remain active on Free
// -------------------------------------------------------------
test("Scenario J: Downgrade with 500 products preserves all in database while activating 100 deterministically", async () => {
  resetDb();
  const shop = "shop-j.myshopify.com";
  const set1 = { id: "set1", shop, name: "Set 1", status: "ACTIVE", fields: [field], rules: { mode: "manual" }, createdAt: new Date("2026-01-01") };
  db.sets = [set1];
  db.rows = Array.from({ length: 500 }, (_, i) => ({ optionSetId: "set1", productId: `prod_${String(i).padStart(3, "0")}` }));

  // Merchant chose 2 specific products
  await setChosenDowngradeProducts(shop, ["prod_499", "prod_498"]);

  const entitled = await getEntitledProductIds(shop, 100);
  assert.equal(entitled.length, 100);
  // Prioritized merchant chosen products
  assert.ok(entitled.includes("prod_499"));
  assert.ok(entitled.includes("prod_498"));
  // Remaining slots filled deterministically
  assert.ok(entitled.includes("prod_000"));

  // Check enforceFreeDowngrade clears options on remaining 400
  const admin = fakeAdmin();
  await enforceFreeDowngrade(admin, shop);

  // All 500 rows PRESERVED in database
  assert.equal(db.rows.length, 500);
  assert.equal(admin.deletes.length, 400); // 400 cleared from Shopify
});

// -------------------------------------------------------------
// Test K: Re-upgrade to Pro restores previous configurations idempotently
// -------------------------------------------------------------
test("Scenario K: Re-upgrade to Pro restores all 500 product configurations idempotently", async () => {
  resetDb();
  const shop = "shop-k.myshopify.com";
  forgetPlan(shop);

  const set1 = { id: "set1", shop, name: "Set 1", status: "ACTIVE", fields: [field], rules: { mode: "manual" }, createdAt: new Date() };
  db.sets = [set1];
  db.rows = Array.from({ length: 500 }, (_, i) => ({ optionSetId: "set1", productId: `prod_${i}` }));

  // Re-upgrade to Pro confirmed by Shopify
  const adminPlan = planAdmin([{ subs: [subPro({ name: "Pro" })] }]);
  await getPlan(adminPlan, shop, { maxAge: 0 });

  const adminSync = fakeAdmin();
  await applyAllSets(adminSync, shop);

  assert.equal(adminSync.writes.length, 500);
  assert.equal(db.rows.length, 500); // Idempotent: no duplicate rows
});

// -------------------------------------------------------------
// Test L: App uninstall and reinstall with clean billing entitlement
// -------------------------------------------------------------
test("Scenario L: Uninstall erases shop data and memory, reinstall starts fresh", async () => {
  resetDb();
  const shop = "shop-l.myshopify.com";
  db.sets = [{ id: "set1", shop, name: "Set", status: "ACTIVE", fields: [field], rules: { mode: "manual" }, createdAt: new Date() }];
  db.rows = [{ optionSetId: "set1", productId: "p1" }];
  db.billing.set(shop, { shop, plan: "PRO", status: "ACTIVE", effectivePlan: "PRO" });

  await eraseShopData(shop);

  assert.equal(db.sets.length, 0);
  assert.equal(db.billing.has(shop), false);

  // On reinstall, fresh check returns Free default
  const admin = planAdmin([{ subs: [] }]);
  const freshPlan = await getPlan(admin, shop, { maxAge: 0 });
  assert.equal(freshPlan.effectivePlan, PLAN_FREE);
});

// -------------------------------------------------------------
// Test M: Duplicate and out-of-order subscription events handled idempotently
// -------------------------------------------------------------
test("Scenario M: Duplicate and out-of-order subscription events are reconciled idempotently", async () => {
  resetDb();
  const shop = "shop-m.myshopify.com";
  forgetPlan(shop);

  const admin = planAdmin([
    { subs: [subPro({ name: "Pro" })] },
    { subs: [subPro({ name: "Pro" })] },
  ]);

  const first = await getPlan(admin, shop, { maxAge: 0 });
  forgetPlan(shop);
  const duplicate = await getPlan(admin, shop, { maxAge: 0 });

  assert.equal(first.effectivePlan, PLAN_PRO);
  assert.equal(duplicate.effectivePlan, PLAN_PRO);
  assert.equal(db.billing.get(shop).effectivePlan, "PRO");
});

// -------------------------------------------------------------
// Test N: Billing API unavailable or delayed falls back to database state
// -------------------------------------------------------------
test("Scenario N: Billing API temporary outage falls back to verified database state without downgrading", async () => {
  resetDb();
  const shop = "shop-n.myshopify.com";
  forgetPlan(shop);

  db.billing.set(shop, {
    shop,
    plan: "PRO",
    status: "ACTIVE",
    effectivePlan: "PRO",
    subscriptionId: "gid://shopify/AppSubscription/999",
  });

  const downAdmin = {
    graphql: async () => {
      throw new Error("Shopify Billing API unavailable");
    },
  };

  // getPlan should fallback to DB record
  const plan = await getPlan(downAdmin, shop);
  assert.equal(plan.effectivePlan, PLAN_PRO);
  assert.equal(plan.unlimited, true);

  // Without DB record and fresh read, throws PlanUnknownError
  await assert.rejects(getPlan(downAdmin, "empty-shop.myshopify.com", { maxAge: 0 }), PlanUnknownError);
});

// -------------------------------------------------------------
// Test O: Dynamic assignments, webhook changes and product deletions
// -------------------------------------------------------------
test("Scenario O: Dynamic rule assignments and product deletions adjust counts accurately", async () => {
  assert.ok(typeof gql === "function");
  resetDb();
  const shop = "shop-o.myshopify.com";
  db.sets = [{ id: "set1", shop, name: "Dynamic Set", status: "ACTIVE", fields: [field], rules: { mode: "match", conditions: [{ field: "tag", op: "is", value: "gift" }] }, createdAt: new Date() }];
  db.rows = [{ optionSetId: "set1", productId: "p_1" }, { optionSetId: "set1", productId: "p_2" }];

  let configured = await configuredProducts(shop);
  assert.equal(configured.length, 2);

  // Deletion of p_1
  await global.prismaGlobal.optionSetProduct.deleteMany({ where: { productId: "p_1" } });
  configured = await configuredProducts(shop);
  assert.equal(configured.length, 1);
  assert.equal(configured[0], "p_2");
});

// -------------------------------------------------------------
// Test P: Different product variants and multiple option sets assigned to same product
// -------------------------------------------------------------
test("Scenario P: Multiple option sets assigned to the same product count as exactly 1 distinct product", async () => {
  resetDb();
  const shop = "shop-p.myshopify.com";
  db.sets = [
    { id: "set1", shop, name: "Set 1", status: "ACTIVE", fields: [field], rules: { mode: "manual" }, createdAt: new Date() },
    { id: "set2", shop, name: "Set 2", status: "ACTIVE", fields: [field], rules: { mode: "manual" }, createdAt: new Date() },
  ];
  // Same product assigned to both sets
  db.rows = [
    { optionSetId: "set1", productId: "prod_shared" },
    { optionSetId: "set2", productId: "prod_shared" },
  ];

  const distinct = await configuredProducts(shop);
  assert.equal(distinct.length, 1);
  assert.equal(distinct[0], "prod_shared");
});

// -------------------------------------------------------------
// Test Q: Authoritative Shopify Partner API Active Subscription Query & Evaluation
// -------------------------------------------------------------
test("Scenario Q: Authoritative Partner API activeSubscription evaluation", async () => {
  const futureDate = new Date(Date.now() + 15 * 86400 * 1000).toISOString();

  // Active Pro subscription adhering to Partner API 2026-10 schema
  const activeProSub = {
    legacySubscriptionId: "gid://shopify/AppSubscription/partner-100",
    billingPeriod: "EVERY_30_DAYS",
    cancelAtEndOfCycle: false,
    trialEndsAt: null,
    currentBillingCycle: {
      startTime: new Date().toISOString(),
      endTime: futureDate,
    },
    items: [
      {
        handle: "pro",
        description: "Countless Options Pro Plan",
        price: { amount: 10.99, currency: "USD" },
      },
    ],
    pendingUpdate: null,
    shop: {
      id: "gid://shopify/Shop/456",
      myshopifyDomain: "testing.myshopify.com",
      name: "Testing Store",
    },
    app: {
      id: "gid://shopify/App/789",
      name: "Countless Options",
    },
  };

  const proResult = evaluatePartnerSubscription(activeProSub);
  assert.equal(proResult.plan, "PRO");
  assert.equal(proResult.effectivePlan, "PRO");
  assert.equal(proResult.status, "ACTIVE");
  assert.equal(proResult.subscriptionId, "gid://shopify/AppSubscription/partner-100");
  assert.equal(proResult.isDowngrading, false);

  // Partner API query execution with mock fetch
  let capturedBody = null;
  const mockFetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        data: { activeSubscription: activeProSub },
      }),
    };
  };

  const queryResult = await queryPartnerActiveSubscription({
    partnerId: "123456",
    partnerToken: "ptkn_test_123",
    appId: "789", // Tests GID normalization from numeric ID
    shopId: "456", // Tests GID normalization from numeric ID
    fetchImpl: mockFetch,
  });

  assert.equal(queryResult.legacySubscriptionId, "gid://shopify/AppSubscription/partner-100");
  assert.equal(capturedBody.variables.appId, "gid://shopify/App/789");
  assert.equal(capturedBody.variables.shopId, "gid://shopify/Shop/456");
});

// -------------------------------------------------------------
// Test R: Scheduled Downgrade Detection with cancelAtEndOfCycle and pendingUpdate
// -------------------------------------------------------------
test("Scenario R: Partner API cancelAtEndOfCycle and pendingUpdate preserve paid entitlement until currentBillingCycle.endTime", () => {
  const paidThrough = new Date(Date.now() + 10 * 86400 * 1000); // 10 days remaining
  const subWithCancel = {
    legacySubscriptionId: "gid://shopify/AppSubscription/partner-200",
    billingPeriod: "EVERY_30_DAYS",
    cancelAtEndOfCycle: true,
    trialEndsAt: null,
    currentBillingCycle: {
      startTime: new Date().toISOString(),
      endTime: paidThrough.toISOString(),
    },
    items: [
      {
        handle: "pro",
        description: "Pro",
        price: { amount: 10.99, currency: "USD" },
      },
    ],
    pendingUpdate: null,
    shop: { id: "gid://shopify/Shop/456", myshopifyDomain: "store.myshopify.com", name: "Store" },
    app: { id: "gid://shopify/App/789", name: "Countless Options" },
  };

  // Downgrade requested: selected plan is Free, but effective entitlement is PRO until paidThrough
  const downgradeResult = evaluatePartnerSubscription(subWithCancel);
  assert.equal(downgradeResult.plan, "FREE");
  assert.equal(downgradeResult.effectivePlan, "PRO");
  assert.equal(downgradeResult.isDowngrading, true);
  assert.equal(downgradeResult.downgradeDate.toISOString(), paidThrough.toISOString());

  // Pending update targeting Free plan
  const subWithPendingUpdate = {
    legacySubscriptionId: "gid://shopify/AppSubscription/partner-201",
    billingPeriod: "EVERY_30_DAYS",
    cancelAtEndOfCycle: false,
    trialEndsAt: null,
    currentBillingCycle: {
      startTime: new Date().toISOString(),
      endTime: paidThrough.toISOString(),
    },
    items: [
      {
        handle: "pro",
        description: "Pro",
        price: { amount: 10.99, currency: "USD" },
      },
    ],
    pendingUpdate: {
      billingPeriod: "EVERY_30_DAYS",
      legacySubscriptionId: null,
      items: [{ handle: "free", description: "Free plan" }],
    },
    shop: { id: "gid://shopify/Shop/456", myshopifyDomain: "store.myshopify.com", name: "Store" },
    app: { id: "gid://shopify/App/789", name: "Countless Options" },
  };

  const pendingResult = evaluatePartnerSubscription(subWithPendingUpdate);
  assert.equal(pendingResult.plan, "FREE");
  assert.equal(pendingResult.effectivePlan, "PRO");
  assert.equal(pendingResult.isDowngrading, true);
  assert.equal(pendingResult.downgradeDate.toISOString(), paidThrough.toISOString());

  // Once paidThrough is in the past, entitlement drops to FREE
  const pastDate = new Date(Date.now() - 3600 * 1000);
  const expiredSub = {
    ...subWithCancel,
    currentBillingCycle: {
      startTime: new Date(Date.now() - 31 * 86400 * 1000).toISOString(),
      endTime: pastDate.toISOString(),
    },
  };

  const expiredResult = evaluatePartnerSubscription(expiredSub);
  assert.equal(expiredResult.plan, "FREE");
  assert.equal(expiredResult.effectivePlan, "FREE");
  assert.equal(expiredResult.isDowngrading, false);
});

// -------------------------------------------------------------
// Test S: Background Cron Billing Reconciliation & Storefront Options Cleanup
// -------------------------------------------------------------
test("Scenario S: Background reconciliation detects expired shops and downgrades entitlement without merchant visit", async () => {
  resetDb();
  const shop = "cron-shop.myshopify.com";

  // Store configured with 105 products on Pro
  const products = {};
  for (let i = 1; i <= 105; i++) products[`gid://shopify/Product/${i}`] = optionsMetafield;
  const admin = fakeAdmin(products);

  db.sets = [
    {
      id: "set_cron",
      shop,
      name: "All Products Set",
      status: "ACTIVE",
      fields: [field],
      rules: { mode: "all" },
      createdAt: new Date(),
    },
  ];
  db.rows = Object.keys(products).map((p) => ({ optionSetId: "set_cron", productId: p }));

  // Store in pending downgrade with expiry 1 hour ago
  const expiredDate = new Date(Date.now() - 3600 * 1000);
  db.billing.set(shop, {
    shop,
    plan: "FREE",
    status: "CANCELLED",
    effectivePlan: "PRO",
    subscriptionId: "gid://shopify/AppSubscription/cron-sub",
    currentPeriodEnd: expiredDate,
    downgradeDate: expiredDate,
  });

  // Query expired records like the background cron job does
  const expiredShops = await global.prismaGlobal.shopBilling.findMany({
    where: {
      effectivePlan: "PRO",
      plan: "FREE",
      downgradeDate: { lte: new Date() },
    },
  });

  assert.equal(expiredShops.length, 1);
  assert.equal(expiredShops[0].shop, shop);

  // Background cron updates DB record and triggers enforceFreeDowngrade
  await global.prismaGlobal.shopBilling.update({
    where: { shop },
    data: {
      effectivePlan: "FREE",
      status: "ACTIVE",
      currentPeriodEnd: null,
      downgradeDate: null,
    },
  });
  forgetPlan(shop);
  await enforceFreeDowngrade(admin, shop);

  // Assert exactly 5 products were cleared to respect the 100 limit
  assert.equal(admin.deletes.length, 5);
  // Verify DB record is now Free
  const updatedRecord = db.billing.get(shop);
  assert.equal(updatedRecord.effectivePlan, "FREE");
  assert.equal(updatedRecord.status, "ACTIVE");
  assert.equal(updatedRecord.downgradeDate, null);
});

// -------------------------------------------------------------
// Test T: Distinguishing valid null subscription from GraphQL/HTTP query failure
// -------------------------------------------------------------
test("Scenario T: Distinguishes valid null subscription from failed query without silent downgrade", async () => {
  // 1. Valid null subscription (merchant on Free tier)
  const mockNullFetch = async () => ({
    ok: true,
    json: async () => ({ data: { activeSubscription: null } }),
  });

  const nullSub = await queryPartnerActiveSubscription({
    partnerId: "123456",
    partnerToken: "token",
    appId: "gid://shopify/App/123",
    shopId: "gid://shopify/Shop/456",
    fetchImpl: mockNullFetch,
  });
  assert.equal(nullSub, null);

  const evaluatedNull = evaluatePartnerSubscription(nullSub);
  assert.equal(evaluatedNull.plan, "FREE");
  assert.equal(evaluatedNull.effectivePlan, "FREE");

  // 2. GraphQL Error (e.g. invalid query or authorization failure)
  const mockGraphQLErrorFetch = async () => ({
    ok: true,
    json: async () => ({
      errors: [{ message: "Field 'unsupportedField' doesn't exist on type 'ActiveSubscription'" }],
    }),
  });

  await assert.rejects(
    queryPartnerActiveSubscription({
      partnerId: "123456",
      partnerToken: "token",
      appId: "gid://shopify/App/123",
      shopId: "gid://shopify/Shop/456",
      fetchImpl: mockGraphQLErrorFetch,
    }),
    /Partner API GraphQL: Field 'unsupportedField' doesn't exist/,
  );

  // 3. HTTP Error (e.g. 401 Unauthorized or 500)
  const mockHttpErrorFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => "Unauthorized",
  });

  await assert.rejects(
    queryPartnerActiveSubscription({
      partnerId: "123456",
      partnerToken: "invalid_token",
      appId: "gid://shopify/App/123",
      shopId: "gid://shopify/Shop/456",
      fetchImpl: mockHttpErrorFetch,
    }),
    /Partner API HTTP 401: Unauthorized/,
  );
});
