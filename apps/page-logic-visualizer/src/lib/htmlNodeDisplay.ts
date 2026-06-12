import type { LogicGraphNode } from "@cs/page-logic-visualizer/client";

export interface HtmlDisplayBadge {
  label: string;
  tone: "list" | "array" | "table" | "item" | "tier" | "default";
}

export interface HtmlNodeDisplay {
  badges: HtmlDisplayBadge[];
  /** Inline on line 1 (e.g. array.map(item)) */
  primaryHint?: string;
  /** Line 2: quoted text or className */
  secondaryLine?: string;
}

const truncate = (value: string, max = 72): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const compactClassAttr = (node: LogicGraphNode): string | undefined => {
  const classProp = node.props?.find((prop) => prop.name === "className");
  if (!classProp) {
    return undefined;
  }
  const expr = classProp.expression.replaceAll(/^["']|["']$/g, "");
  return truncate(expr, 56);
};

export const resolveHtmlNodeDisplay = (
  node: LogicGraphNode,
  options?: { hasChildren?: boolean }
): HtmlNodeDisplay => {
  const meta = node.metadata ?? {};
  const tier =
    typeof meta.semanticTier === "string" ? meta.semanticTier : undefined;
  const renderKind =
    typeof meta.htmlRenderKind === "string" ? meta.htmlRenderKind : undefined;
  const listSource =
    typeof meta.htmlListSource === "string" ? meta.htmlListSource : undefined;
  const listItem =
    typeof meta.htmlListItem === "string" ? meta.htmlListItem : undefined;
  const textContent =
    typeof meta.htmlTextContent === "string" ? meta.htmlTextContent : undefined;
  const hasChildren = options?.hasChildren ?? false;

  const badges: HtmlDisplayBadge[] = [];

  if (tier) {
    badges.push({
      label: tier,
      tone: tier === "list" || tier === "table" ? tier : "tier",
    });
  }

  if (renderKind === "array-map") {
    badges.push({ label: "array", tone: "array" });
    if (listItem) {
      badges.push({ label: `item:${listItem}`, tone: "item" });
    }
  } else if (renderKind === "list-item") {
    badges.push({ label: "list-item", tone: "list" });
    if (listItem) {
      badges.push({ label: listItem, tone: "item" });
    }
  } else if (renderKind === "table-rows") {
    badges.push({ label: "array", tone: "array" });
    badges.push({ label: "rows", tone: "table" });
  } else if (renderKind === "table-row") {
    badges.push({ label: "row", tone: "table" });
    if (listItem) {
      badges.push({ label: listItem, tone: "item" });
    }
  }

  let primaryHint: string | undefined;
  let secondaryLine: string | undefined;

  if (renderKind === "array-map" || renderKind === "table-rows") {
    primaryHint = listItem
      ? truncate(`${listSource ?? "array"}.map(${listItem})`, 64)
      : listSource;
    secondaryLine = compactClassAttr(node);
  } else if (!hasChildren && textContent) {
    secondaryLine = `"${truncate(textContent, 88)}"`;
  } else {
    secondaryLine = compactClassAttr(node);
  }

  return { badges, primaryHint, secondaryLine };
};

export const HTML_BADGE_STYLES: Record<HtmlDisplayBadge["tone"], string> = {
  array: "border-violet-500/35 bg-violet-500/10 text-violet-800",
  default: "border-slate-500/35 bg-slate-500/10 text-slate-700",
  item: "border-amber-500/35 bg-amber-500/10 text-amber-800",
  list: "border-teal-500/35 bg-teal-500/10 text-teal-800",
  table: "border-cyan-500/35 bg-cyan-500/10 text-cyan-800",
  tier: "border-slate-500/25 bg-muted/50 text-muted-foreground",
};
