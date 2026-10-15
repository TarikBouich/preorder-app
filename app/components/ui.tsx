import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { PageInfo, PreorderStatus, ProductSummary } from "../preorder";

export function StatusBadge({ status }: { status: PreorderStatus }) {
  if (status === "active") return <s-badge tone="success">Pre-order active</s-badge>;
  if (status === "inactive") return <s-badge tone="neutral">Pre-order inactive</s-badge>;
  return null;
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
export function AppLink({ to, children }: { to: string; children: React.ReactNode }) {
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
        onClick={() => pageInfo.startCursor && go("before", pageInfo.startCursor)}
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
