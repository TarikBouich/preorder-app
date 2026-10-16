import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

type Admin = AdminApiContext;

import {
  ACTIVE_TAG,
  INACTIVE_TAG,
  IS_PREORDER_KEY,
  METAFIELD_NAMESPACE,
  SHIP_DATE_KEY,
  numericId,
} from "./preorder";
import type {
  OverdueVariant,
  PageInfo,
  PreorderCounts,
  StatusFilter,
  ProductSummary,
  ProductWithVariants,
  Variant,
} from "./preorder";

type GqlResponse<T> = { data: T; errors?: { message: string }[] };
type UserErrors = { userErrors: { message: string }[] };
type Connection<T> = { nodes: T[]; pageInfo: PageInfo };

async function gql<T>(
  admin: Admin,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

function assertNoUserErrors(result: UserErrors) {
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e) => e.message).join("; "));
  }
}

export type PageArgs = { after?: string | null; before?: string | null };

function pageVariables(pageSize: number, { after, before }: PageArgs) {
  return before
    ? { last: pageSize, before }
    : { first: pageSize, after: after || null };
}

const PAGE_INFO = `pageInfo { hasNextPage hasPreviousPage startCursor endCursor }`;

const VARIANT_FIELDS = `
  id
  title
  sku
  inventoryQuantity
  isPreorder: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${IS_PREORDER_KEY}") { value }
  shipDate: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${SHIP_DATE_KEY}") { value }
`;

type VariantNode = Omit<Variant, "isPreorder" | "shipDate"> & {
  isPreorder: { value: string } | null;
  shipDate: { value: string } | null;
};

function toVariant(node: VariantNode): Variant {
  return {
    id: node.id,
    title: node.title,
    sku: node.sku,
    inventoryQuantity: node.inventoryQuantity,
    isPreorder: node.isPreorder?.value === "true",
    shipDate: node.shipDate?.value ?? null,
  };
}

const STATUS_QUERIES: Record<StatusFilter, string | null> = {
  all: null,
  overdue: null, // built from the overdue variants' product ids
  active: `tag:'${ACTIVE_TAG}'`,
  inactive: `tag:'${INACTIVE_TAG}'`,
  none: `-tag:'${ACTIVE_TAG}' -tag:'${INACTIVE_TAG}'`,
};

function idsQuery(productIds: string[]) {
  // A query that matches nothing when there are no ids.
  if (!productIds.length) return "id:0";
  return productIds.map((id) => `id:${numericId(id)}`).join(" OR ");
}

function buildProductQuery(
  search?: string | null,
  status: StatusFilter = "all",
  overdueProductIds: string[] = [],
) {
  const statusQuery =
    status === "overdue" ? idsQuery(overdueProductIds) : STATUS_QUERIES[status];
  const parts = [search?.trim(), statusQuery].filter(Boolean);
  return parts.length ? parts.map((p) => `(${p})`).join(" AND ") : null;
}

export async function getPreorderCounts(admin: Admin): Promise<PreorderCounts> {
  const data = await gql<{
    total: { count: number };
    active: { count: number };
    inactive: { count: number };
  }>(
    admin,
    `#graphql
    query preorderCounts($active: String!, $inactive: String!) {
      total: productsCount(limit: null) { count }
      active: productsCount(query: $active, limit: null) { count }
      inactive: productsCount(query: $inactive, limit: null) { count }
    }`,
    { active: STATUS_QUERIES.active, inactive: STATUS_QUERIES.inactive },
  );
  return {
    total: data.total.count,
    active: data.active.count,
    inactive: data.inactive.count,
  };
}

// Today's date (YYYY-MM-DD) in the shop's time zone.
function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Pre-order variants whose ship date is before today (shop time zone).
 * Only variants of products tagged as pre-order are checked, so this stays
 * fast on large catalogs.
 */
