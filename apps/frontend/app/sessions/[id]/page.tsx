"use client";

import { useEffect } from "react";

export default function SessionsRedirect({ params }: { params: Promise<{ id: string }> }) {
  useEffect(() => {
    void params.then(({ id }) => {
      window.location.replace(`/s/${id}`);
    });
  }, [params]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <p className="text-sm text-muted-foreground">Redirecting…</p>
    </main>
  );
}
