import { getBlogDetail } from "../lib/blog/getBlogDetail";

export function useRelatedPosts(category: string) {
  const data = getBlogDetail(category);
  return data ? [data] : [];
}
