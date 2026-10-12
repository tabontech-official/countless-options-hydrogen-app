import { authenticate } from "../shopify.server";
import { ADDON_TAG, MAX_PRODUCTS, isMetafieldKey } from "../options";
import { gql, productMetafieldDefinitions } from "../options.server";

// POST { tag, productIds }: puts a tag on products. Shopify has no tag without a product, so this
// is how a new tag from a condition comes to exist (the products/update webhooks that follow
// give those products the option set).
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.json();
  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  const ids = (Array.isArray(body.productIds) ? body.productIds : [])
    .filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id))
    .slice(0, MAX_PRODUCTS);
  // A comma would split it into two tags.
  if (!tag || tag.length > 255 || tag.includes(",")) return { error: "Tags need 1 to 255 characters and no commas." };
  if (!ids.length) return { error: "Choose at least one product." };

  // ponytail: one product per call (tagsAdd takes one resource); fine for a picker's worth.
  for (const id of ids) {
    const data = await gql(
      admin,
      `#graphql
      mutation TagProduct($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
      }`,
      { id, tags: [tag] },
    );
    const [error] = data.tagsAdd.userErrors;
    if (error) return { error: `Couldn't tag every product: ${error.message}` };
  }
  return { tag, tagged: ids.length };
};

// Backs the conditions editor (RulesEditor in app.option-sets.$id.jsx):
//   ?kind=count&q=…     how many products the conditions match today (q is rulesQuery's search)
//   ?kind=suggest       the store's tags, vendors and product types, suggested while typing
//   ?kind=channel       sales channels to choose from
//   ?kind=catalog       catalogs, each with its kind (region, retail, company location, B2B, unassigned)
//   ?kind=category&q=…  Shopify product categories matching a search
//   ?kind=metafield     product metafield definitions a condition can check
//   ?kind=values&keys=a.b,c.d  values products already have in those metafields
//   ?kind=entries&definition=…  the entries of a metaobject definition (a category metafield's values)
// Channels and catalogs are offered by their publication: that's what a product is published to.
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const q = params.get("q")?.trim() || null;

  if (kind === "count") {
    const data = await gql(
      admin,
      `#graphql
      query MatchCount($query: String!) { productsCount(query: $query, limit: null) { count } }`,
      { query: q ?? "" },
    );
    // q comes back so the editor only shows a count for the conditions it was asked about.
    return { kind, q: q ?? "", count: data.productsCount.count };
  }
  if (kind === "suggest") {
    // ponytail: first 250 of each; any other value can still be typed in.
    const data = await gql(
      admin,
      `#graphql
      query Suggestions {
        productTags(first: 250) { nodes }
        productTypes(first: 250) { nodes }
        productVendors(first: 250) { nodes }
      }`,
    );
    return {
      kind,
      tag: data.productTags.nodes.filter((t) => t !== ADDON_TAG),
      vendor: data.productVendors.nodes,
      type: data.productTypes.nodes.filter(Boolean),
    };
  }
  if (kind === "channel") {
    const data = await gql(
      admin,
      `#graphql
      query Channels { publications(first: 50, catalogType: APP) { nodes { id catalog { title } } } }`,
    );
    return { kind, options: data.publications.nodes.map((p) => ({ value: p.id, label: p.catalog?.title ?? "Sales channel" })) };
  }
  if (kind === "catalog") {
    // ponytail: first 100 of each; page through catalogs if a store outgrows that.
    const data = await gql(
      admin,
      `#graphql
      query Catalogs {
        markets: catalogs(first: 100, type: MARKET) {
          nodes { title publication { id } ... on MarketCatalog { markets(first: 1) { nodes { type } } } }
        }
        b2b: catalogs(first: 100, type: COMPANY_LOCATION) { nodes { title publication { id } } }
      }`,
    );
    // A market catalog's kind follows its market; one that isn't assigned to a market is "unassigned".
    const MARKET_KIND = { REGION: "region", LOCATION: "retail", COMPANY_LOCATION: "company" };
    const options = [
      ...(data?.markets?.nodes ?? []).map((c) => ({ c, kind: MARKET_KIND[c.markets?.nodes[0]?.type] ?? "unassigned" })),
      ...(data?.b2b?.nodes ?? []).map((c) => ({ c, kind: "b2b" })),
    ]
      // Without its own publication a catalog follows the sales channel, so there's nothing to match.
      .filter(({ c }) => c.publication)
      .map(({ c, kind }) => ({ value: c.publication.id, label: c.title, kind }));
    return { kind, options };
  }
  if (kind === "metafield") return { kind, options: await productMetafieldDefinitions(admin) };
  if (kind === "values") {
    // The values products already have in some text metafields, to suggest while typing.
    // ponytail: read from the 250 most recently updated products (fewer with many keys, to stay
    // under the query cost limit); a value only older products have can still be typed.
    const keys = [...new Set((params.get("keys") ?? "").split(","))].filter(isMetafieldKey).slice(0, 10);
    const first = Math.min(250, Math.floor(900 / (1 + keys.length)));
    const data = keys.length
      ? await gql(
          admin,
          `#graphql
          query MetafieldValues($first: Int!${keys.map((_, i) => `, $n${i}: String!, $k${i}: String!`).join("")}) {
            products(first: $first, sortKey: UPDATED_AT, reverse: true, query: "-tag:${ADDON_TAG}") {
              nodes { ${keys.map((_, i) => `m${i}: metafield(namespace: $n${i}, key: $k${i}) { jsonValue }`).join(" ")} }
            }
          }`,
          {
            first,
            ...Object.fromEntries(
              keys.flatMap((key, i) => {
                const at = key.lastIndexOf(".");
                return [[`n${i}`, key.slice(0, at)], [`k${i}`, key.slice(at + 1)]];
              }),
            ),
          },
        )
      : null;
    const values = Object.fromEntries(
      keys.map((key, i) => [
        key,
        [...new Set((data?.products.nodes ?? []).flatMap((p) => [p[`m${i}`]?.jsonValue ?? []].flat().map(String)))].sort(),
      ]),
    );
    return { kind, keys: keys.join(","), values };
  }
  if (kind === "entries") {
    // The entries of one metaobject definition (Color: Red, Blue…), for a metafield condition.
    // ponytail: first 250 entries.
    const id = params.get("definition") ?? "";
    if (!/^gid:\/\/shopify\/MetaobjectDefinition\/\d+$/.test(id)) throw new Response("Bad definition", { status: 400 });
    const data = await gql(
      admin,
      `#graphql
      query MetaobjectEntries($id: ID!) {
        metaobjectDefinition(id: $id) { metaobjects(first: 250) { nodes { id displayName } } }
      }`,
      { id },
    );
    const entries = data?.metaobjectDefinition?.metaobjects.nodes;
    // Null until the store approves the app's read_metaobjects scopes.
    return { kind, definition: id, options: entries?.map((e) => ({ value: e.id, label: e.displayName })) ?? [], blocked: !entries };
  }
  if (kind === "category") {
    const data = await gql(
      admin,
      `#graphql
      query Categories($search: String) { taxonomy { categories(first: 20, search: $search) { nodes { id fullName } } } }`,
      { search: q },
    );
    return { kind, options: data.taxonomy.categories.nodes.map((c) => ({ value: c.id, label: c.fullName })) };
  }
  throw new Response("Unknown kind", { status: 400 });
};
