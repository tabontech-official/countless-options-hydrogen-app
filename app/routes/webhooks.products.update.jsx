import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { rulesOf } from "../options";
import { syncProducts } from "../options.server";

// products/create and products/update: a product whose tags, vendor or type changed may now
// meet (or stop meeting) an option set's conditions, so its options are worked out again.
// Hand-picked sets don't depend on product details, so stores without rules skip the work.
export const action = async ({ request }) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response(); // the app was uninstalled

  const sets = await prisma.optionSet.findMany({ where: { shop, status: "ACTIVE" }, select: { rules: true } });
  if (sets.some((s) => rulesOf(s.rules).mode !== "manual")) {
    // On the Free plan, a new product past the limit doesn't get options. If the plan can't be
    // checked, syncProducts throws and Shopify retries the webhook later.
    await syncProducts(admin, shop, [payload.admin_graphql_api_id]);
  }
  return new Response();
};
