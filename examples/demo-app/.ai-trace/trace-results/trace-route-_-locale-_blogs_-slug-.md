# Trace: Trace route /[locale]/blogs/[slug]

## Summary

Route /[locale]/blogs/[slug] maps to app/[locale]/blogs/[slug]/page.tsx with 2 nested layout(s) and 1 rendered component target(s).

## Details

```
/[locale]/blogs/[slug]

Entry
  path: /[locale]/blogs/[slug]
  page: app/[locale]/blogs/[slug]/page.tsx
  page components: BlogDetailPage (app/[locale]/blogs/[slug]/page.tsx:8-16)

Boundary
  boundary: server component (default RSC)

Render tree
  BlogDetailPage (app/[locale]/blogs/[slug]/page.tsx:8-16)
  └── BlogDetail (components/blog/BlogDetail.tsx:13-22)
      ├── BlogHeader (components/blog/BlogHeader.tsx:5-11)
      └── BlogContent (components/blog/BlogContent.tsx:6-13)

Props passed
  BlogDetail ← post={post}
  BlogHeader ← title={post.title}
  BlogContent ← content={post.content}, related={related}

Hooks
  useRelatedPosts (hooks/useRelatedPosts.ts:3-6)
    calls: getBlogDetail

Usage & impact
  entry components: BlogDetail
  layout wrappers: 2

Route
  /[locale]/blogs/[slug] → app/[locale]/blogs/[slug]/page.tsx

Layouts & segments
  app/layout.tsx → RootLayout
  app/[locale]/layout.tsx → LocaleLayout
  loading: app/[locale]/blogs/[slug]/loading.tsx
  error: app/[locale]/blogs/[slug]/error.tsx

Related
  app/[locale]/blogs/[slug]/error.tsx
  app/[locale]/blogs/[slug]/loading.tsx
  app/[locale]/blogs/[slug]/page.tsx
  components/blog/BlogDetail.tsx
  hooks/useRelatedPosts.ts
```
