interface StudioTemplateProps {
  children: React.ReactNode;
}

/** Level 9 route — template re-mounts on navigation within studio segment */
export default function StudioTemplate({ children }: StudioTemplateProps) {
  return <div data-slot="studio-template">{children}</div>;
}
