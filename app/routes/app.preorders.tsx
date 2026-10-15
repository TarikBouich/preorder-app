import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  activateProduct,
  deactivateProduct,
  listPreorderProducts,
} from "../preorder.server";
import { ACTIVE_TAG, INACTIVE_TAG, numericId, preorderStatus } from "../preorder";
import type { ProductWithVariants } from "../preorder";
import { AppLink, Pager, ProductThumb, StatusBadge } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const products = await listPreorderProducts(admin, {
    after: url.searchParams.get("after"),
    before: url.searchParams.get("before"),
  });
  return { products };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("productId"));
  try {
    if (form.get("intent") === "activate") {
      await activateProduct(admin, id);
      return { ok: true, message: "Pre-order activated" };
    }
    await deactivateProduct(admin, id);
    return { ok: true, message: "Pre-order deactivated" };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
};

export default function PreordersPage() {
  const { products } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  return (
    <s-page heading="Pre-orders">
      <s-section>
        <s-paragraph>
          Products tagged <s-text type="strong">{ACTIVE_TAG}</s-text> (active)
          or <s-text type="strong">{INACTIVE_TAG}</s-text> (inactive).
          Deactivating switches every <s-text type="strong">_tag:true</s-text>{" "}
          to <s-text type="strong">:false</s-text> and turns off Is Pre-Order on
          the variants. Ship dates are kept, so activating turns those variants
          back on.
        </s-paragraph>
      </s-section>

      <s-section padding="none">
        <s-table variant="auto" loading={navigation.state === "loading"}>
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header>Pre-order variants</s-table-header>
            <s-table-header>Tags</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {products.nodes.map((product) => (
              <PreorderRow key={product.id} product={product} />
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      {products.nodes.length === 0 && (
        <s-section>
          <s-paragraph>
            No products are tagged {ACTIVE_TAG} or {INACTIVE_TAG} yet. Open a
            product from the Products page to set it up.
          </s-paragraph>
        </s-section>
      )}
      <Pager pageInfo={products.pageInfo} />
    </s-page>
  );
}

function PreorderRow({ product }: { product: ProductWithVariants }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const status = preorderStatus(product.tags);
  const preorderVariants = product.variants.filter(
    (v) => v.isPreorder || v.shipDate,
  );
  const hiddenCount = (product.variantsCount?.count ?? 0) - product.variants.length;

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
        <s-stack direction="inline" gap="small" alignItems="center">
          <ProductThumb product={product} />
          <AppLink to={`/app/products/${numericId(product.id)}`}>
            {product.title}
          </AppLink>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <StatusBadge status={status} />
      </s-table-cell>
      <s-table-cell>
        <s-stack gap="small-300">
          {preorderVariants.length === 0 && <s-text color="subdued">None</s-text>}
          {preorderVariants.map((v) => (
            <s-text key={v.id} color={v.isPreorder ? "base" : "subdued"}>
              {v.title} · {v.isPreorder ? "on" : "off"}
              {v.shipDate ? ` · ships ${v.shipDate}` : ""}
            </s-text>
          ))}
          {hiddenCount > 0 && (
            <s-text color="subdued">+{hiddenCount} more variants (open product)</s-text>
          )}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-text color="subdued">
          {product.tags.filter((t) => t.startsWith("_")).join(", ")}
        </s-text>
      </s-table-cell>
      <s-table-cell>
        {status === "active" ? (
          <s-button
            tone="critical"
            loading={fetcher.state !== "idle"}
            onClick={() => submit("deactivate")}
          >
            Deactivate
          </s-button>
        ) : (
          <s-button loading={fetcher.state !== "idle"} onClick={() => submit("activate")}>
            Activate
          </s-button>
        )}
      </s-table-cell>
    </s-table-row>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