export async function getOverdueVariants(
  admin: Admin,
): Promise<{ today: string; variants: OverdueVariant[] }> {
  const query = `${STATUS_QUERIES.active} OR tag:'_status:pre-order'`;
  const overdue: OverdueVariant[] = [];
  let today = "";
  let after: string | null = null;

  // Up to 10 pages of 200 variants.
  for (let page = 0; page < 10; page++) {
    const data: {
      shop: { ianaTimezone: string };
      productVariants: {
        nodes: (VariantNode & { product: { id: string; title: string } })[];
        pageInfo: PageInfo;
      };
    } = await gql(
      admin,
      `#graphql
      query overdueVariants($query: String!, $after: String) {
        shop { ianaTimezone }
        productVariants(first: 200, after: $after, query: $query) {
          nodes {
            id
            title
            isPreorder: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${IS_PREORDER_KEY}") { value }
            shipDate: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${SHIP_DATE_KEY}") { value }
            product { id title }
          }
          ${PAGE_INFO}
        }
      }`,
      { query, after },
    );

    today ||= todayIn(data.shop.ianaTimezone || "UTC");
    for (const v of data.productVariants.nodes) {
      const shipDate = v.shipDate?.value;
      if (v.isPreorder?.value === "true" && shipDate && shipDate < today) {
        overdue.push({
          id: v.id,
          title: v.title,
          shipDate,
          productId: v.product.id,
          productTitle: v.product.title,
        });
      }
    }

    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor;
  }

  overdue.sort((a, b) => a.shipDate.localeCompare(b.shipDate));
  return { today, variants: overdue };
}

export async function listProducts(
  admin: Admin,
  {
    search,
    status,
    overdueProductIds,
    ...page
  }: PageArgs & {
    search?: string | null;
    status?: StatusFilter;
    overdueProductIds?: string[];
  },
) {
  const data = await gql<{ products: Connection<ProductSummary> }>(
    admin,
    `#graphql
    query listProducts($first: Int, $last: Int, $after: String, $before: String, $query: String) {
      products(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          status
          tags
          variantsCount { count }
          featuredMedia { preview { image { url altText } } }
        }
        ${PAGE_INFO}
      }
    }`,
    {
      ...pageVariables(25, page),
      query: buildProductQuery(search, status, overdueProductIds),
    },
  );
  return data.products;
}

export async function listPreorderProducts(
  admin: Admin,
  { status, ...page }: PageArgs & { status?: "active" | "inactive" },
): Promise<Connection<ProductWithVariants>> {
  const data = await gql<{
    products: Connection<
      ProductSummary & { variants: { nodes: VariantNode[] } }
    >;
  }>(
    admin,
    `#graphql
    query listPreorderProducts($first: Int, $last: Int, $after: String, $before: String, $query: String) {
      products(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          tags
          variantsCount { count }
          featuredMedia { preview { image { url altText } } }
          variants(first: 30) { nodes { ${VARIANT_FIELDS} } }
        }
        ${PAGE_INFO}
      }
    }`,
    {
      ...pageVariables(10, page),
      query: status
        ? STATUS_QUERIES[status]
        : `${STATUS_QUERIES.active} OR ${STATUS_QUERIES.inactive}`,
    },
  );
  return {
    ...data.products,
    nodes: data.products.nodes.map((p) => ({
      ...p,
      variants: p.variants.nodes.map(toVariant),
    })),
  };
}

export async function getProduct(
  admin: Admin,
  id: string,
): Promise<ProductWithVariants | null> {
  const data = await gql<{
    product: (ProductSummary & { variants: { nodes: VariantNode[] } }) | null;
  }>(
    admin,
    `#graphql
    query getProduct($id: ID!) {
      product(id: $id) {
        id
        title
        status
        tags
        featuredMedia { preview { image { url altText } } }
        variants(first: 250) { nodes { ${VARIANT_FIELDS} } }
      }
    }`,
    { id },
  );
  if (!data.product) return null;
  return {
    ...data.product,
    variants: data.product.variants.nodes.map(toVariant),
  };
}

