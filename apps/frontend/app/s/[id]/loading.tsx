export default function Loading() {
  return (
    <main className="flex h-screen flex-col bg-background">
      <div className="h-12 shrink-0 animate-pulse border-b bg-card" />
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 animate-pulse p-8">
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="h-16 rounded-xl bg-muted" />
            <div className="h-24 rounded-xl bg-muted" />
            <div className="h-14 rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    </main>
  );
}
