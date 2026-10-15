import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

type Admin = AdminApiContext;

import {
  ACTIVE_TAG,
  INACTIVE_TAG,
  IS_PREORDER_KEY,
  METAFIELD_NAMESPACE,
  SHIP_DATE_KEY,
} from "./preorder";
import type {
  PageInfo,
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

export async function listProducts(
  admin: Admin,
  { search, ...page }: PageArgs & { search?: string | null },
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
    { ...pageVariables(25, page), query: search || null },
  );
  return data.products;
}

export async function listPreorderProducts(
  admin: Admin,
  page: PageArgs,
): Promise<Connection<ProductWithVariants>> {
  const data = await gql<{
    products: Connection<ProductSummary & { variants: { nodes: VariantNode[] } }>;
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
      query: `tag:'${ACTIVE_TAG}' OR tag:'${INACTIVE_TAG}'`,
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

export async function saveVariants(admin: Admin, updates: VariantUpdate[]) {
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
 * Deactivate: `_x:true` tags become `_x:false` and every variant's
 * Is Pre-Order is set to false. Ship dates are kept so a later
 * activation knows which variants were on pre-order.
 */
export async function deactivateProduct(admin: Admin, id: string) {
  const product = await getProduct(admin, id);
  if (!product) throw new Error("Product not found");

  const swaps = swapTags(product.tags, "true", "false");
  await addTags(admin, id, swaps.map((s) => s.to));
  await removeTags(admin, id, swaps.map((s) => s.from));
  if (!product.tags.includes(INACTIVE_TAG) && !swaps.length) {
    await addTags(admin, id, [INACTIVE_TAG]);
  }

  await saveVariants(
    admin,
    product.variants
      .filter((v) => v.isPreorder)
      .map((v) => ({ id: v.id, isPreorder: false, shipDate: v.shipDate })),
  );
}

/**
 * Activate: `_x:false` tags become `_x:true` and variants that still have a
 * ship date get Is Pre-Order set back to true.
 */
export async function activateProduct(admin: Admin, id: string) {
  const product = await getProduct(admin, id);
  if (!product) throw new Error("Product not found");

  const swaps = swapTags(product.tags, "false", "true");
  await addTags(admin, id, swaps.map((s) => s.to));
  await removeTags(admin, id, swaps.map((s) => s.from));
  if (!product.tags.includes(ACTIVE_TAG) && !swaps.length) {
    await addTags(admin, id, [ACTIVE_TAG]);
  }

  await saveVariants(
    admin,
    product.variants
      .filter((v) => !v.isPreorder && v.shipDate)
      .map((v) => ({ id: v.id, isPreorder: true, shipDate: v.shipDate })),
  );
}

const METAFIELD_DEFINITIONS = [
  {
    name: "Is Pre-Order",
    key: IS_PREORDER_KEY,
    type: "boolean",
    description: "Variant is sold as pre-order (managed by preorder-neven).",
  },
  {
    name: "Pre-Order Ship Date",
    key: SHIP_DATE_KEY,
    type: "date",
    description: "Expected ship date for the pre-order (managed by preorder-neven).",
  },
];

const checkedShops = new Set<string>();

/**
 * Creates the variant metafield definitions the app and theme rely on.
 * Definitions that already exist on the store are left untouched.
 */
export async function ensureMetafieldDefinitions(admin: Admin, shop: string) {
  if (checkedShops.has(shop)) return;

  for (const definition of METAFIELD_DEFINITIONS) {
    const data = await gql<{
      metafieldDefinitionCreate: { userErrors: { message: string; code: string }[] };
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
