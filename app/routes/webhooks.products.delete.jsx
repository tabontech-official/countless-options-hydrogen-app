import { authenticate } from "../shopify.server";
import db from "../db.server";

// Drop deleted products from option sets so counts and syncs stay accurate.
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  await db.optionSetProduct.deleteMany({
    where: { productId: `gid://shopify/Product/${payload.id}`, optionSet: { shop } },
  });

  return new Response();
};
