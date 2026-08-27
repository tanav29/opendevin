"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { IconBrandGithub } from "@tabler/icons-react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuthActions } from "@convex-dev/auth/react";
import { useGitHubFetch } from "@/components/providers";
import { api } from "@convex/_generated/api";

type GitHubSession = { connected: boolean; login?: string; avatarUrl?: string };

export default function SettingsPage() {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const user = useQuery(api.users.current, {});
  const githubFetch = useGitHubFetch();
  const [github, setGithub] = useState<GitHubSession>();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void githubFetch("/api/github/session")
      .then((response) => response.json())
      .then((session) => setGithub(session as GitHubSession))
      .catch(() => setGithub({ connected: false }));
  }, [githubFetch]);

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
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="z-10 flex h-11 shrink-0 items-center gap-1.5 border-b px-1.5 sm:px-2">
        <Tooltip>
          <TooltipTrigger render={<SidebarTrigger />} />
          <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
        </Tooltip>
        <h1 className="text-[13px] font-medium tracking-[-0.01em]">Settings</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 pt-10 pb-12 sm:px-6">
          <p className="eyebrow">Account</p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.02em]">
            Your workspace
          </h2>
          <div className="mt-5 flex items-center gap-3 rounded-lg border bg-surface-1 p-3">
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="size-9 rounded-full" />
            ) : (
              <span className="grid size-9 place-items-center rounded-full bg-surface-3 text-sm font-medium">
                {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{user?.name || "Loading…"}</p>
              {user?.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
            </div>
          </div>

          <section className="mt-8">
            <p className="eyebrow">GitHub access</p>
            <div className="mt-2 rounded-lg border bg-surface-1 p-4">
              <div className="flex items-start gap-3">
                <IconBrandGithub className="mt-0.5 size-5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">
                    {github?.connected ? `Connected as ${github.login}` : "GitHub permission required"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Access lets OpenDevin list repositories and branches, create commits, and open pull requests. GitHub asks for repository access when you sign in.
                  </p>
                </div>
              </div>
              {github?.connected ? (
                <p className="mt-3 text-xs text-success">Repository access is ready.</p>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Sign out and sign in again to update GitHub permissions.</p>
              )}
            </div>
          </section>

          <section className="mt-8 border-t pt-6">
            <p className="eyebrow">Session</p>
            <Button className="mt-2" size="sm" variant="outline" disabled={signingOut} onClick={() => void logout()}>
              <LogOut /> {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
