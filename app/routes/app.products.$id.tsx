import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  addTags,
  deactivateProduct,
  getProduct,
  removeTags,
  saveVariantsAndSync,
} from "../preorder.server";
import {
  ACTIVE_TAG,
  formatDate,
  preorderStatus,
  productGid,
} from "../preorder";
import type { Variant } from "../preorder";
import {
  ProductThumb,
  ShipDateHint,
  StatusBadge,
  StockBadge,
} from "../components/ui";

const SUGGESTED_TAGS = [ACTIVE_TAG, "_status:pre-order"];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const product = await getProduct(admin, productGid(params.id!));
  if (!product) throw new Response("Product not found", { status: 404 });
  return { product };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const id = productGid(params.id!);
  const form = await request.formData();
  const intent = form.get("intent");

  try {
    switch (intent) {
      case "addTags": {
        const tags = String(form.get("tags") ?? "")
          .split(/[,\n]/)
          .map((t) => t.trim())
          .filter(Boolean);
        if (!tags.length)
          return { ok: false, message: "Type at least one tag" };
        await addTags(admin, id, tags);
        return { ok: true, message: `Added ${tags.join(", ")}` };
      }
      case "removeTag": {
        const tag = String(form.get("tag"));
        await removeTags(admin, id, [tag]);
        return { ok: true, message: `Removed ${tag}` };
      }
      case "saveVariants": {
        const updates = form.getAll("variantId").map((value) => {
          const variantId = String(value);
          return {
            id: variantId,
            isPreorder: form.has(`preorder:${variantId}`),
            shipDate: String(form.get(`shipDate:${variantId}`) ?? "") || null,
          };
        });
        const missing = updates.filter((u) => u.isPreorder && !u.shipDate);
        if (missing.length) {
          return {
            ok: false,
            message: "Pick a ship date for every pre-order variant",
          };
        }
        await saveVariantsAndSync(admin, updates);
        return { ok: true, message: "Variants saved" };
      }
      case "saveVariant": {
        const update = {
          id: String(form.get("variantId")),
          isPreorder: form.get("isPreorder") === "true",
          shipDate: String(form.get("shipDate") ?? "") || null,
        };
        if (update.isPreorder && !update.shipDate) {
          return { ok: false, message: "Pick a ship date before saving" };
        }
        await saveVariantsAndSync(admin, [update]);
        return {
          ok: true,
          message: "Variant saved",
          saved: {
            isPreorder: update.isPreorder,
            shipDate: update.shipDate ?? "",
          },
        };
      }
      case "deactivate":
        await deactivateProduct(admin, id);
        return { ok: true, message: "Pre-order deactivated" };
      default:
        return { ok: false, message: "Unknown action" };
    }
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
};

