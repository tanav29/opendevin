"use client";

import {
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Command, Plus } from "lucide-react";

import { Chat } from "@/components/chat/chat";
import { useProjects, useSessions, useSessionSelection } from "@/components/providers";
import { ReviewPane } from "@/components/review/review-pane";
import { PreviewPane } from "@/components/preview/preview-pane";
import { SessionHeader } from "@/components/session/session-header";
import { Button } from "@/components/ui/button";
import { usePersisted } from "@/lib/persisted";
import { useMediaQuery } from "@/lib/media";
import { cn } from "@/lib/utils";

const MIN_PANE = 25;
const MAX_PANE = 62;
const DEFAULT_PANE = 40;
const WIDTH_KEY = "opendevin:pane-width";
const COLLAPSED_KEY = "opendevin:pane-collapsed";

const clamp = (value: number) => Math.min(MAX_PANE, Math.max(MIN_PANE, Math.round(value)));

const readWidth = (raw: string | null) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? clamp(value) : DEFAULT_PANE;
};

const readCollapsed = (raw: string | null) => (raw === null ? window.innerWidth < 768 : raw === "true");

export function Home() {
  const router = useRouter();
  const { activeSessionId } = useSessionSelection();
  const { sessions } = useSessions();
  const { projects } = useProjects();
  const active = sessions.find((s) => s.id === activeSessionId) ?? null;
  const project = active?.projectId ? projects.find((item) => item.id === active.projectId) : undefined;

  const [savedWidth, saveWidth] = usePersisted(WIDTH_KEY, DEFAULT_PANE, readWidth);
  const [savedCollapsed, setSavedCollapsed] = usePersisted(COLLAPSED_KEY, false, readCollapsed);
  const wide = useMediaQuery("(min-width: 768px)");
  const [showingDiff, setShowingDiff] = useState(false);
  const [showingPreview, setShowingPreview] = useState(false);
  const collapsed = wide ? savedCollapsed : !showingDiff;
  function togglePane() {
    if (wide) setSavedCollapsed(!savedCollapsed);
    else setShowingDiff(!showingDiff);
  }
  function togglePreview() {
    if (wide) setSavedCollapsed(false);
    else setShowingDiff(true);
    setShowingPreview((value) => !value);
  }
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const paneWidth = dragWidth ?? savedWidth;

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDragWidth(savedWidth);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragWidth === null) return;
    const row = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!row) return;
    setDragWidth(clamp(((row.right - event.clientX) / row.width) * 100));
  };
  const endResize = () => {
    if (dragWidth === null) return;
    saveWidth(dragWidth);
    setDragWidth(null);
  };
  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowLeft" ? 3 : event.key === "ArrowRight" ? -3 : 0;
    if (!step) return;
    event.preventDefault();
    saveWidth(clamp(paneWidth + step));
  };

  if (!active) {
    return (
      <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background">
        <SessionHeader />
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="animate-rise max-w-sm rounded-xl border bg-surface-1/50 px-6 py-8 text-center shadow-sm">
            <span className="mx-auto flex size-9 items-center justify-center rounded-lg border bg-brand-muted text-brand">
              <Command className="size-4 text-muted-foreground" />
            </span>
            <h1 className="mt-4 text-base font-medium tracking-[-0.025em]">No session open</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              Pick a session from the sidebar, or point the agent at a repository to start a new one.
            </p>
            <Button size="sm" className="mt-4" onClick={() => router.push("/new")}>
              <Plus className="size-3.5" />
              New project
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background">
      <SessionHeader session={active} />
      <div className="flex min-h-0 flex-1">
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !collapsed && "max-md:hidden")}>
          <Chat key={active.id} session={active} project={project} />
        </div>
        {!collapsed && (
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize the changes pane"
            aria-orientation="vertical"
            aria-valuenow={paneWidth}
            aria-valuemin={MIN_PANE}
            aria-valuemax={MAX_PANE}
            onPointerDown={beginResize}
            onPointerMove={resize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={nudge}
            className="relative hidden w-px shrink-0 cursor-col-resize bg-border transition-colors duration-100 after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] hover:bg-brand focus-visible:bg-brand md:block"
          />
        )}
        {showingPreview ? (
          <aside className={cn("flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background", collapsed ? "hidden" : "w-full md:w-[var(--pane)] md:flex-none")} style={collapsed ? undefined : ({ "--pane": `${paneWidth}%` } as CSSProperties)}>
            <header className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-1.5">
              <Button variant="ghost" size="sm" onClick={() => setShowingPreview(false)}>Changes</Button>
              <span className="rounded-md bg-surface-2 px-2 py-1 text-[13px] font-medium">Preview</span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setShowingPreview(false)}>Close</Button>
            </header>
            <PreviewPane sessionId={active.id} />
          </aside>
        ) : <ReviewPane
          session={active}
          collapsed={collapsed}
          onToggle={togglePane}
          onPreview={togglePreview}
          className={collapsed ? undefined : "w-full md:w-[var(--pane)] md:flex-none"}
          style={collapsed ? undefined : ({ "--pane": `${paneWidth}%` } as CSSProperties)}
        />}
      </div>
    </div>
  );
}

export default Home;
