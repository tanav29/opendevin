"use client";

import { IconSettings, IconLogout, IconArrowLeft, IconBrandGithub } from "@tabler/icons-react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function Settings() {
  const me = useSession();

  async function signOut() {
    await fetch(`${API}/api/auth/sign-out`, { method: "POST", credentials: "include" });
    window.location.href = "/";
  }

  const avatar = me?.github.avatarUrl || me?.user.image;
  const name = me?.github.login || me?.user.name;
  const profileUrl = me?.github.profileUrl;

  return (
    <AppShell>
      <PageShell
        header={
          <PageHeader
            title="Settings"
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
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              {me ? (
                <>
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt="" className="size-10 shrink-0 rounded-full border" />
                  ) : (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted text-sm">
                      {(name || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name || "…"}</p>
                    {me.user.email && (
                      <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
                    )}
                    {profileUrl && (
                      <a
                        href={profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <IconBrandGithub className="size-3" /> GitHub profile
                      </a>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void signOut()}>
                    <IconLogout className="size-4" /> Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Skeleton className="size-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </PageContainer>
      </PageShell>
    </AppShell>
  );
}
