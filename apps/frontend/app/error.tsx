"use client";

import { useEffect } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <h1 className="font-serif text-lg font-medium">This view could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Retry the view. If the problem continues, check the OpenDevin API connection.
        </p>
        <Button className="mt-5" size="sm" variant="outline" onClick={retry}>
          <IconRefresh className="size-4" /> Try again
        </Button>
      </div>
    </main>
  );
}
