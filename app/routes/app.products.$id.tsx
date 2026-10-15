import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  activateProduct,
  addTags,
  deactivateProduct,
  getProduct,
  removeTags,
  saveVariants,
} from "../preorder.server";
import { ACTIVE_TAG, preorderStatus, productGid } from "../preorder";
import type { Variant } from "../preorder";
import { ProductThumb, StatusBadge } from "../components/ui";

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
        if (!tags.length) return { ok: false, message: "Type at least one tag" };
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
          return { ok: false, message: "Pick a ship date for every pre-order variant" };
        }
        await saveVariants(admin, updates);
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
        await saveVariants(admin, [update]);
        return {
          ok: true,
          message: "Variant saved",
          saved: { isPreorder: update.isPreorder, shipDate: update.shipDate ?? "" },
        };
      }
      case "activate":
        await activateProduct(admin, id);
        return { ok: true, message: "Pre-order activated" };
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
    navigation.state === "submitting" ? navigation.formData?.get("intent") : null;
  const status = preorderStatus(product.tags);

  useEffect(() => {
    if (!result) return;
    shopify.toast.show(result.message, { isError: !result.ok });
    if (result.ok) addTagsForm.current?.reset();
  }, [result, shopify]);

  const run = (data: Record<string, string>) => submit(data, { method: "post" });

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app">
        Products
      </s-link>

      {status === "active" ? (
        <s-button
          slot="primary-action"
          tone="critical"
          loading={busyIntent === "deactivate"}
          onClick={() => run({ intent: "deactivate" })}
        >
          Deactivate pre-order
        </s-button>
      ) : (
        <s-button
          slot="primary-action"
          loading={busyIntent === "activate"}
          onClick={() => run({ intent: "activate" })}
        >
          Activate pre-order
        </s-button>
      )}

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <ProductThumb product={product} />
          <s-heading>{product.title}</s-heading>
          <StatusBadge status={status} />
        </s-stack>
      </s-section>

      <s-section heading="Product tags">
        <s-stack gap="base">
          {product.tags.length ? (
            <s-stack direction="inline" gap="small">
              {product.tags.map((tag) => (
                <s-stack key={tag} direction="inline" gap="none" alignItems="center">
                  <s-chip>{tag}</s-chip>
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

          <Form method="post" ref={addTagsForm}>
            <input type="hidden" name="intent" value="addTags" />
            <s-stack gap="small">
              <s-text-field
                label="Add tags"
                name="tags"
                placeholder="_pre_order:true, _status:pre-order"
                details="Separate multiple tags with commas."
              />
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-button type="submit" loading={busyIntent === "addTags"}>
                  Add tags
                </s-button>
                <s-text color="subdued">Quick add:</s-text>
                {SUGGESTED_TAGS.filter((t) => !product.tags.includes(t)).map((tag) => (
                  <s-button
                    key={tag}
                    variant="secondary"
                    onClick={() => run({ intent: "addTags", tags: tag })}
                  >
                    {tag}
                  </s-button>
                ))}
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Variants" padding="none">
        <Form method="post" key={variantsKey(product.variants)}>
          <input type="hidden" name="intent" value="saveVariants" />
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Variant</s-table-header>
              <s-table-header>SKU</s-table-header>
              <s-table-header format="numeric">Stock</s-table-header>
              <s-table-header listSlot="inline">Is pre-order</s-table-header>
              <s-table-header>Pre-order ship date</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {product.variants.map((variant) => (
                <s-table-row key={variant.id}>
                  <s-table-cell>
                    <input type="hidden" name="variantId" value={variant.id} />
                    {variant.title}
                  </s-table-cell>
                  <s-table-cell>{variant.sku || "—"}</s-table-cell>
                  <s-table-cell>{variant.inventoryQuantity ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <s-checkbox
                      label="Pre-order"
                      name={`preorder:${variant.id}`}
                      defaultChecked={variant.isPreorder}
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-date-field
                      label="Ship date"
                      labelAccessibilityVisibility="exclusive"
                      name={`shipDate:${variant.id}`}
                      defaultValue={variant.shipDate ?? ""}
                    />
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-box padding="base">
            <s-button type="submit" variant="primary" loading={busyIntent === "saveVariants"}>
              Save variants
            </s-button>
          </s-box>
        </Form>
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
