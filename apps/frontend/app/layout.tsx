import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "OpenDevin — Developer workspace",
  description:
    "Turn a repo into a working session. Chat, edit, run, and ship a patch — all inside an isolated sandbox.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
