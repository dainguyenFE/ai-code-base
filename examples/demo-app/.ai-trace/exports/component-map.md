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

