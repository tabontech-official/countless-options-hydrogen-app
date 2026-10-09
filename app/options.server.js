import prisma from "./db.server";
import { appliesTo, hasPrices, mergeFields, rulesOf, rulesQuery } from "./options";

export const BLOCK_HANDLE = "product_options";

export async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  return (await res.json()).data;
}

const chunks = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// Key-order-insensitive JSON equality: Shopify may hand a json metafield back with its keys reordered.
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );

// Rewrites each product's `$app.options` metafield from every ACTIVE set that applies to it:
// picked by hand, or matched by the set's rules against the product's current tags, vendor,
// type, status, category, collections and publications (sales channels and catalogs).
// Call with every product whose sets may have changed (old and new).
// Only products whose options actually change are written, so the products/update webhook our
// own write triggers finds nothing to do and stops there. Rule-based sets also get their
// matches recorded in OptionSetProduct, so a collection change knows which products to recheck.
// ponytail: DB is written before this runs; if Shopify fails, saving again re-syncs.
export async function syncProducts(admin, shop, productIds) {
  const ids = [...new Set(productIds)];
  if (!ids.length) return;
  const sets = (
    await prisma.optionSet.findMany({
      where: { shop, status: "ACTIVE" },
      select: { id: true, fields: true, rules: true, products: { where: { productId: { in: ids } }, select: { productId: true } } },
      orderBy: { createdAt: "asc" },
    })
  ).map((s) => ({ ...s, rules: rulesOf(s.rules), has: new Set(s.products.map((p) => p.productId)) }));
  // Collections, sales channels and catalogs are checked with one field per ID the rules name.
  const named = (fields) => [
    ...new Set(sets.flatMap((s) => s.rules.conditions.filter((c) => fields.includes(c.field)).map((c) => c.value))),
  ];
  const collections = named(["collection"]);
  const publications = named(["channel", "catalog"]);

  const toSet = [];
  const toDelete = [];
  const matched = [];
  const unmatched = [];
  for (const batch of chunks(ids, 250)) {
    const data = await gql(
      admin,
      `#graphql
      query ProductFacts($ids: [ID!]!${collections.map((_, i) => `, $c${i}: ID!`).join("")}${publications.map((_, i) => `, $p${i}: ID!`).join("")}) {
        nodes(ids: $ids) {
          ... on Product {
            id tags vendor productType status category { id }
            ${collections.map((_, i) => `c${i}: inCollection(id: $c${i})`).join(" ")}
            ${publications.map((_, i) => `p${i}: publishedOnPublication(publicationId: $p${i})`).join(" ")}
            options: metafield(namespace: "$app", key: "options") { value }
          }
        }
      }`,
      {
        ids: batch,
        ...Object.fromEntries(collections.map((id, i) => [`c${i}`, id])),
        ...Object.fromEntries(publications.map((id, i) => [`p${i}`, id])),
      },
    );
    // Deleted products (and IDs from other shops) come back null and are skipped.
    for (const product of data.nodes.filter((p) => p?.id)) {
      product.collections = collections.filter((_, i) => product[`c${i}`]);
      product.publications = publications.filter((_, i) => product[`p${i}`]);
      const applying = sets.filter((s) => (s.rules.mode === "manual" ? s.has.has(product.id) : appliesTo(s.rules, product)));
      for (const s of sets.filter((s) => s.rules.mode !== "manual")) {
        const row = { optionSetId: s.id, productId: product.id };
        if (applying.includes(s) && !s.has.has(product.id)) matched.push(row);
        if (!applying.includes(s) && s.has.has(product.id)) unmatched.push(row);
      }
      const fields = mergeFields(applying.map((s) => s.fields));
      const current = product.options && JSON.parse(product.options.value);
      if (fields.length ? canonical(current) === canonical(fields) : !current) continue;
      if (fields.length) toSet.push({ ownerId: product.id, namespace: "$app", key: "options", type: "json", value: JSON.stringify(fields) });
      else toDelete.push({ ownerId: product.id, namespace: "$app", key: "options" });
    }
  }

  // Both mutations accept at most 25 metafields per call.
  for (const metafields of chunks(toSet, 25)) {
    const data = await gql(
      admin,
      `#graphql
      mutation SetProductOptions($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`,
      { metafields },
    );
    const [error] = data.metafieldsSet.userErrors;
    if (error) throw new Error(`Couldn't update products: ${error.message}`);
  }
  for (const metafields of chunks(toDelete, 25)) {
    const data = await gql(
      admin,
      `#graphql
      mutation ClearProductOptions($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { field message } }
      }`,
      { metafields },
    );
    const [error] = data.metafieldsDelete.userErrors;
    if (error) throw new Error(`Couldn't update products: ${error.message}`);
  }

  // Recorded only once the store is updated, so the records always describe what's live.
  if (matched.length) await prisma.optionSetProduct.createMany({ data: matched, skipDuplicates: true });
  for (const rows of chunks(unmatched, 500)) await prisma.optionSetProduct.deleteMany({ where: { OR: rows } });
}

