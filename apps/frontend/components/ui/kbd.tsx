import { cn } from "@/lib/utils";

/** Keyboard hint. Sized to sit inline in tooltips and the composer footer. */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded border border-border-strong bg-surface-3 px-1 font-mono text-[10px] leading-none font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
