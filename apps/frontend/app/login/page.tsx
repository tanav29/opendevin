"use client";

import Link from "next/link";
import { IconBrandGithub, IconCode, IconArrowLeft } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="size-4" /> Back
        </Link>

        <Card className="mt-6">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex size-9 items-center justify-center rounded-xl border bg-muted">
              <IconCode className="size-5" />
            </div>
            <div>
              <CardTitle className="text-center text-xl">Sign in</CardTitle>
              <CardDescription className="text-center">Continue with GitHub.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={() => void signIn()} className="w-full">
              <IconBrandGithub className="size-4" />
              Continue with GitHub
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
