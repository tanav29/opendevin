"use client";

import { useEffect, useState } from "react";
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
