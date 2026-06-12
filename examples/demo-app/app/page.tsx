import { Badge } from "../components/primitives/Badge";
import { Button } from "../components/ui/button";

/** Level 1 route — static `/` */
export default function HomePage() {
  return (
    <main>
      <h1>Trace Examples</h1>
      <Badge label="home" />
      <p>Progressive demos from leaf components → full studio stack.</p>
      <Button variant="outline">shadcn Button stub</Button>
    </main>
  );
}
