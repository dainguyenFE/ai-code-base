const MAX_PROP_LABEL_LENGTH = 42;

function formatPassedProps(
  metadata: Record<string, unknown> | undefined
): string | undefined {
  const attributes = metadata?.attributes;
  if (!Array.isArray(attributes) || attributes.length === 0) {
    return metadata?.props as string | undefined;
  }

  return attributes
    .map((attr) => {
      const item = attr as { name: string; value: string };
      return `${item.name}=${item.value}`;
    })
    .join(", ");
}

function ellipsize(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

export function formatTraceEdgeLabel(edge: {
  type: string;
  label?: string;
  metadata?: Record<string, unknown>;
}): string {
  if (edge.label && edge.label !== edge.type.replaceAll("_", " ")) {
    return edge.label;
  }

  switch (edge.type) {
    case "renders":
    case "routes_to": {
      return "render";
    }
    case "wraps": {
      return "children";
    }
    case "shows_loading": {
      return "loading";
    }
    case "shows_error": {
      return "error";
    }
    case "shows_not_found": {
      return "404";
    }
    case "passes_prop": {
      const props = formatPassedProps(edge.metadata);
      if (!props) {
        return "pass props";
      }

      const label = `pass props: {${props}}`;
      return ellipsize(label, MAX_PROP_LABEL_LENGTH);
    }
    case "prop_source": {
      const prop = edge.metadata?.propName;
      return prop ? `→ ${String(prop)}` : "feeds prop";
    }
    case "uses_hook": {
      return "hook";
    }
    case "sequence": {
      if (edge.metadata?.order) {
        return `${edge.metadata.order}. ${String(edge.metadata.stepKind ?? "step")}`;
      }
      return "sequence";
    }
    default: {
      return edge.type.replaceAll("_", " ");
    }
  }
}
