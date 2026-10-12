import { authenticate } from "../shopify.server";
import { eraseShopData } from "../options.server";

// GDPR compliance webhooks. authenticate.webhook rejects bad HMACs with 401, which Shopify's review checks.
// We store no customer data, so data_request/customers/redact need no work.
// shop/redact arrives 48h after uninstall: erase everything we hold for the shop (app/uninstalled
// already did; this is the guarantee Shopify's privacy rules ask for).
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic === "SHOP_REDACT") await eraseShopData(shop);

  return new Response();
};
