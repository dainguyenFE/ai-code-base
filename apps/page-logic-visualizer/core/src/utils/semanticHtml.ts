/** Tags that carry document/layout meaning — shown in UI tree (not collapsed). */
export const SEMANTIC_HTML_REGISTRY = {
  content: [
    "p",
    "blockquote",
    "hr",
    "address",
    "pre",
    "figure",
    "figcaption",
    "details",
    "summary",
    "datalist",
  ],
  "form-control": [
    "form",
    "fieldset",
    "legend",
    "label",
    "button",
    "input",
    "textarea",
    "select",
    "option",
    "optgroup",
    "output",
    "meter",
    "progress",
  ],
  heading: ["h1", "h2", "h3", "h4", "h5", "h6"],
  landmark: ["main", "header", "footer", "nav", "aside"],
  list: ["ul", "ol", "li", "dl", "dt", "dd", "menu"],
  media: [
    "img",
    "picture",
    "source",
    "video",
    "audio",
    "track",
    "canvas",
    "svg",
    "iframe",
    "embed",
    "object",
  ],
  region: ["section", "article", "dialog", "search", "form"],
  table: [
    "table",
    "caption",
    "colgroup",
    "col",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
  ],
} as const;

export type SemanticHtmlTier = keyof typeof SEMANTIC_HTML_REGISTRY;

export const HTML_LAYOUT_WRAPPER_TAGS = ["div", "span"] as const;

const SEMANTIC_TAG_SET = new Set(Object.values(SEMANTIC_HTML_REGISTRY).flat());

export const DEFAULT_INCLUDE_HTML_TAGS = [...SEMANTIC_TAG_SET] as string[];

export const isSemanticHtmlTag = (tagName: string): boolean =>
  SEMANTIC_TAG_SET.has(tagName.toLowerCase());

export const isHtmlLayoutWrapperTag = (tagName: string): boolean => {
  const tag = tagName.toLowerCase();
  return (HTML_LAYOUT_WRAPPER_TAGS as readonly string[]).includes(tag);
};

export const semanticTierForTag = (
  tagName: string
): SemanticHtmlTier | undefined => {
  const tag = tagName.toLowerCase();
  for (const [tier, tags] of Object.entries(SEMANTIC_HTML_REGISTRY)) {
    if ((tags as readonly string[]).includes(tag)) {
      return tier as SemanticHtmlTier;
    }
  }
  return undefined;
};

export const htmlTagFromNodeLabel = (label: string): string | undefined => {
  const match = label.match(/^<([a-z][\w-]*)>$/i);
  return match?.[1]?.toLowerCase();
};
