"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleDashed,
  Command,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { API, type Session, useSessionSelection } from "@/components/providers";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

async function getSessions(): Promise<Session[]> {
  const response = await fetch(`${API}/sessions`);
  if (!response.ok) throw new Error("Could not load sessions");
  return response.json();
}

function sessionName(session: Session) {
  return (
    session.git
      .split("/")
      .pop()
      ?.replace(/\.git$/, "") || "Untitled workspace"
  );
}

export function AppSidebar() {
  const {
    data: sessions = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["sessions"],
    queryFn: getSessions,
    refetchInterval: 5000,
  });
  const { activeSessionId, selectSession } = useSessionSelection();
  const router = useRouter();
  const workingCount = sessions.filter((session) =>
    ["working", "running", "starting"].includes(session.status),
  ).length;

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
                aria-label="New workspace"
                onClick={() => {
                  selectSession(null);
                  router.push("/new");
                }}>
                <Plus />
              </Button>
            }
          />
          <TooltipContent>New workspace</TooltipContent>
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
            {!isLoading && !isError && sessions.length === 0 && (
              <SidebarMenuItem>
                <p className="px-2 py-2 text-xs text-sidebar-foreground/60">
                  No sessions yet
                </p>
              </SidebarMenuItem>
            )}
            {sessions.map((session) => {
              const working = ["working", "running", "starting"].includes(
                session.status,
              );
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
                    {working ? (
                      <LoaderCircle className="animate-spin text-emerald-600" />
                    ) : session.status === "stopped" ? (
                      <CircleDashed />
                    ) : (
                      <CheckCircle2 />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate">
                        {sessionName(session)}
                      </span>
                      <span className="block text-[10px] font-normal capitalize text-muted-foreground">
                        {session.status || "idle"}
                      </span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
