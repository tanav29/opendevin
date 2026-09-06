"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  IconLayoutDashboard,
  IconFolder,
  IconPlus,
  IconSettings,
  IconSearch,
  IconTerminal,
  IconGitBranch,
  IconCode,
  IconSparkles,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/ui/status-dot";
import { timeAgo } from "@/lib/format";
import NewProjectForm from "@/components/new-project-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type Project = { id: string; name: string; repo: string | null; updatedAt?: string };
type Session = {
  id: string;
  title: string;
  status: string;
  sandboxStatus: string;
  branch: string;
  updatedAt: string;
  projectId: string;
  project: { id: string; name: string };
};

export function AppSidebar() {
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch(`${API}/api/projects`, { credentials: "include" })
        .then((r) => {
          if (r.status === 401) throw new Error("unauth");
          if (!r.ok) throw new Error("fail");
          return r.json();
        })
        .then((data) => {
          if (cancelled) return;
          setProjects(data as Project[]);
          setSignedIn(true);
        })
        .catch(() => {
          if (!cancelled) setSignedIn(false);
        });

      fetch(`${API}/api/sessions`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (!cancelled) setSessions(data as Session[]);
        })
        .catch(() => undefined);
    }
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const filteredProjects = useMemo(() => {
    if (!query.trim()) return projects.slice(0, 6);
    const q = query.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q) || (p.repo || "").toLowerCase().includes(q)).slice(0, 6);
  }, [projects, query]);

  const filteredSessions = useMemo(() => {
    if (!query.trim()) return sessions.slice(0, 8);
    const q = query.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.project.name.toLowerCase().includes(q)).slice(0, 8);
  }, [sessions, query]);

  const isDashboard = pathname === "/";
  const isSettings = pathname === "/settings";

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="gap-0">
        <div className="flex items-center gap-2 px-1 h-8">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <span className="truncate text-md font-semibold tracking-[-0.02em] group-data-[collapsible=icon]:hidden">OpenDevin</span>
          </Link>
        </div>

        {signedIn !== false && (
          <div className="px-1 py-2 group-data-[collapsible=icon]:hidden">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <SidebarInput
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-7 pl-7 text-[13px]"
              />
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isDashboard} tooltip="Dashboard" render={<Link href="/" prefetch />}>
                  <IconLayoutDashboard className="size-4" />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NewProjectForm />
              </SidebarMenuItem>
              {signedIn === false && (
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={pathname === "/login"} tooltip="Sign in" render={<Link href="/login" prefetch />}>
                    <IconSparkles className="size-4" />
                    <span>Sign in</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {signedIn === false ? (
          <SidebarGroup>
            <div className="rounded-md border border-dashed border-border bg-card p-3 group-data-[collapsible=icon]:hidden">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Sign in to continue</p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Create projects, run sandboxes, ship patches.</p>
              <Link href="/login" className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background">
                Continue with GitHub
              </Link>
            </div>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupLabel className="flex items-center gap-1.5">
                {/*<IconFolder className="size-3.5" />*/}
                Projects
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">{projects.length}</span>
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {filteredProjects.length === 0 ? (
                    <p className="px-2 py-2 text-[12px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                      {projects.length === 0 ? "No projects yet." : "No matches."}
                    </p>
                  ) : (
                    filteredProjects.map((p) => {
                      const active = pathname === `/p/${p.id}` || pathname === `/projects/${p.id}`;
                      return (
                        <SidebarMenuItem key={p.id}>
                          <SidebarMenuButton isActive={active} tooltip={p.name} render={<Link href={`/p/${p.id}`} />}>
                            <IconFolder className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{p.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })
                  )}
                </SidebarMenu>
                {projects.length > 6 && !query && (
                  <Link href="/" className="mt-1 block px-2 text-[11px] text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden">
                    View all →
                  </Link>
                )}
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel className="flex items-center gap-1.5">
                {/*<IconTerminal className="size-3.5" />*/}
                Sessions
                {/*<span className="ml-auto flex items-center gap-1.5">
                  {sessions.filter((s) => s.status === "running").length > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span className="size-1.5 animate-pulse rounded-full bg-warning" />
                      {sessions.filter((s) => s.status === "running").length}
                    </span>
                  )}
                </span>*/}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {filteredSessions.length === 0 ? (
                    <p className="px-2 py-2 text-[12px] text-muted-foreground group-data-[collapsible=icon]:hidden">No sessions.</p>
                  ) : (
                    filteredSessions.map((s) => {
                      const active = pathname === `/s/${s.id}` || pathname === `/sessions/${s.id}`;
                      return (
                        <SidebarMenuItem key={s.id}>
                          <SidebarMenuButton isActive={active} tooltip={s.title} render={<Link href={`/s/${s.id}`} />}>
                            <span className="truncate">{s.title}</span>
                            {/*{s.branch && (
                              <Badge variant="outline" className="ml-auto hidden h-4 px-1 font-mono text-[10px] group-data-[collapsible=icon]:hidden xl:inline-flex">
                                <IconGitBranch className="size-3" />
                                {s.branch.length > 12 ? `${s.branch.slice(0, 12)}…` : s.branch}
                              </Badge>
                            )}*/}
                            <StatusDot status={s.status} />
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator className="mx-0" />
        <div className="flex items-center gap-2 p-2 group-data-[collapsible=icon]:justify-center">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card group-data-[collapsible=icon]:size-8">
            {/*your avatar*/}
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-[13px] font-medium leading-none">{signedIn ? "Your Name sir" : "Guest"}</p>
          </div>
          <Link href="/settings">
            <Button variant="ghost" size="icon-sm" className="size-7 shrink-0 group-data-[collapsible=icon]:hidden">
            <IconSettings className="size-4" />
            </Button>
          </Link>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
