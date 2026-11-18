import { authenticate } from "../shopify.server";
import db from "../db.server";

// Drop deleted products from option sets so counts and syncs stay accurate.
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);
  const gid = `gid://shopify/Product/${payload.id}`;

  await db.optionSetProduct.deleteMany({
    where: { productId: gid, optionSet: { shop } },
  });

  if (db.shopBilling) {
    try {
      const billing = await db.shopBilling.findUnique({ where: { shop } });
      if (billing?.chosenProductIds && Array.isArray(billing.chosenProductIds) && billing.chosenProductIds.includes(gid)) {
        await db.shopBilling.update({
          where: { shop },
          data: { chosenProductIds: billing.chosenProductIds.filter((id) => id !== gid) },
        });
      }
    } catch (e) {
      console.warn("Couldn't update shopBilling on product delete:", e.message);
    }
  }

  return new Response();
};
