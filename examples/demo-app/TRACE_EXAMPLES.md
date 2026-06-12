# Trace Examples — Simple → Complex

Playground for `ai-trace` with progressive **components**, **hooks**, **routes**, **context**, **Zustand**, and **shadcn/ui** stubs.

## Index this app

From **repo root** (recommended):

```bash
bun run trace -- demo:index
bun run trace -- demo:export
bun run trace -- demo:component WorkspaceShell
bun run trace -- demo:route "/[locale]/studio/[projectId]"
```

Equivalent with explicit env:

```bash
AI_TRACE_ROOT=tools/ai-code-trace-agent/examples/demo-app bun run trace -- index
```

From **inside demo-app** (`cd` optional — `AI_TRACE_ROOT` defaults to `$PWD` via `run-cli.sh`):

```bash
cd tools/ai-code-trace-agent/examples/demo-app
bun ../../apps/cli/src/index.ts index
```

---

## UI library boundary (`components/ui/*`)

shadcn/ui-style stubs. When tracing app components, you should see edges like `Button`, `Card`, `Badge` — **stop at the stub**; do not trace into real shadcn/Radix implementation.

| Component   | File                          | Tag           |
| ----------- | ----------------------------- | ------------- |
| `Button`    | `components/ui/button.tsx`    | `data-shadcn` |
| `Card`      | `components/ui/card.tsx`      | `data-shadcn` |
| `Badge`     | `components/ui/badge.tsx`     | `data-shadcn` |
| `Skeleton`  | `components/ui/skeleton.tsx`  | `data-shadcn` |
| `Separator` | `components/ui/separator.tsx` | `data-shadcn` |

```bash
bun trace component Button   # UI library boundary
```

---

## Components

| Level | Symbol               | File                                              | Renders                                          | Hooks / state        |
| ----- | -------------------- | ------------------------------------------------- | ------------------------------------------------ | -------------------- |
| 1     | `Badge`              | `components/primitives/Badge.tsx`                 | —                                                | none                 |
| 1     | `Icon`               | `components/primitives/Icon.tsx`                  | —                                                | none                 |
| 2     | `InfoCard`           | `components/cards/InfoCard.tsx`                   | Badge, Icon                                      | none                 |
| 3     | `StatTile`           | `components/dashboard/StatTile.tsx`               | Badge                                            | useToggle            |
| 4     | `DashboardStats`     | `components/dashboard/DashboardStats.tsx`         | StatTile                                         | useCounter           |
| 5     | `DashboardShell`     | `components/dashboard/DashboardShell.tsx`         | InfoCard, DashboardStats                         | useDashboardData     |
| 6     | `BlogDetail`         | `components/blog/BlogDetail.tsx`                  | BlogHeader, BlogContent                          | useRelatedPosts      |
| 7     | `CreativeStudioHome` | `features/creative-studio/CreativeStudioHome.tsx` | Button, Separator, ProjectGrid                   | none (server)        |
| 8     | `LayerItem`          | `features/creative-studio/LayerItem.tsx`          | Button, Badge                                    | memo, useCallback    |
| 8     | `LayerList`          | `features/creative-studio/LayerList.tsx`          | LayerItem, Button, Separator                     | useLayerSelection    |
| 8     | `ToolPalette`        | `features/creative-studio/ToolPalette.tsx`        | Button                                           | useMemo, useCallback |
| 8     | `WorkspaceCanvas`    | `features/creative-studio/WorkspaceCanvas.tsx`    | Card, Badge                                      | useWorkspace         |
| 9     | `WorkspaceShell`     | `features/creative-studio/WorkspaceShell.tsx`     | StudioToolbar, WorkspaceSidebar, WorkspaceCanvas | none                 |
| 9     | `StudioProjectView`  | `features/creative-studio/StudioProjectView.tsx`  | WorkspaceShell                                   | none                 |

```bash
bun trace component Badge              # level 1
bun trace component DashboardShell     # level 5
bun trace component BlogDetail         # level 6
bun trace component CreativeStudioHome # level 7
bun trace component WorkspaceShell     # level 9
```

---

## Hooks

