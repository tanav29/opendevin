"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { IconBrandGithub } from "@tabler/icons-react";
import { Check, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { useAuthActions } from "@convex-dev/auth/react";
import { useGitHubSession } from "@/components/providers";
import { api } from "@convex/_generated/api";

export default function SettingsPage() {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const user = useQuery(api.users.current, {});
  const github = useGitHubSession();
  const [signingOut, setSigningOut] = useState(false);

  async function logout() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
      setSigningOut(false);
    }
  }

  return (
    <PageShell header={<PageHeader title="Settings" />}>
      <PageContainer size="sm" className="animate-rise pt-12 pb-16">
        <p className="eyebrow text-brand">Workspace settings</p>
        <h2 className="mt-3 text-2xl font-medium tracking-[-0.035em]">Your workspace</h2>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">Manage your identity, repository access, and this device’s session.</p>

        <div className="mt-7 flex items-center gap-3 rounded-xl border bg-surface-1 p-4 shadow-sm">
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="size-9 rounded-full" />
          ) : (
            <span className="grid size-9 place-items-center rounded-full bg-surface-3 text-sm font-medium">
              {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium tracking-[-0.01em]">{user?.name || "Loading…"}</p>
            {user?.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-muted px-2 py-1 text-[10px] font-medium text-success"><Check className="size-3" /> Active</span>
        </div>

        <section className="mt-10">
          <p className="eyebrow">GitHub access</p>
          <div className="mt-3 rounded-xl border bg-surface-1 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid size-8 place-items-center rounded-lg border bg-background">
                <IconBrandGithub className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">
                  {github?.connected ? `Connected as ${github.login}` : "GitHub — action required"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Needed to list repositories, choose branches, commit changes and open pull requests.
                </p>
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5">
              {github?.connected ? (
                <p className="text-xs font-medium text-success">✓ Repository access ready</p>
              ) : github === undefined ? (
                <p className="text-xs text-muted-foreground">Checking GitHub connection…</p>
              ) : (
                <p className="text-xs text-muted-foreground">Sign out and sign in again to grant repository access.</p>
              )}
            </div>
          </div>
        </section>

        <section className="mt-10 border-t pt-7">
          <p className="eyebrow">Danger zone</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Sign out of this workspace on this device.</p>
          <Button className="mt-3" size="sm" variant="outline" disabled={signingOut} onClick={() => void logout()}>
            <LogOut /> {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </section>
      </PageContainer>
    </PageShell>
  );
}
