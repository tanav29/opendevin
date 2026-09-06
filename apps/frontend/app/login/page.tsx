"use client";

import Link from "next/link";
import { IconBrandGithub, IconCode, IconShieldCheck, IconArrowLeft, IconSparkles } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function signIn() {
  const response = await fetch(`${API}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ provider: "github", callbackURL: window.location.origin }),
  });
  const data = (await response.json()) as { url?: string };
  if (data.url) window.location.href = data.url;
}

export default function Login() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <IconArrowLeft className="size-4" /> Back to dashboard
        </Link>

        <Card className="mt-6">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex size-9 items-center justify-center rounded-xl border bg-muted">
              <IconCode className="size-5" />
            </div>
            <div>
              <CardTitle className="text-center text-xl">Sign in to OpenDevin</CardTitle>
              <CardDescription className="text-center">Use GitHub to access your workspaces.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={() => void signIn()} className="w-full">
              <IconBrandGithub className="size-4" />
              Continue with GitHub
            </Button>

            <p className="text-center text-xs text-muted-foreground">We only request read access to your profile. Repos are cloned via the URL you provide.</p>

            <Separator />

            <div className="grid gap-3">
              <div className="flex gap-2 rounded-lg border bg-muted/50 p-3">
                <IconShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">No vendor lock-in</p>
                  <p className="text-xs leading-5 text-muted-foreground">Your code stays in short-lived sandboxes. Nothing is kept longer than you need.</p>
                </div>
              </div>
              <div className="flex gap-2 rounded-lg border bg-muted/50 p-3">
                <IconSparkles className="size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Human in the loop</p>
                  <p className="text-xs leading-5 text-muted-foreground">The agent proposes, you approve. Inspect the diff before shipping.</p>
                </div>
              </div>
            </div>

            <p className="pt-2 text-center text-xs text-muted-foreground">
              By continuing you agree to run code inside an isolated sandbox.
            </p>
          </CardContent>
        </Card>

        <p className="mt-4 text-center font-mono text-[11px] text-muted-foreground">OpenDevin · minimal, productive, yours.</p>
      </div>
    </main>
  );
}
