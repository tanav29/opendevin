import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/sidebar";
import { AppProviders } from "@/components/providers";
import { ConfirmProvider } from "@/components/ui/confirm";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpenDevin — Autonomous developer",
  description: "An autonomous coding agent for your repositories.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-screen w-full bg-background">
        <AppProviders>
          <TooltipProvider>
            <ConfirmProvider>
              <SidebarProvider>
                <AppSidebar />
                <main className="flex min-h-screen min-w-0 flex-1 flex-col bg-background">{children}</main>
              </SidebarProvider>
            </ConfirmProvider>
            <Toaster
              position="bottom-right"
              closeButton
              richColors={false}
              toastOptions={{
                className: "overlay",
                style: { fontSize: 13 } as React.CSSProperties,
              }}
            />
          </TooltipProvider>
        </AppProviders>
      </body>
    </html>
  );
}