// Option prices are charged by the cart transform function (extensions/product-options-pricing),
// which expands a priced cart line into the product plus a hidden "Option add-ons" variant.
// Idempotent: checks Shopify first, so it repairs a deleted add-on or a reinstalled app.
export async function ensurePricing(admin) {
  const state = await gql(
    admin,
    `#graphql
    query PricingSetup {
      cartTransforms(first: 1) {
        nodes { id addonVariant: metafield(namespace: "$app", key: "addon_variant") { value } }
      }
    }`,
  );
  const transform = state.cartTransforms.nodes[0];
  let variantId = transform?.addonVariant?.value;
  if (variantId) {
    const found = await gql(
      admin,
      `#graphql
      query AddonVariant($id: ID!) { productVariant(id: $id) { id } }`,
      { id: variantId },
    );
    if (found.productVariant) return;
  }

  const created = await gql(
    admin,
    `#graphql
    mutation CreateAddonProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id variants(first: 1) { nodes { id } } }
        userErrors { field message }
      }
    }`,
    // Unlisted: hidden from search, collections and recommendations, but sellable in checkout.
    { product: { title: "Option add-ons", status: "UNLISTED", productType: "Product options", tags: ["product-options-addon"] } },
  );
  assertNoErrors(created.productCreate);
  const product = created.productCreate.product;
  variantId = product.variants.nodes[0].id;

  const variant = await gql(
    admin,
    `#graphql
    mutation SetupAddonVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
    }`,
    { productId: product.id, variants: [{ id: variantId, price: "0.00", inventoryItem: { tracked: false, requiresShipping: false } }] },
  );
  assertNoErrors(variant.productVariantsBulkUpdate);

  // Checkout checks that every bundle part is available on the Online Store channel.
  const publications = await gql(
    admin,
    `#graphql
    query Publications { publications(first: 25) { nodes { id catalog { title } } } }`,
  );
  const onlineStore = publications.publications.nodes.find((p) => p.catalog?.title === "Online Store");
  if (onlineStore) {
    const published = await gql(
      admin,
      `#graphql
      mutation PublishAddon($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { field message } }
      }`,
      { id: product.id, input: [{ publicationId: onlineStore.id }] },
    );
    assertNoErrors(published.publishablePublish);
  }

  const metafield = { namespace: "$app", key: "addon_variant", type: "single_line_text_field", value: variantId };
  if (transform) {
    const data = await gql(
      admin,
      `#graphql
      mutation SetAddonVariant($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`,
      { metafields: [{ ...metafield, ownerId: transform.id }] },
    );
    assertNoErrors(data.metafieldsSet);
  } else {
    // blockOnFailure false: if the function ever fails, checkout still works (without option charges).
    const data = await gql(
      admin,
      `#graphql
      mutation CreatePricingTransform($metafields: [MetafieldInput!]) {
        cartTransformCreate(functionHandle: "product-options-pricing", blockOnFailure: false, metafields: $metafields) {
          cartTransform { id }
          userErrors { field message }
        }
      }`,
      { metafields: [metafield] },
    );
    assertNoErrors(data.cartTransformCreate);
  }
}

function assertNoErrors(result) {
  const [error] = result.userErrors;
  if (error) throw new Error(`Couldn't set up option pricing: ${error.message}`);
}

export async function getShopCurrency(admin) {
  const data = await gql(
    admin,
    `#graphql
    query ShopCurrency { shop { currencyCode } }`,
  );
  return data.shop.currencyCode;
}

// IDs of the products a set's rules match today, from an Admin product search (empty for
// hand-picked sets). syncProducts re-checks each one with appliesTo.
// ponytail: walks every page in the request, fine to a few thousand products; move to a bulk
// operation if stores with tens of thousands of products use "All products".
export async function ruleMatches(admin, rules) {
  const query = rulesQuery(rules);
  if (!query) return [];
  const ids = [];
  let after = null;
  do {
    const data = await gql(
      admin,
      `#graphql
      query RuleMatches($query: String!, $after: String) {
        products(first: 250, after: $after, query: $query) {
          nodes { id }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { query, after },
    );
    ids.push(...data.products.nodes.map((p) => p.id));
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return ids;
}

// Current title + thumbnail for product GIDs. Only this shop's existing products come back,
// so it doubles as validation of IDs sent by the browser.
export async function getProducts(admin, ids) {
  if (!ids.length) return [];
  const data = await gql(
    admin,
    `#graphql
    query OptionSetProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          featuredMedia { preview { image { url(transform: { maxWidth: 120, maxHeight: 120 }) } } }
        }
      }
    }`,
    { ids },
  );
  return data.nodes
    .filter((p) => p?.id)
    .map((p) => ({ id: p.id, title: p.title, image: p.featuredMedia?.preview?.image?.url ?? null }));
}

// Whether the published theme's default product template contains our app block.
// ponytail: checks templates/product.json only; alternate product templates aren't scanned.
export async function isBlockInTheme(admin) {
  try {
    const data = await gql(
      admin,
      `#graphql
      query ProductTemplate {
        themes(first: 1, roles: [MAIN]) {
          nodes {
            files(filenames: ["templates/product.json"], first: 1) {
              nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
            }
          }
        }
      }`,
    );
    const content = data.themes.nodes[0]?.files.nodes[0]?.body?.content ?? "";
    return content.includes(`/blocks/${BLOCK_HANDLE}/`);
  } catch (error) {
    console.error("Theme check failed", error);
    return false;
  }
}

// Products in the store, not counting the hidden "Option add-ons" product.
export async function countProducts(admin) {
  const data = await gql(
    admin,
    `#graphql
    query StoreProductCount { productsCount(query: "-tag:product-options-addon", limit: null) { count } }`,
  );
  return data.productsCount.count;
}

export const themeEditorUrl = (shop) =>
  `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${process.env.SHOPIFY_API_KEY}/${BLOCK_HANDLE}&target=mainSection`;

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

// Rows for the option sets table (dashboard + index page).
export async function listOptionSets(shop, take) {
  const sets = await prisma.optionSet.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
    take,
    include: { _count: { select: { products: true } } },
  });
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    fieldCount: s.fields.length,
    fieldNames: s.fields.map((f) => f.label).filter(Boolean),
    priced: hasPrices(s.fields),
    productCount: s._count.products,
    updatedAt: dateFormat.format(s.updatedAt),
  }));
}
