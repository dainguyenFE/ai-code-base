# Component Map

## ErrorPage

File:

- app/[locale]/blogs/[slug]/error.tsx

## Loading

File:

- app/[locale]/blogs/[slug]/loading.tsx

## BlogDetailPage

File:

- app/[locale]/blogs/[slug]/page.tsx

Props:

- params

Renders:

- BlogDetail

## LocaleLayout

File:

- app/[locale]/layout.tsx

Props:

- children
- params

## LocaleHomePage

File:

- app/[locale]/page.tsx

Props:

- params

Renders:

- InfoCard

## ProjectLayout

File:

- app/[locale]/studio/[projectId]/layout.tsx

Props:

- children
- params

Renders:

- WorkspaceProvider

## ProjectLoading

File:

- app/[locale]/studio/[projectId]/loading.tsx

Renders:

- Skeleton

## ProjectPage

File:

- app/[locale]/studio/[projectId]/page.tsx

Props:

- params

Renders:

- StudioProjectView

## StudioError

File:

- app/[locale]/studio/error.tsx

Props:

- error
- reset

Renders:

- Button

## StudioLayout

File:

- app/[locale]/studio/layout.tsx

Props:

- children
- params

## StudioLoading

File:

- app/[locale]/studio/loading.tsx

Renders:

- Skeleton

## StudioPage

File:

- app/[locale]/studio/page.tsx

Props:

- params

Renders:

- CreativeStudioHome

## StudioTemplate

File:

- app/[locale]/studio/template.tsx

Props:

- children

## AboutPage

File:

- app/about/page.tsx

Renders:

- InfoCard

## DashboardLayout

File:

- app/dashboard/layout.tsx

Props:

- children

## DashboardPage

File:

- app/dashboard/page.tsx

Renders:

- DashboardShell

## SettingsPage

File:

- app/dashboard/settings/page.tsx

Uses hooks:

- useToggle

## RootLayout

File:

- app/layout.tsx

Props:

- children

## HomePage

File:

- app/page.tsx

Renders:

- Badge
- Button

## BlogContent

File:

- components/blog/BlogContent.tsx

Props:

- content
- related

## BlogDetail

File:

- components/blog/BlogDetail.tsx

Props:

- post

Renders:

- BlogHeader
- BlogContent

Uses hooks:

- useRelatedPosts

## BlogHeader

File:

- components/blog/BlogHeader.tsx

Props:

- title

## InfoCard

File:

- components/cards/InfoCard.tsx

Props:

- title
- badge

Renders:

- Icon
- Badge

## DashboardShell

File:

- components/dashboard/DashboardShell.tsx

Renders:

- InfoCard
- DashboardStats

Uses hooks:

- useDashboardData

## DashboardStats

File:

- components/dashboard/DashboardStats.tsx

Props:

- stats

Renders:

- StatTile

Uses hooks:

- useCounter

## StatTile

File:

- components/dashboard/StatTile.tsx

Props:

- label
- value

Renders:

- Badge

Uses hooks:

- useToggle

## Badge

File:

- components/primitives/Badge.tsx

Props:

- label

## Icon

File:

- components/primitives/Icon.tsx

Props:

- name

## Badge

File:

- components/ui/badge.tsx

Props:

- children
- variant
- props

## Button

File:

- components/ui/button.tsx

Props:

- children
- variant
- size
- props

## Card

File:

- components/ui/card.tsx

Props:

- children
- className
- props

## CardHeader

File:

- components/ui/card.tsx

Props:

- children
- props

## CardTitle

File:

- components/ui/card.tsx

Props:

- children
- props

## CardContent

File:

- components/ui/card.tsx

Props:

- children
- props

## Separator

File:

- components/ui/separator.tsx

Props:

- props

## Skeleton

File:

- components/ui/skeleton.tsx

Props:

- className
- props

## WorkspaceProvider

File:

- context/WorkspaceProvider.tsx

Props:

- children
- locale
- projectId
- projectName

Renders:

- WorkspaceContext

Uses hooks:

- useWorkspaceStore
- useCallback
- useMemo

## CreativeStudioHome

File:

- features/creative-studio/CreativeStudioHome.tsx

Props:

- locale
- projects

Renders:

- Button
- Separator
- ProjectGrid

## LayerList

File:

- features/creative-studio/LayerList.tsx

Renders:

- Button
- Separator
- LayerItem

Uses hooks:

- useWorkspaceStore
- useLayerSelection
- useCallback

## ProjectGrid

File:

- features/creative-studio/ProjectGrid.tsx

Props:

- projects
- locale

Renders:

- ProjectCard

## StudioProjectView

File:

- features/creative-studio/StudioProjectView.tsx

Props:

- project

Renders:

- WorkspaceShell

## StudioToolbar

File:

- features/creative-studio/StudioToolbar.tsx

Renders:

- BadgeCompact
- Separator
- Button

Uses hooks:

- useWorkspaceContext
- useWorkspace
- useWorkspaceStore
- useCallback

## BadgeCompact

File:

- features/creative-studio/StudioToolbar.tsx

## ToolPalette

File:

- features/creative-studio/ToolPalette.tsx

Renders:

- Button

Uses hooks:

- useWorkspaceStore
- useMemo
- useCallback

## WorkspaceCanvas

File:

- features/creative-studio/WorkspaceCanvas.tsx

Renders:

- Card
- CardHeader
- CardTitle
- Badge
- CardContent

Uses hooks:

- useWorkspace
- useMemo

## WorkspaceShell

File:

- features/creative-studio/WorkspaceShell.tsx

Renders:

- StudioToolbar
- WorkspaceSidebar
- WorkspaceCanvas

## WorkspaceSidebar

File:

- features/creative-studio/WorkspaceSidebar.tsx

Renders:

- ToolPalette
- LayerList
