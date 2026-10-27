"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { ConfirmProvider } from "@/components/ui/confirm";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppShell({
  children,
  defaultOpen = true,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Suspense fallback={<AppShellFallback defaultOpen={defaultOpen}>{children}</AppShellFallback>}>
      <AppShellContent defaultOpen={defaultOpen}>{children}</AppShellContent>
    </Suspense>
  );
}

function AppShellFallback({
  children,
  defaultOpen,
}: {
  children: React.ReactNode;
  defaultOpen: boolean;
}) {
  return (
    <ConfirmProvider>
      <TooltipProvider delay={0}>
        <SidebarProvider defaultOpen={defaultOpen}>
          <SidebarInset className="min-w-0 border overflow-clip">{children}</SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </ConfirmProvider>
  );
}

function AppShellContent({
  children,
  defaultOpen,
}: {
  children: React.ReactNode;
  defaultOpen: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isChatPreview = pathname === "/s/test" || pathname.startsWith("/test/");

  useEffect(() => setMounted(true), []);

  return (
    <ConfirmProvider>
      <TooltipProvider delay={0}>
        {isChatPreview ? (
          children
        ) : (
          <SidebarProvider defaultOpen={defaultOpen}>
            {mounted && <AppSidebar />}
            <SidebarInset className="min-w-0 border overflow-clip">{children}</SidebarInset>
          </SidebarProvider>
        )}
      </TooltipProvider>
    </ConfirmProvider>
  );
}