| Level | Symbol                 | File                            | Composes / calls                                        |
| ----- | ---------------------- | ------------------------------- | ------------------------------------------------------- |
| 1     | `useToggle`            | `hooks/useToggle.ts`            | useState                                                |
| 2     | `useCounter`           | `hooks/useCounter.ts`           | useToggle, useCallback                                  |
| 3     | `useRelatedPosts`      | `hooks/useRelatedPosts.ts`      | getBlogDetail                                           |
| 4     | `useDashboardData`     | `hooks/useDashboardData.ts`     | useCounter, useToggle, getStats                         |
| 7     | `useIsMobile`          | `hooks/useIsMobile.ts`          | useState, useEffect                                     |
| 7     | `useDebouncedValue`    | `hooks/useDebouncedValue.ts`    | useState, useEffect                                     |
| 8     | `useLayerSelection`    | `hooks/useLayerSelection.ts`    | useWorkspaceStore, useMemo, useCallback                 |
| 8     | `useKeyboardShortcuts` | `hooks/useKeyboardShortcuts.ts` | useLayerSelection, useWorkspaceStore, useEffect, useRef |
| 9     | `useWorkspace`         | `hooks/useWorkspace.ts`         | useWorkspaceContext, useWorkspaceStore, all above       |

## Context & store

| Level | Symbol              | File                            | Role                            |
| ----- | ------------------- | ------------------------------- | ------------------------------- |
| 7     | `WorkspaceProvider` | `context/WorkspaceProvider.tsx` | React context + route meta      |
| 7     | `useWorkspaceStore` | `stores/useWorkspaceStore.ts`   | Zustand (`create` from zustand) |

```bash
bun trace hook useWorkspace
bun trace hook useLayerSelection
bun trace component WorkspaceProvider
```

---

## Routes

| Level | Path                           | Files                                      | Entry component                 |
| ----- | ------------------------------ | ------------------------------------------ | ------------------------------- |
| 1     | `/`                            | `app/page.tsx`                             | HomePage → Badge, Button        |
| 2     | `/about`                       | `app/about/page.tsx`                       | AboutPage → InfoCard            |
| 3     | `/dashboard`                   | `layout.tsx` + `page.tsx`                  | DashboardPage → DashboardShell  |
| 4     | `/dashboard/settings`          | `app/dashboard/settings/page.tsx`          | SettingsPage (useToggle)        |
| 5     | `/[locale]`                    | `app/[locale]/layout.tsx` + `page.tsx`     | LocaleHomePage                  |
| 6     | `/[locale]/blogs/[slug]`       | page + loading + error                     | BlogDetailPage → BlogDetail     |
| 9     | `/[locale]/studio`             | layout + template + loading + error + page | StudioPage → CreativeStudioHome |
| 10    | `/[locale]/studio/[projectId]` | nested layout + loading + page             | ProjectPage → StudioProjectView |

```bash
bun trace route "/"
bun trace route "/dashboard"
bun trace route "/[locale]/blogs/[slug]"
bun trace route "/[locale]/studio"
bun trace route "/[locale]/studio/[projectId]"
```

---

## Full-stack trace (level 10 — Creative Studio)

```text
Route /[locale]/studio/[projectId]
  ├── app/[locale]/layout.tsx          (locale segment)
  ├── app/[locale]/studio/layout.tsx   (studio segment + nav)
  ├── app/[locale]/studio/template.tsx (re-mount on in-segment nav)
  ├── app/[locale]/studio/[projectId]/layout.tsx
  │     └── WorkspaceProvider (context)
  │           └── ProjectLayout
  ├── loading.tsx → Skeleton [shadcn]
  └── page.tsx (ProjectPage)
        └── StudioProjectView
              └── WorkspaceShell
                    ├── StudioToolbar → useWorkspace, useWorkspaceContext
                    ├── WorkspaceSidebar
                    │     ├── ToolPalette → useWorkspaceStore
                    │     └── LayerList → LayerItem (memo)
                    └── WorkspaceCanvas → useWorkspace
                          └── Card, Badge [shadcn]

State layers:
  useWorkspaceStore (Zustand) ← useLayerSelection, ToolPalette, LayerList
  WorkspaceProvider (Context) ← useWorkspace, StudioToolbar
```

```bash
bun trace route "/[locale]/studio/[projectId]"
bun trace component WorkspaceShell
bun trace hook useWorkspace
bun trace hook useKeyboardShortcuts
```

---

## Blog full-stack (level 6)

```text
Route /[locale]/blogs/[slug]
  ├── loading.tsx
  ├── error.tsx
  └── page.tsx (BlogDetailPage)
        └── BlogDetail
              ├── BlogHeader
              ├── BlogContent
              └── useRelatedPosts → getBlogDetail()
```

```bash
bun trace route "/[locale]/blogs/[slug]"
bun trace component BlogDetail
bun trace hook useRelatedPosts
```