export default function ProductPage() {
  const { product } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const addTagsForm = useRef<HTMLFormElement>(null);

  const busyIntent =
    navigation.state === "submitting"
      ? navigation.formData?.get("intent")
      : null;
  const status = preorderStatus(product.tags);

  useEffect(() => {
    if (!result) return;
    shopify.toast.show(result.message, { isError: !result.ok });
    if (result.ok) addTagsForm.current?.reset();
  }, [result, shopify]);

  const run = (data: Record<string, string>) =>
    submit(data, { method: "post" });

  const onPreorder = product.variants.filter((v) => v.isPreorder);
  const nextShipDate = onPreorder
    .map((v) => v.shipDate)
    .filter((d): d is string => !!d)
    .sort()[0];

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app">
        Products
      </s-link>

      {status === "active" && (
        <s-button
          slot="primary-action"
          tone="critical"
          icon="pause-circle"
          loading={busyIntent === "deactivate"}
          onClick={() => run({ intent: "deactivate" })}
        >
          Deactivate pre-order
        </s-button>
      )}

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <ProductThumb product={product} />
          <s-stack gap="small-300">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-heading>{product.title}</s-heading>
              <StatusBadge status={status} />
            </s-stack>
            <s-text color="subdued">
              {onPreorder.length} of {product.variants.length} variants on
              pre-order
              {nextShipDate ? ` · first ships ${formatDate(nextShipDate)}` : ""}
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {status !== "active" && (
        <s-banner tone="info" heading="Not on pre-order">
          Tick a variant, pick its ship date and click Save variants — the
          product becomes active ({ACTIVE_TAG}) automatically.
        </s-banner>
      )}

      <s-section heading="Variants" padding="none">
        <Form method="post" key={variantsKey(product.variants)}>
          <input type="hidden" name="intent" value="saveVariants" />
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Variant</s-table-header>
              <s-table-header listSlot="inline">Pre-order</s-table-header>
              <s-table-header>Ship date</s-table-header>
              <s-table-header>Inventory</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {product.variants.map((variant) => (
                <s-table-row key={variant.id}>
                  <s-table-cell>
                    <input type="hidden" name="variantId" value={variant.id} />
                    <s-stack gap="small-500">
                      <s-text type="strong">{variant.title}</s-text>
                      <s-text color="subdued">
                        {variant.sku ? `SKU ${variant.sku}` : "No SKU"}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-checkbox
                      label="Pre-order"
                      name={`preorder:${variant.id}`}
                      defaultChecked={variant.isPreorder}
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-date-field
                        label="Ship date"
                        labelAccessibilityVisibility="exclusive"
                        placeholder="Pick a date"
                        name={`shipDate:${variant.id}`}
                        defaultValue={
                          variant.isPreorder ? (variant.shipDate ?? "") : ""
                        }
                      />
                      {variant.isPreorder && variant.shipDate && (
                        <ShipDateHint date={variant.shipDate} />
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <StockBadge quantity={variant.inventoryQuantity} />
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-box padding="base">
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text color="subdued">
                Pre-order variants need a ship date.
              </s-text>
              <s-button
                type="submit"
                variant="primary"
                loading={busyIntent === "saveVariants"}
              >
                Save variants
              </s-button>
            </s-stack>
          </s-box>
        </Form>
      </s-section>

      <s-section slot="aside" heading="Product tags">
        <s-stack gap="base">
          {product.tags.length ? (
            <s-stack direction="inline" gap="small-200">
              {product.tags.map((tag) => (
                <s-stack
                  key={tag}
                  direction="inline"
                  gap="none"
                  alignItems="center"
                >
                  <s-chip color={tag.startsWith("_") ? "strong" : "base"}>
                    {tag}
                  </s-chip>
                  <s-button
                    variant="tertiary"
                    icon="x"
                    accessibilityLabel={`Remove ${tag}`}
                    onClick={() => run({ intent: "removeTag", tag })}
                  />
                </s-stack>
              ))}
            </s-stack>
          ) : (
            <s-text color="subdued">This product has no tags.</s-text>
          )}

          <s-divider />

          <Form method="post" ref={addTagsForm}>
            <input type="hidden" name="intent" value="addTags" />
            <s-stack gap="small">
              <s-text-field
                label="Add tags"
                name="tags"
                placeholder="_pre_order:true, _status:pre-order"
                details="Separate multiple tags with commas."
              />
              <s-button
                type="submit"
                icon="plus"
                loading={busyIntent === "addTags"}
              >
                Add tags
              </s-button>
            </s-stack>
          </Form>

          {SUGGESTED_TAGS.some((t) => !product.tags.includes(t)) && (
            <s-stack gap="small-200">
              <s-text color="subdued">Quick add</s-text>
              <s-stack direction="inline" gap="small-200">
                {SUGGESTED_TAGS.filter((t) => !product.tags.includes(t)).map(
                  (tag) => (
                    <s-button
                      key={tag}
                      variant="secondary"
                      icon="plus"
                      onClick={() => run({ intent: "addTags", tags: tag })}
                    >
                      {tag}
                    </s-button>
                  ),
                )}
              </s-stack>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Theme metafields">
        <s-paragraph>
          <s-text color="subdued">
            Each variant stores{" "}
            <s-text type="strong">custom.is_pre_order</s-text> and{" "}
            <s-text type="strong">custom.pre_order_ship_date</s-text>, which
            your theme reads.
          </s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

// Re-mounts the variants form after a save so the fields show fresh values.
function variantsKey(variants: Variant[]) {
  return variants.map((v) => `${v.isPreorder}${v.shipDate}`).join("|");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
