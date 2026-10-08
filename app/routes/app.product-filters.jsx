import { authenticate } from "../shopify.server";
import { MAX_PRODUCTS } from "../options";
import { getProducts } from "../options.server";

// Backs the option set editor's "Select products" pop-up: lists products, collections, tags or
// categories to choose from, and turns the choices into the products they currently contain.

// The hidden product that carries option prices (see ensurePricing) never gets options itself.
const NOT_ADDON = "-tag:product-options-addon";
const THUMB = "url(transform: { maxWidth: 120, maxHeight: 120 })";

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  return (await res.json()).data;
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const search = params.get("q")?.trim() || null;

  const type = params.get("type");
  switch (type) {
    case "product": {
      const data = await gql(
        admin,
        `#graphql
        query PickerProducts($query: String!) {
          products(first: 50, query: $query, sortKey: TITLE) {
            nodes { id title featuredMedia { preview { image { ${THUMB} } } } }
          }
        }`,
        { query: search ? `${search} ${NOT_ADDON}` : NOT_ADDON },
      );
      const options = data.products.nodes.map((p) => ({ value: p.id, label: p.title, image: p.featuredMedia?.preview?.image?.url ?? null }));
      return { type, options };
    }
    case "collection": {
      const data = await gql(
        admin,
        `#graphql
        query PickerCollections($query: String) {
          collections(first: 50, query: $query, sortKey: TITLE) { nodes { id title image { ${THUMB} } } }
        }`,
        { query: search },
      );
      return { type, options: data.collections.nodes.map((c) => ({ value: c.id, label: c.title, image: c.image?.url ?? null })) };
    }
    case "category": {
      // Without a search, Shopify returns the top-level categories.
      const data = await gql(
        admin,
        `#graphql
        query PickerCategories($search: String) {
          taxonomy { categories(first: 50, search: $search) { nodes { id fullName } } }
        }`,
        { search },
      );
      return { type, options: data.taxonomy.categories.nodes.map((c) => ({ value: c.id, label: c.fullName })) };
    }
    default: {
      // ponytail: first 250 tags, filtered in the browser; page through productTags if shops outgrow it.
      const data = await gql(
        admin,
        `#graphql
        query PickerTags { productTags(first: 250) { nodes } }`,
      );
      return { type, options: data.productTags.nodes.map((tag) => ({ value: tag, label: tag })) };
    }
  }
};

// Search syntax wants quoted values with " and \ escaped.
const quote = (value) => `"${value.replace(/["\\]/g, "\\$&")}"`;
const strings = (list) => (Array.isArray(list) ? list.filter((v) => typeof v === "string" && v.trim()) : []);
// gid://shopify/Collection/123 → 123, gid://shopify/TaxonomyCategory/aa-1-2 → aa-1-2
const tail = (gid) => gid.split("/").pop();

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.json();
  const ids = strings(body.products);
  const terms = [
    ...strings(body.collections).map(tail).filter((id) => /^\d+$/.test(id)).map((id) => `collection_id:${id}`),
    ...strings(body.tags).map((tag) => `tag:${quote(tag)}`),
    ...strings(body.categories).map(tail).filter((id) => /^[\w-]+$/.test(id)).map((id) => `category_id:${id}`),
  ];

  let truncated = false;
  if (terms.length) {
    // An option set holds at most MAX_PRODUCTS (one page), so a single request is enough.
    const data = await gql(
      admin,
      `#graphql
      query ProductsMatching($query: String!, $first: Int!) {
        products(first: $first, query: $query) {
          nodes { id }
          pageInfo { hasNextPage }
        }
      }`,
      { query: `(${terms.join(" OR ")}) ${NOT_ADDON}`, first: MAX_PRODUCTS },
    );
    ids.push(...data.products.nodes.map((p) => p.id));
    truncated = data.products.pageInfo.hasNextPage;
  }
  const unique = [...new Set(ids)];
  // getProducts only returns this shop's products, so it also validates the picked IDs.
  return {
    products: await getProducts(admin, unique.slice(0, MAX_PRODUCTS)),
    truncated: truncated || unique.length > MAX_PRODUCTS,
  };
};
