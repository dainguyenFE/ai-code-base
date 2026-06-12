interface Props {
  title: string;
}

export function BlogHeader({ title }: Props) {
  return (
    <header>
      <h1>{title}</h1>
    </header>
  );
}
