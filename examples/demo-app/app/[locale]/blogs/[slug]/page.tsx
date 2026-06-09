import { BlogDetail } from "../../../../components/blog/BlogDetail";
import { getBlogDetail } from "../../../../lib/blog/getBlogDetail";

type Props = {
  params: { slug: string };
};

export default function BlogDetailPage({ params }: Props) {
  const post = getBlogDetail(params.slug);

  if (!post) return null;

  return <BlogDetail post={post} />;
}
