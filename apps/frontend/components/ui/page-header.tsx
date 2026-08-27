"use client";

import { cn } from "@/lib/utils";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function PageHeader({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "z-10 flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-1.5 sm:px-2",
        className,
      )}
    >
      <Tooltip>
        <TooltipTrigger render={<SidebarTrigger />} />
        <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
      </Tooltip>
      {icon && <span className="flex shrink-0 items-center text-muted-foreground">{icon}</span>}
      {title && (
        <h1 className="min-w-0 truncate text-[13px] font-medium tracking-[-0.01em]">{title}</h1>
      )}
      {description && (
        <span className="mono hidden min-w-0 truncate text-[11.5px] text-muted-foreground sm:inline">
          {description}
        </span>
      )}
      {children}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

export function PageShell({
  header,
  children,
  className,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-screen flex-col overflow-hidden bg-background", className)}>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export function PageContainer({
  children,
  size = "default",
  className,
}: {
  children: React.ReactNode;
  size?: "sm" | "default" | "wide";
  className?: string;
}) {
  const widths = {
    sm: "max-w-lg",
    default: "max-w-2xl",
    wide: "max-w-3xl",
  };
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6", widths[size], className)}>{children}</div>
  );
}