export async function addTags(admin: Admin, id: string, tags: string[]) {
  if (!tags.length) return;
  const data = await gql<{ tagsAdd: UserErrors }>(
    admin,
    `#graphql
    mutation addTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { message } }
    }`,
    { id, tags },
  );
  assertNoUserErrors(data.tagsAdd);
}

export async function removeTags(admin: Admin, id: string, tags: string[]) {
  if (!tags.length) return;
  const data = await gql<{ tagsRemove: UserErrors }>(
    admin,
    `#graphql
    mutation removeTags($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) { userErrors { message } }
    }`,
    { id, tags },
  );
  assertNoUserErrors(data.tagsRemove);
}

export type VariantUpdate = {
  id: string;
  isPreorder: boolean;
  shipDate: string | null;
};

export async function saveVariants(admin: Admin, input: VariantUpdate[]) {
  // A variant that isn't on pre-order has no ship date.
  const updates = input.map((v) =>
    v.isPreorder ? v : { ...v, shipDate: null },
  );
  const toSet = updates.flatMap((v) => [
    {
      ownerId: v.id,
      namespace: METAFIELD_NAMESPACE,
      key: IS_PREORDER_KEY,
      type: "boolean",
      value: String(v.isPreorder),
    },
    ...(v.shipDate
      ? [
          {
            ownerId: v.id,
            namespace: METAFIELD_NAMESPACE,
            key: SHIP_DATE_KEY,
            type: "date",
            value: v.shipDate,
          },
        ]
      : []),
  ]);
  const toDelete = updates
    .filter((v) => !v.shipDate)
    .map((v) => ({
      ownerId: v.id,
      namespace: METAFIELD_NAMESPACE,
      key: SHIP_DATE_KEY,
    }));

  // metafieldsSet accepts at most 25 metafields per call.
  for (let i = 0; i < toSet.length; i += 25) {
    const data = await gql<{ metafieldsSet: UserErrors }>(
      admin,
      `#graphql
      mutation setVariantMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { message } }
      }`,
      { metafields: toSet.slice(i, i + 25) },
    );
    assertNoUserErrors(data.metafieldsSet);
  }

  if (toDelete.length) {
    const data = await gql<{ metafieldsDelete: UserErrors }>(
      admin,
      `#graphql
      mutation deleteVariantMetafields($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { message } }
      }`,
      { metafields: toDelete },
    );
    assertNoUserErrors(data.metafieldsDelete);
  }
}

// Swaps every `_something:from` tag to `_something:to`. Only underscore-prefixed
// tags are touched, so regular merchandising tags are left alone.
function swapTags(tags: string[], from: string, to: string) {
  const suffix = `:${from}`;
  return tags
    .filter((t) => t.startsWith("_") && t.endsWith(suffix))
    .map((t) => ({ from: t, to: t.slice(0, -suffix.length) + `:${to}` }));
}

/**
 * Switches the product's pre-order tags to `:true` (active) or `:false`.
 * With `addIfMissing`, `_pre_order:true/false` is added when no tag was swapped.
 */
async function setPreorderTags(
  admin: Admin,
  id: string,
  tags: string[],
  active: boolean,
  addIfMissing: boolean,
) {
  const swaps = active
    ? swapTags(tags, "false", "true")
    : swapTags(tags, "true", "false");
  const target = active ? ACTIVE_TAG : INACTIVE_TAG;
  const toAdd = swaps.map((s) => s.to);
  if (addIfMissing && !tags.includes(target) && !toAdd.includes(target)) {
    toAdd.push(target);
  }
  await addTags(admin, id, toAdd);
  await removeTags(
    admin,
    id,
    swaps.map((s) => s.from),
  );
}

/**
 * Keeps product tags in line with the variants: any variant on pre-order makes
 * the product active; when the last one is turned off the tags go to `:false`.
 */
