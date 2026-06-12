# Route Map

## /

- page: app/page.tsx
- layout: app/layout.tsx

## /[locale]

- page: app/[locale]/page.tsx
- layout: app/[locale]/layout.tsx

## /[locale]/blogs/[slug]

- page: app/[locale]/blogs/[slug]/page.tsx
- loading: app/[locale]/blogs/[slug]/loading.tsx
- error: app/[locale]/blogs/[slug]/error.tsx

## /[locale]/studio

- page: app/[locale]/studio/page.tsx
- layout: app/[locale]/studio/layout.tsx
- loading: app/[locale]/studio/loading.tsx
- error: app/[locale]/studio/error.tsx

## /[locale]/studio/[projectId]

- page: app/[locale]/studio/[projectId]/page.tsx
- layout: app/[locale]/studio/[projectId]/layout.tsx
- loading: app/[locale]/studio/[projectId]/loading.tsx

## /about

- page: app/about/page.tsx

## /dashboard

- page: app/dashboard/page.tsx
- layout: app/dashboard/layout.tsx

## /dashboard/settings

- page: app/dashboard/settings/page.tsx
