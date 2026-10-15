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

export type StatusFilter = "all" | "active" | "inactive" | "none";

export function parseStatusFilter(value: string | null): StatusFilter {
  return value === "active" || value === "inactive" || value === "none"
    ? value
    : "all";
}

export type PreorderCounts = {
  total: number;
  active: number;
  inactive: number;
};

type Tone = "success" | "caution" | "critical" | "neutral" | "info";

// "in 12 days" / "Tomorrow" / "Overdue by 3 days" for a YYYY-MM-DD ship date.
export function shipDateHint(
  date: string | null,
): { label: string; tone: Tone } | null {
  if (!date) return null;
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const [y, m, d] = date.split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - todayUtc) / 86_400_000);

  if (days < 0)
    return {
      label: `Overdue by ${-days} day${days === -1 ? "" : "s"}`,
      tone: "critical",
    };
  if (days === 0) return { label: "Ships today", tone: "caution" };
  if (days === 1) return { label: "Tomorrow", tone: "caution" };
  if (days <= 7) return { label: `in ${days} days`, tone: "caution" };
  return { label: `in ${days} days`, tone: "success" };
}

export function formatDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  // Fixed locale so server and browser render the same text.
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
