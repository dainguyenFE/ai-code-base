# Trace: Trace component WorkspaceShell

## Summary

WorkspaceShell is a component at features/creative-studio/WorkspaceShell.tsx:8-18. Used by 1 direct consumer(s); affects 0 route(s).

## Details

```
WorkspaceShell

Entry
  WorkspaceShell — features/creative-studio/WorkspaceShell.tsx:8-18
  props: none
  signature: export function WorkspaceShell() {

Boundary
  boundary: client component ("use client")

Render tree
  ├── StudioToolbar (features/creative-studio/StudioToolbar.tsx:12-37)
  │   ├── BadgeCompact (features/creative-studio/StudioToolbar.tsx:39-41)
  │   ├── Separator (components/ui/separator.tsx:4-6)
  │   └── Button (components/ui/button.tsx:10-27)
  ├── WorkspaceSidebar (features/creative-studio/WorkspaceSidebar.tsx:7-14)
  │   ├── ToolPalette (features/creative-studio/ToolPalette.tsx:17-50)
  │   │   └── Button (components/ui/button.tsx:10-27)
  │   └── LayerList (features/creative-studio/LayerList.tsx:12-44)
  │       ├── Separator (components/ui/separator.tsx:4-6)
  │       ├── Button (components/ui/button.tsx:10-27)
  │       └── LayerItem (features/creative-studio/LayerItem.tsx:18-54)
  └── WorkspaceCanvas (features/creative-studio/WorkspaceCanvas.tsx:15-46)
      ├── Card (components/ui/card.tsx:4-14)
      ├── CardHeader (components/ui/card.tsx:16-25)
      ├── CardTitle (components/ui/card.tsx:27-36)
      ├── Badge (components/ui/badge.tsx:9-15)
      └── CardContent (components/ui/card.tsx:38-47)

Hooks
  none

Usage & impact
  direct consumers:
    - StudioProjectView (features/creative-studio/StudioProjectView.tsx:11-17)
  routes affected: none detected

Related
  features/creative-studio/StudioProjectView.tsx
  features/creative-studio/StudioToolbar.tsx
  features/creative-studio/WorkspaceCanvas.tsx
  features/creative-studio/WorkspaceShell.tsx
  features/creative-studio/WorkspaceSidebar.tsx
```
