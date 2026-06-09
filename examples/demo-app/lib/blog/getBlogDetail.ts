export type BlogPost = {
  title: string;
  content: string;
  category: string;
};

export function getBlogDetail(slug: string): BlogPost | null {
  return {
    title: `Blog ${slug}`,
    content: "Sample content",
    category: "tech",
  };
}
