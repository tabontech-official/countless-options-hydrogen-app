import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { rulesOf } from "../options";
import { ruleMatches, syncProducts } from "../options.server";

// collections/update: products were added to or removed from a collection by hand, or its rules
// changed. Shopify doesn't say which products, so every set with a condition on this collection
// rechecks what it matched before (recorded by syncProducts) and what it matches now.
// Products that join an automated collection because their tags changed arrive through
// products/update instead.
export const action = async ({ request }) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response(); // the app was uninstalled

  const sets = await prisma.optionSet.findMany({
    where: { shop, status: "ACTIVE" },
    select: { rules: true, products: { select: { productId: true } } },
  });
  const affected = sets.filter((s) =>
    rulesOf(s.rules).conditions.some((c) => c.field === "collection" && c.value === payload.admin_graphql_api_id),
  );
  if (affected.length) {
    // Only products in the collection now can have newly matched; the rest stay as recorded.
    // (Searching each set's whole rules could scan every product, e.g. "any" with a metafield.)
    const inCollection = await ruleMatches(admin, {
      mode: "match",
      match: "all",
      conditions: [{ field: "collection", op: "is", value: payload.admin_graphql_api_id }],
    });
    await syncProducts(admin, shop, [...affected.flatMap((s) => s.products.map((p) => p.productId)), ...inCollection]);
  }
  return new Response();
};
