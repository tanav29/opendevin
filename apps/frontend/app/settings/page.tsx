"use client";

import Link from "next/link";
import {
  IconSettings,
  IconLogout,
  IconUser,
  IconShield,
  IconArrowLeft,
  IconBrandGithub,
} from "@tabler/icons-react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function Settings() {
  async function signOut() {
    await fetch(`${API}/api/auth/sign-out`, { method: "POST", credentials: "include" });
    window.location.href = "/";
  }

  return (
    <AppShell>
      <PageShell
        header={
          <PageHeader
            title="Settings"
            description="Account & workspace"
            icon={<IconSettings className="size-4" />}
            actions={
              <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/")}>
                <IconArrowLeft className="size-4" /> Dashboard
              </Button>
            }
          />
        }
      >
        <PageContainer size="sm" className="py-8">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md border bg-muted">
                    <IconUser className="size-4" />
                  </span>
                  <div>
                    <CardTitle>Account</CardTitle>
                    <CardDescription>Signed in via GitHub OAuth.</CardDescription>
                  </div>
                  <Badge variant="secondary" className="ml-auto hidden sm:inline-flex">
                    <IconBrandGithub className="size-3" /> GitHub auth
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/50 p-3">
                  <p className="text-sm font-medium">Session data</p>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    Projects, sessions and sandbox metadata live locally (SQLite/Prisma). Sandboxes
                    are ephemeral — they expire and can be reconnected if needed.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void signOut()}>
                    <IconLogout className="size-4" /> Sign out
                  </Button>
                  <Button variant="ghost" onClick={() => (window.location.href = "/")}>
                    Back to dashboard
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md border bg-muted">
                    <IconShield className="size-4" />
                  </span>
                  <div>
                    <CardTitle>Privacy & sandboxes</CardTitle>
                    <CardDescription>What the agent can do.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-[13px] leading-5 text-muted-foreground">
                <p>
                  The agent has shell, file, and web search tools scoped to the session sandbox. It
                  never touches your local filesystem. Each sandbox is isolated — clone, build, and
                  discard.
                </p>
                <Separator />
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Ephemeral sandboxes</Badge>
                  <Badge variant="outline">No persistent agents</Badge>
                  <Badge variant="outline">Diff before publish</Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Keyboard</CardTitle>
                <CardDescription>Produce faster.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">Toggle sidebar</span>
                  <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    ⌘ B
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">Focus search</span>
                  <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    ⌘ K
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-muted-foreground">New project</span>
                  <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">n</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </PageContainer>
      </PageShell>
    </AppShell>
  );
}
