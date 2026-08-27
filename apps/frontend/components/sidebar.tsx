"use client";

import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Command,
  FolderGit2,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  mapProjects,
  mapSessions,
  sessionTitle,
  useSessionSelection,
  type Project,
  type Session,
} from "@/components/providers";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useConfirm } from "@/components/ui/confirm";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { StatusDot, statusLabel } from "@/components/ui/status-dot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { timeAgo } from "@/lib/format";
import { api } from "@convex/_generated/api";

/** Row actions sit on top of the label, so the metadata yields on hover. */
const ACTION = "opacity-0 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100";
const META = "transition-opacity group-hover/menu-sub-item:opacity-0";

function SessionRow({
  session,
  active,
  onOpen,
  actions,
}: {
  session: Session;
  active: boolean;
  onOpen: () => void;
  actions: React.ReactNode;
}) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={active}
        onClick={onOpen}
        render={<button type="button" />}
        title={`${sessionTitle(session)} · ${statusLabel(session.status)}`}
        className="w-full text-left"
      >
        <StatusDot status={session.archived ? "stopped" : session.status} />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          {sessionTitle(session)}
        </span>
      </SidebarMenuSubButton>
      <span
        data-numeric
        className={`pointer-events-none absolute top-1.5 right-2 text-[10px] text-muted-foreground ${META}`}
      >
        {timeAgo(session.updatedAt)}
      </span>
      {actions}
    </SidebarMenuSubItem>
  );
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
  const router = useRouter();
  const working = sessions.filter((session) => session.status === "running").length;

  return (
    <SidebarMenuItem className="!block">
      <Collapsible defaultOpen>
        <CollapsibleTrigger
          render={<SidebarMenuButton size="sm" />}
          title={project.git}
        >
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform duration-150 group-data-[panel-open]/menu-button:rotate-90" />
          <FolderGit2 className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[12.5px]">
            {project.name}
          </span>
          {working > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-brand">
              <StatusDot status="running" />
              {working}
            </span>
          ) : (
            <span data-numeric className="shrink-0 text-[10px] text-muted-foreground">
              {sessions.length || ""}
            </span>
          )}
        </CollapsibleTrigger>
        <SidebarMenuAction
          className="opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100"
          aria-label={`New session in ${project.name}`}
          onClick={() => router.push(`/p/${project.id}`)}
        >
          <Plus />
        </SidebarMenuAction>
        <CollapsiblePanel>
          <SidebarMenuSub>
            {sessions.length === 0 && (
              <SidebarMenuSubItem>
                <p className="px-2 py-1 text-[11.5px] text-muted-foreground">
                  No sessions yet
                </p>
              </SidebarMenuSubItem>
            )}
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={activeSessionId === session.id}
                onOpen={() => onOpenSession(session)}
                actions={
                  <SidebarMenuAction
                    className={`top-1 ${ACTION}`}
                    aria-label="Archive session"
                    onClick={() => onArchive(session)}
                  >
                    <Archive />
                  </SidebarMenuAction>
                }
              />
            ))}
          </SidebarMenuSub>
        </CollapsiblePanel>
      </Collapsible>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const projectsResult = useConvexQuery(api.projects.list, {});
  const sessionsResult = useConvexQuery(api.sessions.list, {});
  const user = useConvexQuery(api.users.current, {}) as
    | { name?: string; email?: string; image?: string }
    | null
    | undefined;
  const projects = mapProjects(projectsResult as unknown[] | undefined);
  const sessions = mapSessions(sessionsResult as unknown[] | undefined);
  const loading = projectsResult === undefined || sessionsResult === undefined;
  const { activeSessionId, selectSession } = useSessionSelection();
  const router = useRouter();
  const confirm = useConfirm();
  const updateSession = useMutation(api.sessions.update);
  const removeSession = useMutation(api.sessions.remove);
  const live = sessions.filter((session) => !session.archived);
  const archived = sessions.filter((session) => session.archived);

  const failed = (error: unknown, fallback: string) =>
    toast.error(error instanceof Error ? error.message : fallback);

  async function archiveSession(session: Session) {
    const ok = await confirm({
      title: "Archive this session?",
      description:
        "It moves to the archived list below. The transcript and diff are kept.",
      confirmLabel: "Archive",
    });
    if (!ok) return;
    try {
      await updateSession({ id: session.id as never, archived: true });
      if (activeSessionId === session.id) selectSession(null);
    } catch (error) {
      failed(error, "Could not archive the session.");
    }
  }

  async function unarchiveSession(session: Session) {
    try {
      await updateSession({ id: session.id as never, archived: false });
    } catch (error) {
      failed(error, "Could not restore the session.");
    }
  }

  async function deleteSession(session: Session) {
    const ok = await confirm({
      title: "Delete this session?",
      description:
        "The transcript and diff are removed for good. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeSession({ id: session.id as never });
      if (activeSessionId === session.id) selectSession(null);
      toast.success("Session deleted.");
    } catch (error) {
      failed(error, "Could not delete the session.");
    }
  }

  const openSession = (session: Session) => {
    selectSession(session.id);
    router.push(`/s/${session.id}`);
  };

  return (
    <Sidebar className="border-r bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="flex h-11 w-full flex-row items-center justify-between gap-2 border-b px-2.5 py-0">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex min-w-0 items-center gap-2 rounded-md text-left"
        >
          <Command className="size-4 shrink-0" />
          <span className="truncate text-[13px] font-medium tracking-[-0.01em]">
            OpenDevin
          </span>
        </button>
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
                }}
              >
                <Plus />
              </Button>
            }
          />
          <TooltipContent side="right">New project</TooltipContent>
        </Tooltip>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarMenu>
            {loading &&
              ["64%", "82%", "55%"].map((width) => (
                <SidebarMenuItem key={width}>
                  <SidebarMenuSkeleton showIcon width={width} />
                </SidebarMenuItem>
              ))}
            {!loading && projects.length === 0 && (
              <SidebarMenuItem className="!block px-2 py-1.5">
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  No projects yet. Add a repository to get started.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => router.push("/new")}
                >
                  <Plus />
                  New project
                </Button>
              </SidebarMenuItem>
            )}
            {projects.map((project) => (
              <ProjectGroup
                key={project.id}
                project={project}
                sessions={live.filter(
                  (session) => session.projectId === project.id,
                )}
                activeSessionId={activeSessionId}
                onOpenSession={openSession}
                onArchive={archiveSession}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {archived.length > 0 && (
          <SidebarGroup className="mt-auto border-t pt-2">
            <Collapsible>
              <CollapsibleTrigger
                render={<SidebarMenuButton size="sm" />}
                className="text-muted-foreground"
              >
                <ChevronRight className="size-3.5 transition-transform duration-150 group-data-[panel-open]/menu-button:rotate-90" />
                <span className="flex-1 text-left text-[12.5px]">Archived</span>
                <span data-numeric className="text-[10px]">
                  {archived.length}
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <SidebarMenuSub>
                  {archived.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      active={activeSessionId === session.id}
                      onOpen={() => openSession(session)}
                      actions={
                        <>
                          <SidebarMenuAction
                            className={`top-1 right-7 ${ACTION}`}
                            aria-label="Restore session"
                            onClick={() => void unarchiveSession(session)}
                          >
                            <ArchiveRestore />
                          </SidebarMenuAction>
                          <SidebarMenuAction
                            className={`top-1 hover:text-danger ${ACTION}`}
                            aria-label="Delete session"
                            onClick={() => void deleteSession(session)}
                          >
                            <Trash2 />
                          </SidebarMenuAction>
                        </>
                      }
                    />
                  ))}
                </SidebarMenuSub>
              </CollapsiblePanel>
            </Collapsible>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              onClick={() => router.push("/settings")}
              title="Account settings"
            >
              {user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="size-4 rounded-full" />
              ) : (
                <span className="grid size-4 rounded-full bg-surface-3 text-[8px] font-medium">
                  {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[12.5px]">
                {user?.name || user?.email || "Account"}
              </span>
              <Settings className="size-3.5 text-muted-foreground" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
