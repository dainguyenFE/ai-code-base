"use client";

import { Button } from "../../../components/ui/button";

interface StudioErrorProps {
  error: Error;
  reset: () => void;
}

/** Level 9 route — error boundary for studio */
export default function StudioError({ error, reset }: StudioErrorProps) {
  return (
    <div data-slot="studio-error">
      <h2>Studio failed to load</h2>
      <p>{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
