import { useCallback, useEffect, useRef, useState } from "react";
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
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getPreorderCounts,
  listProducts,
  saveVariantsAndSync,
} from "../preorder.server";
import type { VariantUpdate } from "../preorder.server";
import { numericId, parseStatusFilter, preorderStatus } from "../preorder";
import type { ProductSummary, StatusFilter, Variant } from "../preorder";
import type { loader as productLoader } from "./app.products.$id";
import {
  EmptyState,
  Pager,
  ProductThumb,
  ShipDateHint,
  StatCard,
  StatGrid,
  StatusBadge,
  StockBadge,
  TagChips,
  useElementEvent,
} from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = parseStatusFilter(url.searchParams.get("status"));
  const [products, counts] = await Promise.all([
    listProducts(admin, {
      search: url.searchParams.get("q"),
      status,
      after: url.searchParams.get("after"),
      before: url.searchParams.get("before"),
    }),
    getPreorderCounts(admin),
  ]);
  return { products, counts, status };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const updates = JSON.parse(
    String(form.get("updates") ?? "[]"),
  ) as VariantUpdate[];

  if (updates.some((u) => u.isPreorder && !u.shipDate)) {
    return {
      ok: false,
      message: "Pick a ship date for every pre-order variant",
    };
  }
  try {
    await saveVariantsAndSync(admin, updates);
    return {
      ok: true,
      message: `Saved ${updates.length} variant${updates.length === 1 ? "" : "s"}`,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
};

// Unsaved variant edits, keyed by variant id.
type Change = {
  isPreorder: boolean;
  shipDate: string;
  label: string; // "Product / Variant", for the missing-date banner
  productId: string;
};
type Changes = Record<string, Change>;
type SavedValues = Record<string, { isPreorder: boolean; shipDate: string }>;

const SAVE_BAR_ID = "variants-save-bar";

export default function ProductsPage() {
  const { products, counts, status } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const notOnPreorder = Math.max(
    counts.total - counts.active - counts.inactive,
    0,
  );
  const share = (n: number) => (counts.total ? n / counts.total : 0);

  const setStatus = (next: StatusFilter) => {
    const nextParams = new URLSearchParams(params);
    nextParams.delete("after");
    nextParams.delete("before");
    if (next === "all" || next === status) nextParams.delete("status");
    else nextParams.set("status", next);
    setParams(nextParams, { replace: true });
  };
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [changes, setChanges] = useState<Changes>({});
  // Bumped on Discard/Save so the variant rows re-mount with their saved values.
  const [resetKey, setResetKey] = useState(0);
  // Values saved from this page. The variant data was loaded before the save,
  // so these take priority when showing what's stored in Shopify.
  const [savedValues, setSavedValues] = useState<SavedValues>({});
  const [submitted, setSubmitted] = useState<Changes>({});

  const changed = Object.entries(changes);
  const missingDate = changed.filter(([, c]) => c.isPreorder && !c.shipDate);
  const saving = fetcher.state !== "idle";

  const updateChange = useCallback(
    (variant: Variant, change: Change | null) => {
      setChanges((current) => {
        const next = { ...current };
        if (change) next[variant.id] = change;
        else delete next[variant.id];
        return next;
      });
    },
    [],
  );

  const save = () => {
    if (missingDate.length) return;
    const updates: VariantUpdate[] = changed.map(([id, c]) => ({
      id,
      isPreorder: c.isPreorder,
      shipDate: c.shipDate || null,
    }));
    setSubmitted(changes);
    fetcher.submit({ updates: JSON.stringify(updates) }, { method: "post" });
  };

  const discard = () => {
    setChanges({});
    setResetKey((k) => k + 1);
  };

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.state, fetcher.data, shopify]);

  // A successful save makes the fresh loader data the new baseline.
  const [handledSave, setHandledSave] = useState<unknown>(null);
  if (
    fetcher.state === "idle" &&
    fetcher.data?.ok &&
    handledSave !== fetcher.data
  ) {
    setHandledSave(fetcher.data);
    setSavedValues((current) => {
      const next = { ...current };
      for (const [id, c] of Object.entries(submitted)) {
        next[id] = { isPreorder: c.isPreorder, shipDate: c.shipDate };
      }
      return next;
    });
    setChanges({});
    setResetKey((k) => k + 1);
  }

  return (
    <s-page heading="Pre-order manager">
      <s-button
        slot="secondary-actions"
        icon="calendar"
        onClick={() => navigate("/app/preorders")}
      >
        View pre-orders
      </s-button>

      <SaveBar id={SAVE_BAR_ID} open={changed.length > 0}>
        <button
          variant="primary"
          onClick={save}
          disabled={missingDate.length > 0}
          loading={saving ? "" : undefined}
        />
        <button onClick={discard} disabled={saving} />
      </SaveBar>

      {missingDate.length > 0 && (
        <s-banner tone="warning" heading="Ship date missing">
          <s-paragraph>
            Pick a ship date for these pre-order variants before saving:
          </s-paragraph>
          <s-unordered-list>
            {missingDate.map(([id, c]) => (
              <s-list-item key={id}>{c.label}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <StatGrid>
        <StatCard
          label="All products"
          value={counts.total}
          icon="product"
          selected={status === "all"}
          caption="Your whole catalog"
          onClick={() => setStatus("all")}
        />
        <StatCard
          label="Pre-order active"
          value={counts.active}
          icon="calendar-check"
          tone="success"
          selected={status === "active"}
          share={share(counts.active)}
          onClick={() => setStatus("active")}
        />
        <StatCard
          label="Inactive"
          value={counts.inactive}
          icon="pause-circle"
          tone="neutral"
          selected={status === "inactive"}
          share={share(counts.inactive)}
          onClick={() => setStatus("inactive")}
        />
        <StatCard
          label="Not on pre-order"
          value={notOnPreorder}
          icon="circle-dashed"
          tone="info"
          selected={status === "none"}
          share={share(notOnPreorder)}
          onClick={() => setStatus("none")}
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
            <s-box inlineSize="100%" maxInlineSize="480px">
              <SearchBox />
            </s-box>
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
            <s-table-header listSlot="inline">Pre-order</s-table-header>
            <s-table-header>Ship date</s-table-header>
            <s-table-header>Inventory</s-table-header>
            <s-table-header>Tags</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {products.nodes.map((product) => (
              <ProductRows
                key={product.id}
                product={product}
                changes={changes}
                savedValues={savedValues}
                resetKey={resetKey}
                onChange={updateChange}
              />
            ))}
          </s-table-body>
        </s-table>
        {products.nodes.length === 0 && (
          <EmptyState icon="search" heading="No products found">
            <s-text color="subdued">
              Try a different search
              {status !== "all" ? " or clear the filter" : ""}.
            </s-text>
          </EmptyState>
        )}
      </s-section>
      <Pager pageInfo={products.pageInfo} />
    </s-page>
  );
}

// Filters the product list while typing (after a short pause).
function SearchBox() {
  const [params, setParams] = useSearchParams();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const ref = useElementEvent<"s-search-field">(
    "input",
    useCallback(
      (el) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const query = el.value.trim();
          if (query === (params.get("q") ?? "")) return;
          const next = new URLSearchParams(params);
          next.delete("after");
          next.delete("before");
          if (query) next.set("q", query);
          else next.delete("q");
          setParams(next, { replace: true });
        }, 300);
      },
      [params, setParams],
    ),
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <s-search-field
      ref={ref}
      label="Search products"
      labelAccessibilityVisibility="exclusive"
      placeholder="Search by title, SKU, tag…"
      defaultValue={params.get("q") ?? ""}
    />
  );
}

// A product row that expands to show its variants right underneath.
// Variants are fetched from the product page's loader the first time it opens.
function ProductRows({
  product,
  changes,
  savedValues,
  resetKey,
  onChange,
}: {
  product: ProductSummary;
  changes: Changes;
  savedValues: SavedValues;
  resetKey: number;
  onChange: (variant: Variant, change: Change | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<typeof productLoader>();
  const navigate = useNavigate();
  const productUrl = `/app/products/${numericId(product.id)}`;
  const variants = fetcher.data?.product.variants;
  const unsaved = Object.values(changes).filter(
    (c) => c.productId === product.id,
  ).length;

  const toggle = () => {
    if (!open && !fetcher.data && fetcher.state === "idle")
      fetcher.load(productUrl);
    setOpen(!open);
  };

  return (
    <>
      <s-table-row>
        <s-table-cell>
          <s-clickable
            onClick={toggle}
            accessibilityLabel={`Show variants of ${product.title}`}
          >
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-icon
                type={open ? "chevron-down" : "chevron-right"}
                color="subdued"
              />
              <ProductThumb product={product} />
              <s-stack gap="small-500">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text type="strong">{product.title}</s-text>
                  {product.status && product.status !== "ACTIVE" && (
                    <s-badge size="base">
                      {product.status.toLowerCase()}
                    </s-badge>
                  )}
                  {unsaved > 0 && (
                    <s-badge tone="caution">{unsaved} unsaved</s-badge>
                  )}
                </s-stack>
                <s-text color="subdued">
                  {open
                    ? "Hide variants"
                    : `${product.variantsCount?.count ?? 0} variants · click to manage`}
                </s-text>
              </s-stack>
            </s-stack>
          </s-clickable>
        </s-table-cell>
        <s-table-cell>
          <StatusBadge status={preorderStatus(product.tags)} />
        </s-table-cell>
        <s-table-cell></s-table-cell>
        <s-table-cell>
          <s-text color="subdued">
            {product.variantsCount?.count ?? 0} variants
          </s-text>
        </s-table-cell>
        <s-table-cell>
          <TagChips tags={product.tags} />
        </s-table-cell>
        <s-table-cell>
          <s-button
            variant="tertiary"
            icon="edit"
            accessibilityLabel={`Edit ${product.title}`}
            onClick={() => navigate(productUrl)}
          />
        </s-table-cell>
      </s-table-row>

      {open && !variants && (
        <s-table-row>
          <s-table-cell>
            <s-stack
              direction="inline"
              gap="small"
              alignItems="center"
              paddingInlineStart="large-200"
            >
              <s-spinner size="base" accessibilityLabel="Loading variants" />
              <s-text color="subdued">Loading variants…</s-text>
            </s-stack>
          </s-table-cell>
          <s-table-cell></s-table-cell>
          <s-table-cell></s-table-cell>
          <s-table-cell></s-table-cell>
          <s-table-cell></s-table-cell>
          <s-table-cell></s-table-cell>
        </s-table-row>
      )}

      {open &&
        variants?.map((variant) => (
          <VariantRow
            key={`${variant.id}-${resetKey}`}
            product={product}
            variant={variant}
            saved={
              savedValues[variant.id] ?? {
                isPreorder: variant.isPreorder,
                // Off variants show no date, even if an old one is stored.
                shipDate: variant.isPreorder ? (variant.shipDate ?? "") : "",
              }
            }
            change={changes[variant.id]}
            onChange={onChange}
          />
        ))}
    </>
  );
}

// A variant row with an on/off switch and a ship date picker. Edits are
// reported up to the page, which saves them all at once from the save bar.
function VariantRow({
  product,
  variant,
  saved,
  change,
  onChange,
}: {
  product: ProductSummary;
  variant: Variant;
  saved: { isPreorder: boolean; shipDate: string };
  change: Change | undefined;
  onChange: (variant: Variant, change: Change | null) => void;
}) {
  const current = change ?? saved;
  const needsDate = current.isPreorder && !current.shipDate;

  const report = useCallback(
    (next: { isPreorder: boolean; shipDate: string }) => {
      const isSaved =
        next.isPreorder === saved.isPreorder &&
        next.shipDate === saved.shipDate;
      onChange(
        variant,
        isSaved
          ? null
          : {
              ...next,
              label: `${product.title} / ${variant.title}`,
              productId: product.id,
            },
      );
    },
    [
      onChange,
      variant,
      saved.isPreorder,
      saved.shipDate,
      product.title,
      product.id,
    ],
  );

  const dateRef = useElementEvent<"s-date-field">(
    "change",
    useCallback(
      (el) => report({ isPreorder: current.isPreorder, shipDate: el.value }),
      [report, current.isPreorder],
    ),
  );

  // Turning a variant off clears its ship date.
  const switchRef = useElementEvent<"s-switch">(
    "change",
    useCallback(
      (el) => {
        if (!el.checked && dateRef.current) dateRef.current.value = "";
        report({
          isPreorder: el.checked,
          shipDate: el.checked ? current.shipDate : "",
        });
      },
      [report, current.shipDate, dateRef],
    ),
  );

  return (
    <s-table-row>
      <s-table-cell>
        <s-box paddingInlineStart="large-500">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="variant" color="subdued" size="small" />
            <s-stack gap="small-500">
              <s-text>{variant.title}</s-text>
              <s-text color="subdued">
                {variant.sku ? `SKU ${variant.sku}` : "No SKU"}
              </s-text>
            </s-stack>
          </s-stack>
        </s-box>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-switch
            ref={switchRef}
            label="Pre-order"
            labelAccessibilityVisibility="exclusive"
            defaultChecked={current.isPreorder}
          />
          {change ? (
            <s-badge tone="caution">Unsaved</s-badge>
          ) : saved.isPreorder ? (
            <s-badge tone="success">Pre-order</s-badge>
          ) : (
            <s-badge tone="neutral">Off</s-badge>
          )}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-date-field
          ref={dateRef}
          label="Ship date"
          labelAccessibilityVisibility="exclusive"
          placeholder="Pick a date"
          defaultValue={current.shipDate}
          disabled={!current.isPreorder}
          error={needsDate ? "Ship date required" : undefined}
        />
        {current.isPreorder && current.shipDate && (
          <ShipDateHint date={current.shipDate} />
        )}
      </s-table-cell>
      <s-table-cell>
        <StockBadge quantity={variant.inventoryQuantity} />
      </s-table-cell>
      <s-table-cell></s-table-cell>
      <s-table-cell></s-table-cell>
    </s-table-row>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
