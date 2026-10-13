// Run: npm test (through vite-node, which resolves the app's extensionless imports)
/* eslint-env node */
import { test } from "node:test";
import assert from "node:assert/strict";

// db.server.js uses global.prismaGlobal outside production, so a fake database goes in before any import.
const db = { rows: [], sets: [], created: [], deleted: [] };
global.prismaGlobal = {
  optionSet: { findMany: async () => db.sets },
  optionSetProduct: {
    findMany: async () => db.rows.map((productId) => ({ productId })),
    createMany: async ({ data }) => db.created.push(...data),
    deleteMany: async ({ where }) => db.deleted.push(...where.OR),
  },
};
const { canonical, syncProducts } = await import("./options.server.js");

test("rules read back from the database (keys reordered) still count as unchanged", () => {
  // Postgres JSONB returns object keys sorted by length, so a saved condition comes back as {op, field, value}.
  const saved = { mode: "match", match: "all", conditions: [{ op: "is", field: "tag", value: "engrave" }] };
  const edited = { conditions: [{ field: "tag", op: "is", value: "engrave" }], match: "all", mode: "match" };
  assert.equal(canonical(saved), canonical(edited));
  assert.notEqual(canonical(saved), canonical({ ...edited, conditions: [{ field: "tag", op: "is", value: "gift" }] }));
});

const field = { id: "f1", type: "text", label: "Engraving" };
const options = JSON.stringify([field]);

// A fake Admin API: products and their current options, recording every metafield write.
function fakeAdmin(products) {
  const writes = [];
  return {
    writes,
    graphql: async (query, { variables }) => {
      let data;
      if (query.includes("ProductFacts")) {
        data = { nodes: variables.ids.map((id) => ({ id, tags: [], ...(products[id] && { options: { value: products[id] } }) })) };
      } else if (query.includes("PlanSubscriptions")) {
        throw new Error("the plan was asked for"); // fails the sync, so tests see it
      } else if (query.includes("SetProductOptions")) {
        writes.push(...variables.metafields.map((m) => m.ownerId));
        data = { metafieldsSet: { userErrors: [] } };
      } else {
        data = { metafieldsDelete: { userErrors: [] } };
      }
      return { json: async () => ({ data }) };
    },
  };
}

function setup() {
  Object.assign(db, { created: [], deleted: [] });
  // One "All products" set that already recorded p1. p0 has options from another set, outside this sync.
  db.sets = [{ id: "s1", fields: [field], rules: { mode: "all" }, products: [{ productId: "p1" }] }];
  db.rows = ["p0", "p1"];
  return fakeAdmin({ p1: options });
}

test("Free plan: past the limit, new products don't get options; ones that have them keep them", async () => {
  const admin = setup();
  // Limit 3: p0 (outside) and p1 (keeps its options) use 2, so only one of p2, p3, p4 gets options.
  const skipped = await syncProducts(admin, "shop", ["p1", "p2", "p3", "p4"], 3);
  assert.equal(skipped, 2);
  assert.deepEqual(admin.writes, ["p2"]);
  assert.deepEqual(db.created, [{ optionSetId: "s1", productId: "p2" }]); // only what went live is recorded
});

test("Free plan at or past the limit: nothing new gets options, nothing is taken away", async () => {
  const admin = setup();
  const skipped = await syncProducts(admin, "shop", ["p1", "p2"], 1); // already 2 with options, limit 1
  assert.equal(skipped, 1);
  assert.deepEqual(admin.writes, []);
  assert.deepEqual(db.created, []);
});

test("Unlimited: every matching product gets options", async () => {
  const admin = setup();
  const skipped = await syncProducts(admin, "shop", ["p1", "p2", "p3", "p4"], Infinity);
  assert.equal(skipped, 0);
  assert.deepEqual(admin.writes, ["p2", "p3", "p4"]);
});

// ---------- Plan check (Billing API, through the store's own Admin API access) ----------

const { getPlan, PlanUnknownError } = await import("./billing.server.js");

// A fake Admin API answering the plan query from canned replies (a function throws), counting calls.
function planAdmin(replies) {
  const admin = {
    calls: 0,
    graphql: async () => {
      admin.calls++;
      const next = replies.shift();
      if (typeof next === "function") return next();
      return { json: async () => ({ data: { currentAppInstallation: { activeSubscriptions: next.subs }, shop: { plan: { partnerDevelopment: next.dev ?? false } } } }) };
    },
  };
  return admin;
}
const sub = (over) => ({ id: "gid://shopify/AppSubscription/1", name: "Unlimited", status: "ACTIVE", test: false, ...over });
const down = () => Promise.reject(new Error("Shopify is down"));

test("plan: Free by default, Unlimited only with an active Unlimited subscription", async () => {
  const admin = planAdmin([{ subs: [] }, { subs: [sub({ status: "PENDING" })] }, { subs: [sub()] }]);
  assert.deepEqual(await getPlan(admin, "a.myshopify.com"), { unlimited: false, subscriptionId: null, devStore: false });
  assert.equal((await getPlan(admin, "b.myshopify.com")).unlimited, false); // not approved yet
  assert.deepEqual(await getPlan(admin, "c.myshopify.com"), { unlimited: true, subscriptionId: "gid://shopify/AppSubscription/1", devStore: false });
});

test("plan: a test charge counts only on a development store", async () => {
  const admin = planAdmin([{ subs: [sub({ test: true })], dev: true }, { subs: [sub({ test: true })], dev: false }]);
  assert.equal((await getPlan(admin, "d.myshopify.com")).unlimited, true);
  assert.equal((await getPlan(admin, "e.myshopify.com")).unlimited, false); // a dev store handed to a merchant
});

test("plan: simultaneous checks share one request, and answers are cached", async () => {
  const admin = planAdmin([{ subs: [sub()] }]);
  const answers = await Promise.all([1, 2, 3].map(() => getPlan(admin, "f.myshopify.com")));
  assert.ok(answers.every((a) => a.unlimited));
  await getPlan(admin, "f.myshopify.com");
  assert.equal(admin.calls, 1);
});

test("plan: when Shopify can't answer, the last known plan stands; with none, it throws", async () => {
  const admin = planAdmin([{ subs: [] }, down, down]);
  assert.equal((await getPlan(admin, "g.myshopify.com")).unlimited, false);
  // Never turns a Free shop Unlimited because of an error.
  assert.equal((await getPlan(admin, "g.myshopify.com", { maxAge: 0 })).unlimited, false);
  await assert.rejects(getPlan(admin, "h.myshopify.com"), PlanUnknownError);
});

test("sync with nothing new to give options to never asks for the plan", async () => {
  const admin = setup();
  db.sets[0].fields = []; // the set now has no questions: p1 loses its options, nobody gains any
  await syncProducts(admin, "i.myshopify.com", ["p1", "p2"]);
  // Asking for the plan would throw (see fakeAdmin), so finishing means it wasn't asked.
  assert.deepEqual(admin.writes, []);
});
