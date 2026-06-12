import { InfoCard } from "../../components/cards/InfoCard";

interface LocaleHomePageProps {
  params: { locale: string };
}

/** Level 6 route — dynamic `/[locale]` */
export default function LocaleHomePage({ params }: LocaleHomePageProps) {
  return (
    <main>
      <InfoCard title={`Locale ${params.locale}`} badge={params.locale} />
      <ul>
        <li>
          <a href={`/${params.locale}/blogs/hello-world`}>Blog detail</a>
        </li>
        <li>
          <a href={`/${params.locale}/studio`}>Creative Studio</a>
        </li>
      </ul>
    </main>
  );
}
