"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronDown,
  IconFolder,
  IconLayoutDashboard,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
} from "@tabler/icons-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusDot } from "@/components/ui/status-dot";
import NewProjectForm from "@/components/new-project-dialog";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api";
import { Code2 } from "lucide-react";

type Project = { id: string; repo: string; updatedAt?: string };
type Session = {
  id: string;
  title: string;
  status: string;
  sandboxStatus: string;
  branch: string;
  updatedAt: string;
  projectId: string;
  project: { id: string; repo: string };
};

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_SESSIONS: Session[] = [];

export function AppSidebar() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const me = useSession();

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
    retry: false,
    refetchInterval: 15000,
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<Session[]>("/api/sessions"),
    retry: false,
    refetchInterval: 15000,
  });
  const projects = projectsQuery.data ?? EMPTY_PROJECTS;
  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;
  const projectsLoading = projectsQuery.isPending;
  const sessionsLoading = sessionsQuery.isPending;
  const signedIn = projectsQuery.isPending ? null : projectsQuery.isSuccess;

  const filteredProjects = useMemo(() => {
    if (!query.trim()) return projects.slice(0, 6);
    const q = query.toLowerCase();
    return projects.filter((p) => p.repo.toLowerCase().includes(q)).slice(0, 6);
  }, [projects, query]);

  const filteredSessions = useMemo(() => {
    if (!query.trim()) return sessions.slice(0, 8);
    const q = query.toLowerCase();
    return sessions
      .filter((s) => s.title.toLowerCase().includes(q) || s.project.repo.toLowerCase().includes(q))
      .slice(0, 8);
  }, [sessions, query]);

  const sessionCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);
    return counts;
  }, [sessions]);

  const runningCount = sessions.filter((s) => s.status === "running").length;
  const isDashboard = pathname === "/";
  const displayName = me?.github.login || me?.user.name || (signedIn === false ? "Guest" : "…");
  const displaySub =
    me?.user.email || (signedIn === false ? "Sign in to sync" : "Loading…");

  return (
    <>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="OpenDevin home"
                render={<Link href="/" prefetch />}
              >
                <span className="flex aspect-square items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground p-2">
                  <Code2 className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                  <span className="truncate font-semibold text-sm">OpenDevin</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {signedIn === false && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={pathname === "/login"}
                      tooltip="Sign in"
                      render={<Link href="/login" prefetch />}
                    >
                      <IconSparkles />
                      <span>Sign in</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {signedIn !== false && (
          <div className="px-3 pt-1 group-data-[collapsible=icon]:hidden">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <SidebarInput
                  aria-label="Filter projects and sessions"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-8 pl-8 text-[13px]"
                />
              </div>
            </div>
          )}

          {signedIn === false ? (
            <SidebarGroup>
              <div className="rounded-xl border border-dashed bg-card p-3 group-data-[collapsible=icon]:hidden">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Sign in
                </p>
                <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                  Connect GitHub to browse repos and start a workspace.
                </p>
                <Link
                  href="/login"
                  className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-sidebar-primary px-3 py-2 text-sm font-medium text-sidebar-primary-foreground"
                >
                  Continue with GitHub
                </Link>
              </div>
            </SidebarGroup>
          ) : (
            <>
              <Collapsible defaultOpen className="group/collapsible">
                <SidebarGroup>
                  <SidebarGroupLabel render={<CollapsibleTrigger />}>
                    Projects
                    <IconChevronDown className="ml-auto transition-transform group-data-open/collapsible:rotate-180" />
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {projectsLoading ? (
                          <>
                            {[0, 1, 2].map((i) => (
                              <SidebarMenuItem key={i}>
                                <SidebarMenuSkeleton showIcon />
                              </SidebarMenuItem>
                            ))}
                          </>
                        ) : filteredProjects.length === 0 ? (
                          <p className="px-2 py-2 text-[12px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                            {projects.length === 0 ? "No workspaces yet." : "No matches."}
                          </p>
                        ) : (
                          filteredProjects.map((p) => {
                            const active =
                              pathname === `/p/${p.id}` || pathname === `/projects/${p.id}`;
                            const count = sessionCountByProject.get(p.id) ?? 0;
                            return (
                              <SidebarMenuItem key={p.id}>
                                <SidebarMenuButton
                                  isActive={active}
                                  tooltip={p.repo}
                                  render={<Link href={`/p/${p.id}`} prefetch />}
                                >
                                  <IconFolder className="shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 flex-1 truncate">{p.repo}</span>
                                </SidebarMenuButton>
                                {count > 0 && (
                                  <SidebarMenuBadge>{count}</SidebarMenuBadge>
                                )}
                              </SidebarMenuItem>
                            );
                          })
                        )}
                      </SidebarMenu>
                      {projects.length > 6 && !query && (
                        <Link
                          href="/"
                          className="mt-1 block px-2 text-[11px] text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden"
                        >
                          View all →
                        </Link>
                      )}
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>

              <Collapsible defaultOpen className="group/collapsible">
                <SidebarGroup>
                  <SidebarGroupLabel render={<CollapsibleTrigger />}>
                    Sessions
                    <span className="ml-auto flex items-center gap-1.5">
                      {runningCount > 0 && (
                        <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                          {runningCount}
                        </span>
                      )}
                      <IconChevronDown className="ml-auto size-4 transition-transform group-data-open/collapsible:rotate-180" />
                    </span>
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {sessionsLoading ? (
                          <>
                            {[0, 1, 2, 3].map((i) => (
                              <SidebarMenuItem key={i}>
                                <SidebarMenuSkeleton />
                              </SidebarMenuItem>
                            ))}
                          </>
                        ) : filteredSessions.length === 0 ? (
                          <p className="px-2 py-2 text-[12px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                            No sessions.
                          </p>
                        ) : (
                          filteredSessions.map((s) => {
                            const active =
                              pathname === `/s/${s.id}` || pathname === `/sessions/${s.id}`;
                            return (
                              <SidebarMenuItem key={s.id}>
                                <SidebarMenuButton
                                  isActive={active}
                                  tooltip={`${s.title} · ${s.project.repo}`}
                                  render={<Link href={`/s/${s.id}`} prefetch />}
                                >
                                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                                  <StatusDot status={s.status} className="ml-auto" />
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })
                        )}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
            </>
          )}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip={displayName}
                render={<Link href={signedIn === false ? "/login" : "/settings"} prefetch />}
              >
                {me?.github.avatarUrl || me?.user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={me.github.avatarUrl || me.user.image || ""}
                    alt=""
                    className="size-7 shrink-0 rounded-full border border-border"
                  />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs text-muted-foreground">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                  <span className="truncate text-[13px] font-medium">{displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">{displaySub}</span>
                </span>
                <IconSettings className="ml-auto shrink-0 text-muted-foreground" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </>
  );
}
