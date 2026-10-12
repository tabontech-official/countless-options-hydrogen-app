import { authenticate } from "../shopify.server";
import { eraseShopData } from "../options.server";

// app/uninstalled: erase everything the app holds for the shop right away (option sets, their
// product links, sessions). shop/redact (webhooks.compliance.jsx) erases it again 48h later.
// Safe to repeat: Shopify may send this more than once, even after the data is gone.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  await eraseShopData(shop);
  return new Response();
};
