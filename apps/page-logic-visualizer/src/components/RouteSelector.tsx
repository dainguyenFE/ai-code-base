"use client";

export interface RouteEntry {
  route: string;
  pageFile: string;
  layouts: string[];
}

export type RouteTraceMode = "full" | "page-only" | "from-layout";

interface RouteSelectorProps {
  apps: string[];
  routes: RouteEntry[];
  selectedApp: string;
  selectedRoute: string;
  routeTraceMode: RouteTraceMode;
  layoutFile?: string;
  isLoading: boolean;
  onAppChange: (appDir: string) => void;
  onRouteChange: (route: string) => void;
  onRouteTraceModeChange: (mode: RouteTraceMode) => void;
  onLayoutFileChange: (filePath: string) => void;
  onEntryFileChange: (filePath: string) => void;
  onAnalyze: () => void;
}

const selectClass = "h-9 min-w-0 rounded-md border bg-background px-3 text-sm";

const analyzeButtonClass =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

export function RouteSelector({
  apps,
  routes,
  selectedApp,
  selectedRoute,
  routeTraceMode,
  layoutFile,
  isLoading,
  onAppChange,
  onRouteChange,
  onRouteTraceModeChange,
  onLayoutFileChange,
  onEntryFileChange,
  onAnalyze,
}: RouteSelectorProps) {
  const currentRoute = routes.find((item) => item.route === selectedRoute);
  const layoutOptions = currentRoute?.layouts ?? [];

  return (
    <>
      <select
        aria-label="App"
        className={`${selectClass} w-[140px]`}
        onChange={(event) => onAppChange(event.target.value)}
        value={apps.includes(selectedApp) ? selectedApp : ""}
      >
        {!selectedApp || !apps.includes(selectedApp) ? (
          <option value="">Select app</option>
        ) : null}
        {apps.map((app) => (
          <option key={app} value={app}>
            {app.replace(/^apps\//, "")}
          </option>
        ))}
      </select>

      <select
        aria-label="Route"
        className={`${selectClass} min-w-[220px] flex-1`}
        onChange={(event) => {
          const route = event.target.value;
          onRouteChange(route);
          const match = routes.find((item) => item.route === route);
          if (match) {
            onEntryFileChange(match.pageFile);
            if (match.layouts[0]) {
              onLayoutFileChange(match.layouts[0]);
            }
          }
        }}
        value={
          routes.some((item) => item.route === selectedRoute)
            ? selectedRoute
            : ""
        }
      >
        {routes.length === 0 ? <option value="">No routes</option> : null}
        {routes.map((route) => (
          <option key={route.route} value={route.route}>
            {route.route}
          </option>
        ))}
      </select>

      <select
        aria-label="Route trace mode"
        className={`${selectClass} w-[130px]`}
        onChange={(event) =>
          onRouteTraceModeChange(event.target.value as RouteTraceMode)
        }
        value={routeTraceMode}
      >
        <option value="full">Full route</option>
        <option value="page-only">Page only</option>
        <option value="from-layout">From layout</option>
      </select>

      {routeTraceMode === "from-layout" && layoutOptions.length > 0 ? (
        <select
          aria-label="Start layout"
          className={`${selectClass} min-w-[180px]`}
          onChange={(event) => onLayoutFileChange(event.target.value)}
          value={layoutFile ?? layoutOptions[0]}
        >
          {layoutOptions.map((layout) => (
            <option key={layout} value={layout}>
              {layout.split("/").pop() ?? layout}
            </option>
          ))}
        </select>
      ) : null}

      <button
        className={analyzeButtonClass}
        disabled={isLoading}
        onClick={onAnalyze}
        type="button"
      >
        {isLoading ? "Analyzing…" : "Analyze"}
      </button>
    </>
  );
}
