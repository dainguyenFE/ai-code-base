interface StudioLayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

/** Level 9 route — segment layout for `/[locale]/studio/*` (list + editor) */
export default function StudioLayout({ children, params }: StudioLayoutProps) {
  return (
    <section data-slot="studio-layout" data-locale={params.locale}>
      <nav data-slot="studio-nav">Studio / {params.locale}</nav>
      {children}
    </section>
  );
}
