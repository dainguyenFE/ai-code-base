export interface BlogPost {
  title: string;
  content: string;
  category: string;
}

export function getBlogDetail(slug: string): BlogPost | null {
  return {
    category: "tech",
    content: "Sample content",
    title: `Blog ${slug}`,
  };
}
