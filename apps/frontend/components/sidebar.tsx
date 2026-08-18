"use client";

import { useState } from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Command,
  FolderGit2,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import {
  API,
  mapProjects,
  mapSessions,
  sessionTitle,
  type Project,
  type Session,
  useSessionSelection,
} from "@/components/providers";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function sessionStatus(session: Session) {
  if (session.archived) return "Archived";
  if (session.status === "running") return "working";
  return session.status || "idle";
}

function SessionIcon({ session }: { session: Session }) {
  if (session.archived) return <Archive className="text-muted-foreground" />;
  if (session.status === "running")
    return <LoaderCircle className="animate-spin text-emerald-600" />;
  if (session.status === "stopped") return <CircleDashed />;
  return <CheckCircle2 />;
}

function ProjectGroup({
  project,
  sessions,
  activeSessionId,
  onOpenSession,
  onArchive,
}: {
  project: Project;
  sessions: Session[];
  activeSessionId: string | null;
  onOpenSession: (session: Session) => void;
  onArchive: (session: Session) => void;
}) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const working = sessions.filter((session) => session.status === "running");
  return (
    <div className="w-full min-w-0">
      <SidebarMenuButton
        size="sm"
        onClick={() => router.push(`/p/${project.id}`)}
        tooltip={`${project.name} · ${sessions.length} sessions`}>
        <FolderGit2 className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {working.length > 0 && (
          <span className="shrink-0 text-[10px] text-emerald-600">
            {working.length} active
          </span>
        )}
        <ChevronRight
          role="button"
          aria-label={open ? "Collapse folder" : "Expand folder"}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </SidebarMenuButton>
      {open && (
        <SidebarMenuSub>
          {sessions.length === 0 && (
            <SidebarMenuSubItem>
              <p className="px-2 py-1 text-xs text-sidebar-foreground/60">
                No active sessions
              </p>
            </SidebarMenuSubItem>
          )}
          {sessions.map((session) => (
            <SidebarMenuSubItem key={session.id}>
              <SidebarMenuSubButton
                isActive={activeSessionId === session.id}
                onClick={() => onOpenSession(session)}
                className="pr-8">
                <SessionIcon session={session} />
                <span className="truncate">{sessionTitle(session)}</span>
              </SidebarMenuSubButton>
              <SidebarMenuAction
                showOnHover
                className="top-0.5"
                aria-label="Archive session"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchive(session);
                }}>
                <Archive />
              </SidebarMenuAction>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </div>
  );
}

export function AppSidebar() {
  const projectsResult = useConvexQuery(api.projects.list, {});
  const sessionsResult = useConvexQuery(api.sessions.list, {});
  const projects = mapProjects(projectsResult as unknown[] | undefined);
  const sessions = mapSessions(sessionsResult as unknown[] | undefined);
  const isLoading = sessionsResult === undefined && projectsResult === undefined;
  const { activeSessionId, selectSession } = useSessionSelection();
  const router = useRouter();
  const activeSessions = sessions.filter((session) => !session.archived);
  const archivedSessions = sessions.filter((session) => session.archived);

  async function archiveSession(session: Session) {
    if (!window.confirm("Archive this session? Its sandbox will be stopped."))
      return;
    try {
      const response = await fetch(`${API}/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not archive session.");
      if (activeSessionId === session.id) selectSession(null);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Could not archive session.",
      );
    }
  }

  async function unarchiveSession(session: Session) {
    try {
      const response = await fetch(`${API}/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not unarchive session.");
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Could not unarchive session.",
      );
    }
  }

  async function deleteSession(session: Session) {
    if (!window.confirm("Delete this archived session permanently? This cannot be undone.")) return;
    try {
      const response = await fetch(`${API}/sessions/${session.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not delete session.");
      if (activeSessionId === session.id) selectSession(null);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Could not delete session.",
      );
    }
  }

  const openSession = (session: Session) => {
    selectSession(session.id);
    router.push(`/s/${session.id}`);
  };

  return (
    <Sidebar className="border-r bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="flex h-10 w-full flex-row items-center justify-between gap-2 border-b px-2.5 py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Command className="size-4 shrink-0" />
          <span className="truncate text-[13px] font-medium tracking-tight">
            OpenDevin
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New project"
                onClick={() => {
                  selectSession(null);
                  router.push("/new");
                }}>
                <Plus />
              </Button>
            }
          />
          <TooltipContent>New project</TooltipContent>
        </Tooltip>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center justify-between">
            <SidebarGroupLabel>Folders</SidebarGroupLabel>
            {activeSessions.length > 0 && (
              <span className="mr-2 text-[11px] text-muted-foreground">
                {activeSessions.length} sessions
              </span>
            )}
          </div>
          <SidebarMenu>
            {isLoading && (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <LoaderCircle className="animate-spin" />
                  <span>Loading folders…</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {!isLoading && projects.length === 0 && (
              <SidebarMenuItem>
                <p className="px-2 py-2 text-xs text-sidebar-foreground/60">
                  No folders yet. Create one to get started.
                </p>
              </SidebarMenuItem>
            )}
            {projects.map((project) => (
              <SidebarMenuItem key={project.id} className="!block">
                <ProjectGroup
                  project={project}
                  sessions={activeSessions.filter(
                    (session) => session.projectId === project.id,
                  )}
                  activeSessionId={activeSessionId}
                  onOpenSession={openSession}
                  onArchive={archiveSession}
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {archivedSessions.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <SidebarGroupLabel className="h-6 text-[11px]">
                Archived · {archivedSessions.length}
              </SidebarGroupLabel>
              <SidebarMenu>
                {archivedSessions.map((session) => (
                  <SidebarMenuItem key={session.id}>
                    <SidebarMenuButton
                      isActive={activeSessionId === session.id}
                      size="sm"
                      onClick={() => openSession(session)}
                      tooltip={`${sessionTitle(session)} · ${sessionStatus(session)}`}>
                      <SessionIcon session={session} />
                      <span className="truncate">{sessionTitle(session)}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      className="right-7"
                      aria-label="Unarchive session"
                      onClick={(event) => {
                        event.stopPropagation();
                        void unarchiveSession(session);
                      }}>
                      <ArchiveRestore />
                    </SidebarMenuAction>
                    <SidebarMenuAction
                      showOnHover
                      aria-label="Delete archived session"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteSession(session);
                      }}>
                      <Trash2 />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}