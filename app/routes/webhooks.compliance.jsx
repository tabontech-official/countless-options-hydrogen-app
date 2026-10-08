import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR compliance webhooks. authenticate.webhook rejects bad HMACs with 401, which Shopify's review checks.
// We store no customer data, so data_request/customers/redact need no work.
// shop/redact arrives 48h after uninstall: erase everything we hold for the shop.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic === "SHOP_REDACT") {
    await db.optionSet.deleteMany({ where: { shop } });
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
