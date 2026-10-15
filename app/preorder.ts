// Shared between server and browser code (no API calls here).

// Variant metafields the theme reads (Settings → Custom data → Variants).
export const METAFIELD_NAMESPACE = "custom";
export const IS_PREORDER_KEY = "is_pre_order";
export const SHIP_DATE_KEY = "pre_order_ship_date";

// The product tag that decides whether a product shows up as Active/Inactive
// on the Pre-orders page.
export const STATUS_TAG_KEY = "_pre_order";
export const ACTIVE_TAG = `${STATUS_TAG_KEY}:true`;
export const INACTIVE_TAG = `${STATUS_TAG_KEY}:false`;

export type PreorderStatus = "active" | "inactive" | "none";

export type Variant = {
  id: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number | null;
  isPreorder: boolean;
  shipDate: string | null;
};

export type ProductSummary = {
  id: string;
  title: string;
  status?: string;
  tags: string[];
  variantsCount?: { count: number };
  featuredMedia?: {
    preview?: { image?: { url: string; altText: string | null } | null } | null;
  } | null;
};

export type ProductWithVariants = ProductSummary & { variants: Variant[] };

export type PageInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

export function preorderStatus(tags: string[]): PreorderStatus {
  if (tags.includes(ACTIVE_TAG)) return "active";
  if (tags.includes(INACTIVE_TAG)) return "inactive";
  return "none";
}

export function productGid(id: string) {
  return `gid://shopify/Product/${id}`;
}

export function numericId(gid: string) {
  return gid.split("/").pop()!;
}
