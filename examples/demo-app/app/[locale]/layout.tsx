interface LocaleLayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

/** Level 6 route — dynamic segment layout `/[locale]/*` */
export default function LocaleLayout({ children, params }: LocaleLayoutProps) {
  return (
    <div data-slot="locale-layout" data-locale={params.locale}>
      {children}
    </div>
  );
}
