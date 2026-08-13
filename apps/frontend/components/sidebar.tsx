"use client";

import { useQuery as useConvexQuery } from "convex/react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  CircleDashed,
  Command,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import {
  API,
  sessionTitle,
  type Session,
  useSessionSelection,
} from "@/components/providers";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
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

export function AppSidebar() {
  const sessionsResult = useConvexQuery(api.sessions.list, {});
  const sessions = ((sessionsResult ?? []) as unknown as Array<Record<string, unknown>>).map((session) => ({
    ...session,
    id: String(session.id ?? session._id),
    createdAt: new Date(Number(session.createdAt)).toISOString(),
    updatedAt: new Date(Number(session.updatedAt)).toISOString(),
  })) as Session[];
  const isLoading = sessionsResult === undefined;
  const isError = false;
  const { activeSessionId, selectSession } = useSessionSelection();
  const router = useRouter();
  const workingCount = sessions.filter(
    (session) => !session.archived && session.status === "running",
  ).length;
  const activeSessions = sessions.filter((session) => !session.archived);
  const archivedSessions = sessions.filter((session) => session.archived);

  async function archiveSession(session: Session) {
    const message = session.sandbox
      ? "Archive this session? Its sandbox will be stopped."
      : "Archive this chat?";
    if (!window.confirm(message)) return;

    try {
      const response = await fetch(`${API}/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not archive session.");
      if (activeSessionId === session.id) selectSession(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not archive session.");
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
      if (!response.ok) throw new Error(data.message || "Could not unarchive session.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not unarchive session.");
    }
  }

  async function deleteSession(session: Session) {
    if (!window.confirm("Delete this archived chat permanently? This cannot be undone.")) return;
    try {
      const response = await fetch(`${API}/sessions/${session.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not delete session.");
      if (activeSessionId === session.id) selectSession(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not delete session.");
    }
  }

  function renderSession(session: Session) {
    const working = session.status === "running";
    return (
      <SidebarMenuItem key={session.id}>
        <SidebarMenuButton
          isActive={activeSessionId === session.id}
          size="sm"
          onClick={() => {
            selectSession(session.id);
            router.push(`/s/${session.id}`);
          }}
          tooltip={`${sessionTitle(session)} · ${sessionStatus(session)}`}>
          {session.archived ? (
            <Archive className="text-muted-foreground" />
          ) : working ? (
            <LoaderCircle className="animate-spin text-emerald-600" />
          ) : session.status === "stopped" ? (
            <CircleDashed />
          ) : (
            <CheckCircle2 />
          )}
          <span className="truncate">{sessionTitle(session)}</span>
        </SidebarMenuButton>
        {!session.archived ? (
          <SidebarMenuAction
            showOnHover
            aria-label={`Archive ${session.sandbox ? "session" : "chat"}`}
            onClick={(event) => {
              event.stopPropagation();
              void archiveSession(session);
            }}>
            <Archive />
          </SidebarMenuAction>
        ) : (
          <>
            <SidebarMenuAction
              showOnHover
              className="right-7"
              aria-label="Unarchive chat"
              onClick={(event) => {
                event.stopPropagation();
                void unarchiveSession(session);
              }}>
              <ArchiveRestore />
            </SidebarMenuAction>
            <SidebarMenuAction
              showOnHover
              aria-label="Delete archived chat"
              onClick={(event) => {
                event.stopPropagation();
                void deleteSession(session);
              }}>
              <Trash2 />
            </SidebarMenuAction>
          </>
        )}
      </SidebarMenuItem>
    );
  }

  return (
    <Sidebar className="border-r bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="flex h-10 w-full flex-row items-center justify-between gap-2 border-b px-2 py-0">
        <div className="flex items-center gap-2">
          <Command className="size-5 rounded-sm bg-primary p-1 text-primary-foreground" />
          <span className="text-sm font-medium tracking-tight">
            OpenDevin
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New session"
                onClick={() => {
                  selectSession(null);
                  router.push("/new");
                }}>
                <Plus />
              </Button>
            }
          />
          <TooltipContent>New session</TooltipContent>
        </Tooltip>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center justify-between">
            <SidebarGroupLabel>Sessions</SidebarGroupLabel>
            {workingCount > 0 && (
              <span className="mr-2 text-[11px] text-muted-foreground">
                {workingCount} active
              </span>
            )}
          </div>
          <SidebarGroupAction className="sr-only" aria-label="New session">
            <Plus />
          </SidebarGroupAction>
          <SidebarMenu>
            {isLoading && (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <LoaderCircle className="animate-spin" />
                  <span>Loading sessions…</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {isError && (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <span>Couldn’t load sessions</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {!isLoading && !isError && activeSessions.length === 0 && (
              <SidebarMenuItem>
                <p className="px-2 py-2 text-xs text-sidebar-foreground/60">
                  No active sessions
                </p>
              </SidebarMenuItem>
            )}
            {activeSessions.map(renderSession)}
          </SidebarMenu>
          {archivedSessions.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <SidebarGroupLabel className="h-6 text-[11px]">
                Archived · {archivedSessions.length}
              </SidebarGroupLabel>
              <SidebarMenu>{archivedSessions.map(renderSession)}</SidebarMenu>
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
