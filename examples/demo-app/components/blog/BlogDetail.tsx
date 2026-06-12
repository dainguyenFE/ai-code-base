import { useRelatedPosts } from "../../hooks/useRelatedPosts";
import { BlogContent } from "./BlogContent";
import { BlogHeader } from "./BlogHeader";

interface Props {
  post: {
    title: string;
    content: string;
    category: string;
  };
}

export function BlogDetail({ post }: Props) {
  const related = useRelatedPosts(post.category);

  return (
    <div>
      <BlogHeader title={post.title} />
      <BlogContent content={post.content} related={related} />
    </div>
  );
}
