import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { shipDateHint, formatDate } from "../preorder";
import type { PageInfo, PreorderStatus, ProductSummary } from "../preorder";

type IconName = React.ComponentProps<"s-icon">["type"];

export function StatusBadge({ status }: { status: PreorderStatus }) {
  if (status === "active") {
    return (
      <s-badge tone="success" icon="calendar-check">
        Pre-order active
      </s-badge>
    );
  }
  if (status === "inactive") {
    return (
      <s-badge tone="neutral" icon="pause-circle">
        Inactive
      </s-badge>
    );
  }
  return <s-text color="subdued">—</s-text>;
}

export function StatGrid({
  columns = 4,
  children,
}: {
  columns?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="pn-stat-grid"
      style={{ "--columns": columns } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

// A dashboard metric card; acts as a filter button when `onClick` is set.
// `share` (0–1) draws a progress bar; `caption` replaces it with text.
export function StatCard({
  label,
  value,
  icon,
  tone = "accent",
  selected,
  share,
  caption,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: IconName;
  tone?: "accent" | "success" | "caution" | "critical" | "neutral" | "info";
  selected?: boolean;
  share?: number;
  caption?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="pn-stat-header">
        <span className="pn-stat-icon">
          <s-icon type={icon} tone={tone === "accent" ? undefined : tone} />
        </span>
        {selected && (
          <span className="pn-stat-check" aria-hidden="true">
            ✓
          </span>
        )}
      </div>
      <div className="pn-stat-body">
        <span className="pn-metric">{value}</span>
        <span className="pn-stat-label">{label}</span>
      </div>
      {share !== undefined ? (
        <div className="pn-stat-footer">
          <div className="pn-stat-bar">
            <div
              className="pn-stat-bar-fill"
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </div>
          <span>{Math.round(share * 100)}%</span>
        </div>
      ) : caption ? (
        <div className="pn-stat-footer">{caption}</div>
      ) : null}
    </>
  );

  const props = {
    className: "pn-stat-card",
    "data-tone": tone,
    "data-selected": selected ? "true" : "false",
  };

  if (!onClick) return <div {...props}>{content}</div>;
  return (
    <button type="button" {...props} aria-pressed={selected} onClick={onClick}>
      {content}
    </button>
  );
}

// Formatted ship date with a coloured "in 12 days" / "Overdue" hint.
export function ShipDate({ date }: { date: string | null }) {
  const hint = shipDateHint(date);
  if (!date || !hint) return <s-text color="subdued">No date</s-text>;
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-text>{formatDate(date)}</s-text>
      <s-badge tone={hint.tone} size="base">
        {hint.label}
      </s-badge>
    </s-stack>
  );
}

export function ShipDateHint({ date }: { date: string }) {
  const hint = shipDateHint(date);
  if (!hint) return null;
  return <s-text tone={hint.tone}>{hint.label}</s-text>;
}

export function StockBadge({ quantity }: { quantity: number | null }) {
  if (quantity === null) return <s-text color="subdued">—</s-text>;
  if (quantity <= 0) return <s-badge tone="critical">Out of stock</s-badge>;
  if (quantity <= 5) return <s-badge tone="caution">Low · {quantity}</s-badge>;
  return <s-text>{quantity} in stock</s-text>;
}

// Pre-order (underscore) tags as chips; other tags summarised as "+N".
export function TagChips({ tags }: { tags: string[] }) {
  const system = tags.filter((t) => t.startsWith("_"));
  const others = tags.length - system.length;
  if (!tags.length) return <s-text color="subdued">No tags</s-text>;
  return (
    <s-stack direction="inline" gap="small-300" alignItems="center">
      {system.map((tag) => (
        <s-chip key={tag} color={tag.endsWith(":true") ? "strong" : "base"}>
          {tag}
        </s-chip>
      ))}
      {others > 0 && (
        <s-text color="subdued">
          +{others} tag{others === 1 ? "" : "s"}
        </s-text>
      )}
    </s-stack>
  );
}

export function EmptyState({
  icon,
  heading,
  children,
}: {
  icon: IconName;
  heading: string;
  children?: React.ReactNode;
}) {
  return (
    <s-box padding="large-400">
      <s-stack gap="base" alignItems="center">
        <s-box padding="base" borderRadius="large-200" background="subdued">
          <s-icon type={icon} />
        </s-box>
        <s-heading>{heading}</s-heading>
        {children}
      </s-stack>
    </s-box>
  );
}

export function ProductThumb({ product }: { product: ProductSummary }) {
  const image = product.featuredMedia?.preview?.image;
  return (
    <s-thumbnail
      size="small"
      src={image?.url ?? ""}
      alt={image?.altText ?? product.title}
    />
  );
}

// An in-app link that navigates client-side (keeps the embedded session).
export function AppLink({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <s-link
      href={to}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </s-link>
  );
}

export function Pager({ pageInfo }: { pageInfo: PageInfo }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const go = (key: "after" | "before", cursor: string) => {
    const next = new URLSearchParams(params);
    next.delete("after");
    next.delete("before");
    next.set(key, cursor);
    navigate(`?${next.toString()}`);
  };

  if (!pageInfo.hasNextPage && !pageInfo.hasPreviousPage) return null;

  return (
    <s-stack direction="inline" gap="base" justifyContent="center">
      <s-button
        icon="chevron-left"
        disabled={!pageInfo.hasPreviousPage}
        onClick={() =>
          pageInfo.startCursor && go("before", pageInfo.startCursor)
        }
      >
        Previous
      </s-button>
      <s-button
        icon="chevron-right"
        disabled={!pageInfo.hasNextPage}
        onClick={() => pageInfo.endCursor && go("after", pageInfo.endCursor)}
      >
        Next
      </s-button>
    </s-stack>
  );
}

// Listens for a DOM event on a Polaris web component. React 18 doesn't wire
// `onChange` props to custom elements, so we attach the listener ourselves.
export function useElementEvent<K extends keyof HTMLElementTagNameMap>(
  type: string,
  handler: (element: HTMLElementTagNameMap[K]) => void,
) {
  const ref = useRef<HTMLElementTagNameMap[K]>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = () => handler(element);
    element.addEventListener(type, listener);
    return () => element.removeEventListener(type, listener);
  }, [type, handler]);
  return ref;
}
