"use client";

import type {
  GraphSearchResult,
  SearchScope,
} from "@cs/page-logic-visualizer/client";

const KIND_LABELS: Record<GraphSearchResult["kind"], string> = {
  api: "API",
  component: "Component",
  event: "Event",
  file: "File",
  hook: "Hook",
  package: "Package",
  route: "Route",
  variable: "Variable",
};

interface SearchResultsProps {
  results: GraphSearchResult[];
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
  onSelect: (result: GraphSearchResult) => void;
}

export function SearchResults({
  results,
  scope,
  onScopeChange,
  onSelect,
}: SearchResultsProps) {
  return (
    <div className="absolute top-full z-30 mt-1 w-full min-w-[20rem] rounded-lg border bg-popover shadow-lg">
      <div className="flex flex-wrap gap-1 border-b p-2">
        {(
          [
            "all",
            "routes",
            "components",
            "hooks",
            "variables",
            "apis",
            "events",
            "files",
            "packages",
          ] as SearchScope[]
        ).map((item) => (
          <button
            className={[
              "rounded px-2 py-0.5 text-[10px] capitalize",
              scope === item
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground",
            ].join(" ")}
            key={item}
            onClick={() => onScopeChange(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
      {results.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">No results</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto">
          {results.map((result) => (
            <li key={result.id}>
              <button
                className="flex w-full items-start gap-2 px-3 py-2 text-start text-xs hover:bg-muted/60"
                onClick={() => onSelect(result)}
                type="button"
              >
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  {KIND_LABELS[result.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{result.label}</span>
                  {result.detail ? (
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                      {result.detail}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
