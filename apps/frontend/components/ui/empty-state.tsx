import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: React.ReactNode };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && (
        <span className="flex size-9 items-center justify-center rounded-[8px] border border-border bg-card text-muted-foreground">
          {icon}
        </span>
      )}
      <h3 className={cn("font-serif text-[13px] font-medium tracking-[-0.02em] text-foreground", icon && "mt-4")}>{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-[1.6] text-muted-foreground">{description}</p>
      )}
      {action && (
        <Button size="sm" className="mt-4 rounded-[6px] bg-foreground text-background hover:bg-background/80" onClick={action.onClick}>
          {action.icon}
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function InlineEmpty({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[8px] border border-dashed border-border bg-card px-3 py-5 text-center text-[13px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionLabel({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <p className="eyebrow">{children}</p>
      {action}
    </div>
  );
}