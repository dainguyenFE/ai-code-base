interface Props {
  content: string;
  related: unknown[];
}

export function BlogContent({ content, related }: Props) {
  return (
    <article>
      <p>{content}</p>
      <p>Related: {related.length}</p>
    </article>
  );
}
