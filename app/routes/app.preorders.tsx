import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  deactivateProduct,
  getPreorderCounts,
  listPreorderProducts,
} from "../preorder.server";
import {
  ACTIVE_TAG,
  INACTIVE_TAG,
  formatDate,
  numericId,
  preorderStatus,
  shipDateHint,
} from "../preorder";
import type { ProductWithVariants } from "../preorder";
import {
  EmptyState,
  Pager,
  ProductThumb,
  StatCard,
  StatGrid,
  StatusBadge,
  TagChips,
} from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const param = url.searchParams.get("status");
  const status = param === "active" || param === "inactive" ? param : undefined;
  const [products, counts] = await Promise.all([
    listPreorderProducts(admin, {
      status,
      after: url.searchParams.get("after"),
      before: url.searchParams.get("before"),
    }),
    getPreorderCounts(admin),
  ]);
  return { products, counts, status: status ?? "all" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("productId"));
  try {
    await deactivateProduct(admin, id);
    return { ok: true, message: "Pre-order deactivated" };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
};

export default function PreordersPage() {
  const { products, counts, status } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const setStatus = (next: "all" | "active" | "inactive") => {
    const nextParams = new URLSearchParams(params);
    nextParams.delete("after");
    nextParams.delete("before");
    if (next === "all" || next === status) nextParams.delete("status");
    else nextParams.set("status", next);
    setParams(nextParams, { replace: true });
  };

  const preorderTotal = counts.active + counts.inactive;

  // Soonest upcoming ship date among the pre-order variants on this page.
  const today = new Date().toISOString().slice(0, 10);
  const nextShipDate = products.nodes
    .flatMap((p) => p.variants)
    .filter((v) => v.isPreorder && v.shipDate && v.shipDate >= today)
    .map((v) => v.shipDate!)
    .sort()[0];

  return (
    <s-page heading="Pre-orders">
      <s-button
        slot="secondary-actions"
        icon="product"
        onClick={() => navigate("/app")}
      >
        Manage products
      </s-button>

      <StatGrid columns={3}>
        <StatCard
          label="Pre-order active"
          value={counts.active}
          icon="calendar-check"
          tone="success"
          selected={status === "active"}
          share={preorderTotal ? counts.active / preorderTotal : 0}
          onClick={() => setStatus("active")}
        />
        <StatCard
          label="Inactive"
          value={counts.inactive}
          icon="pause-circle"
          tone="neutral"
          selected={status === "inactive"}
          share={preorderTotal ? counts.inactive / preorderTotal : 0}
          onClick={() => setStatus("inactive")}
        />
        <StatCard
          label="Next shipment"
          value={nextShipDate ? formatDate(nextShipDate) : "—"}
          icon="delivery"
          tone="info"
          caption={
            nextShipDate
              ? (shipDateHint(nextShipDate)?.label ?? "")
              : "No upcoming ship dates"
          }
        />
      </StatGrid>

      <s-section padding="none">
        <s-table variant="auto" loading={navigation.state === "loading"}>
          <s-stack
            slot="filters"
            direction="inline"
            gap="small"
            alignItems="center"
          >
            <s-text color="subdued">
              Showing{" "}
              {status === "active"
                ? "active pre-orders"
                : status === "inactive"
                  ? "inactive pre-orders"
                  : "all pre-order products"}
            </s-text>
            {status !== "all" && (
              <s-button
                variant="tertiary"
                icon="x"
                onClick={() => setStatus("all")}
              >
                Clear filter
              </s-button>
            )}
          </s-stack>
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header>Variants on pre-order</s-table-header>
            <s-table-header>Tags</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {products.nodes.map((product) => (
              <PreorderRow key={product.id} product={product} />
            ))}
          </s-table-body>
        </s-table>
        {products.nodes.length === 0 && (
          <EmptyState icon="calendar" heading="No pre-orders yet">
            <s-text color="subdued">
              Products tagged {ACTIVE_TAG} or {INACTIVE_TAG} show up here.
            </s-text>
            <s-button onClick={() => navigate("/app")}>
              Set up a product
            </s-button>
          </EmptyState>
        )}
      </s-section>

      <Pager pageInfo={products.pageInfo} />

      <s-section heading="How it works">
        <s-unordered-list>
          <s-list-item>
            Turning on a variant with a ship date makes the product{" "}
            <s-text type="strong">active</s-text> ({ACTIVE_TAG}).
          </s-list-item>
          <s-list-item>
            Turning a variant off clears its ship date. When the last variant is
            off, the tags switch to <s-text type="strong">:false</s-text>.
          </s-list-item>
          <s-list-item>
            <s-text type="strong">Deactivate</s-text> turns off every variant at
            once. Use <s-text type="strong">Set up</s-text> to pick variants and
            dates again.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

function PreorderRow({ product }: { product: ProductWithVariants }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const status = preorderStatus(product.tags);
  const preorderVariants = product.variants.filter(
    (v) => v.isPreorder,
  );
  const hiddenCount =
    (product.variantsCount?.count ?? 0) - product.variants.length;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  const submit = (intent: string) =>
    fetcher.submit({ intent, productId: product.id }, { method: "post" });

  return (
    <s-table-row>
      <s-table-cell>
        <s-clickable
          onClick={() => navigate(`/app/products/${numericId(product.id)}`)}
          accessibilityLabel={`Open ${product.title}`}
        >
          <s-stack direction="inline" gap="small" alignItems="center">
            <ProductThumb product={product} />
            <s-stack gap="small-500">
              <s-text type="strong">{product.title}</s-text>
              <s-text color="subdued">
                {preorderVariants.filter((v) => v.isPreorder).length} of{" "}
                {product.variantsCount?.count ?? 0} variants on pre-order
              </s-text>
            </s-stack>
          </s-stack>
        </s-clickable>
      </s-table-cell>
      <s-table-cell>
        <StatusBadge status={status} />
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small-200">
          {preorderVariants.length === 0 && (
            <s-text color="subdued">None</s-text>
          )}
          {preorderVariants.map((v) => {
            const hint = v.isPreorder ? shipDateHint(v.shipDate) : null;
            return (
              <s-stack
                key={v.id}
                direction="inline"
                gap="small-200"
                alignItems="center"
              >
                <s-text color={v.isPreorder ? "base" : "subdued"}>
                  {v.title}
                </s-text>
                {v.shipDate && (
                  <s-text color="subdued">· {formatDate(v.shipDate)}</s-text>
                )}
                {hint ? (
                  <s-badge tone={hint.tone}>{hint.label}</s-badge>
                ) : (
                  <s-badge tone="neutral">Off</s-badge>
                )}
              </s-stack>
            );
          })}
          {hiddenCount > 0 && (
            <s-text color="subdued">+{hiddenCount} more variants</s-text>
          )}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <TagChips tags={product.tags} />
      </s-table-cell>
      <s-table-cell>
        {status === "active" ? (
          <s-button
            tone="critical"
            variant="secondary"
            icon="pause-circle"
            loading={busy}
            onClick={() => submit("deactivate")}
          >
            Deactivate
          </s-button>
        ) : (
          <s-button
            variant="primary"
            icon="edit"
            onClick={() => navigate(`/app/products/${numericId(product.id)}`)}
          >
            Set up
          </s-button>
        )}
      </s-table-cell>
    </s-table-row>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