export async function syncPreorderTags(admin: Admin, productIds: string[]) {
  for (const id of productIds) {
    const product = await getProduct(admin, id);
    if (!product) continue;
    const anyOn = product.variants.some((v) => v.isPreorder);
    if (anyOn) {
      await setPreorderTags(admin, id, product.tags, true, true);
    } else {
      await setPreorderTags(admin, id, product.tags, false, false);
    }
  }
}

/** Saves variant metafields, then syncs the tags of every product touched. */
export async function saveVariantsAndSync(
  admin: Admin,
  updates: VariantUpdate[],
) {
  if (!updates.length) return;
  const data = await gql<{
    nodes: ({ product: { id: string } } | null)[];
  }>(
    admin,
    `#graphql
    query variantProducts($ids: [ID!]!) {
      nodes(ids: $ids) { ... on ProductVariant { product { id } } }
    }`,
    { ids: updates.map((u) => u.id) },
  );
  const productIds = [
    ...new Set(data.nodes.map((n) => n?.product?.id).filter(Boolean)),
  ] as string[];

  await saveVariants(admin, updates);
  await syncPreorderTags(admin, productIds);
}

/**
 * Deactivate: every variant is turned off (which clears its ship date) and
 * `_x:true` tags become `_x:false`. To activate again, turn variants back on
 * with a ship date — saving them switches the tags back automatically.
 */
export async function deactivateProduct(admin: Admin, id: string) {
  const product = await getProduct(admin, id);
  if (!product) throw new Error("Product not found");

  await saveVariants(
    admin,
    product.variants
      .filter((v) => v.isPreorder || v.shipDate)
      .map((v) => ({ id: v.id, isPreorder: false, shipDate: null })),
  );
  await setPreorderTags(admin, id, product.tags, false, true);
}

const METAFIELD_DEFINITIONS = [
  {
    name: "Is Pre-Order",
    key: IS_PREORDER_KEY,
    type: "boolean",
    description: "Variant is sold as pre-order (managed by preorder-manager).",
  },
  {
    name: "Pre-Order Ship Date",
    key: SHIP_DATE_KEY,
    type: "date",
    description:
      "Expected ship date for the pre-order (managed by preorder-manager).",
  },
];

const checkedShops = new Set<string>();

async function definitionExists(admin: Admin, key: string) {
  const data = await gql<{
    metafieldDefinitions: { nodes: { id: string }[] };
  }>(
    admin,
    `#graphql
    query preorderDefinitionExists($namespace: String!, $key: String!) {
      metafieldDefinitions(first: 1, ownerType: PRODUCTVARIANT, namespace: $namespace, key: $key) {
        nodes { id }
      }
    }`,
    { namespace: METAFIELD_NAMESPACE, key },
  );
  return data.metafieldDefinitions.nodes.length > 0;
}

/**
 * Makes sure the variant metafield definitions the app and theme rely on
 * exist. Each one is looked up first and only created when missing; an
 * existing definition (name, type, settings, values) is never modified.
 */
export async function ensureMetafieldDefinitions(admin: Admin, shop: string) {
  if (checkedShops.has(shop)) return;

  for (const definition of METAFIELD_DEFINITIONS) {
    if (await definitionExists(admin, definition.key)) continue;

    const data = await gql<{
      metafieldDefinitionCreate: {
        userErrors: { message: string; code: string }[];
      };
    }>(
      admin,
      `#graphql
      mutation createPreorderDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          userErrors { message code }
        }
      }`,
      {
        definition: {
          ...definition,
          namespace: METAFIELD_NAMESPACE,
          ownerType: "PRODUCTVARIANT",
          pin: true,
        },
      },
    );
    // TAKEN = created meanwhile (e.g. two requests at once); nothing to do.
    const errors = data.metafieldDefinitionCreate.userErrors.filter(
      (e) => e.code !== "TAKEN",
    );
    if (errors.length) {
      console.error(
        `Could not create metafield definition ${METAFIELD_NAMESPACE}.${definition.key} on ${shop}:`,
        errors,
      );
      return;
    }
  }

  checkedShops.add(shop);
}
