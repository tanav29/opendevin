"use client";

import { useQuery as useConvexQuery } from "convex/react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CheckCircle2,
  CircleDashed,
  Command,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { type Session, useSessionSelection } from "@/components/providers";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
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

function sessionName(session: Session) {
  return (
    session.git
      .split("/")
      .pop()
      ?.replace(/\.git$/, "") || (session.sandbox ? "Untitled workspace" : "Chat")
  );
}

function sessionStatus(session: Session) {
  if (session.archived) return "Archived";
  if (session.status === "running") return "working";
  if (!session.sandbox) return "Chat";
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

  function renderSession(session: Session) {
    const working = session.status === "running";
    return (
      <SidebarMenuItem key={session.id}>
        <SidebarMenuButton
          isActive={activeSessionId === session.id}
          onClick={() => {
            selectSession(session.id);
            router.push(`/s/${session.id}`);
          }}
          tooltip={sessionName(session)}
          className="h-fit">
          {session.archived ? (
            <Archive className="text-muted-foreground" />
          ) : working ? (
            <LoaderCircle className="animate-spin text-emerald-600" />
          ) : session.status === "stopped" ? (
            <CircleDashed />
          ) : (
            <CheckCircle2 />
          )}
          <span className="min-w-0">
            <span className="block truncate">{sessionName(session)}</span>
            <span className="block text-[10px] font-normal capitalize text-muted-foreground">
              {sessionStatus(session)}
            </span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Sidebar>
      <SidebarHeader className="flex w-full flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Command className="size-7 rounded-md bg-primary p-1.5 text-primary-foreground" />
          <span className="text-sm font-semibold tracking-tight">
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
              <span className="mr-2 text-[10px] text-emerald-600">
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
            <div className="mt-5 border-t border-sidebar-border/70 pt-4">
              <SidebarGroupLabel className="h-7 text-[10px] uppercase tracking-[0.16em]">
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
