"use client";

import { useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Command, Plus } from "lucide-react";

import { Chat } from "@/components/chat/chat";
import { PreviewPane } from "@/components/preview/preview-pane";
import { useProjects, useSessions, useSessionSelection } from "@/components/providers";
import { ReviewPane } from "@/components/review/review-pane";
import { SessionHeader } from "@/components/session/session-header";
import { Button } from "@/components/ui/button";
import { useSandboxStatus } from "@/hooks/use-sandbox-status";
import { sessionUISelectors, useSessionUIStore } from "@/lib/session-ui-store";
import { cn } from "@/lib/utils";

const MIN_PANE = 25;
const MAX_PANE = 62;
const clamp = (value: number) => Math.min(MAX_PANE, Math.max(MIN_PANE, Math.round(value)));

export function Home() {
  const router = useRouter();
  const { activeSessionId } = useSessionSelection();
  const { sessions } = useSessions();
  const { projects } = useProjects();
  const active = sessions.find((session) => session.id === activeSessionId) ?? null;
  const project = active?.projectId ? projects.find((item) => item.id === active.projectId) : undefined;
  const sandbox = useSandboxStatus(active?.id);
  const rightPanelOpen = useSessionUIStore(sessionUISelectors.rightPanelOpen);
  const rightPanelTab = useSessionUIStore(sessionUISelectors.rightPanelTab);
  const savedWidth = useSessionUIStore(sessionUISelectors.rightPanelWidth);
  const setRightPanelOpen = useSessionUIStore(sessionUISelectors.setRightPanelOpen);
  const setRightPanelTab = useSessionUIStore(sessionUISelectors.setRightPanelTab);
  const saveWidth = useSessionUIStore(sessionUISelectors.setRightPanelWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const paneWidth = dragWidth ?? savedWidth;
  const panelAvailable = sandbox.state === "available";
  const panelVisible = panelAvailable && rightPanelOpen;

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDragWidth(savedWidth);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragWidth === null) return;
    const row = event.currentTarget.parentElement?.getBoundingClientRect();
    if (row) setDragWidth(clamp(((row.right - event.clientX) / row.width) * 100));
  };
  const endResize = () => {
    if (dragWidth !== null) saveWidth(dragWidth);
    setDragWidth(null);
  };
  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowLeft" ? 3 : event.key === "ArrowRight" ? -3 : 0;
    if (!step) return;
    event.preventDefault();
    saveWidth(clamp(paneWidth + step));
  };

  if (!active) {
    return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background"><SessionHeader /><div className="flex flex-1 flex-col items-center justify-center px-6"><div className="animate-rise max-w-sm rounded-xl border bg-surface-1/50 px-6 py-8 text-center shadow-sm"><span className="mx-auto flex size-9 items-center justify-center rounded-lg border bg-brand-muted text-brand"><Command className="size-4 text-muted-foreground" /></span><h1 className="mt-4 text-base font-medium tracking-[-0.025em]">No session open</h1><p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">Pick a session from the sidebar, or point the agent at a repository to start a new one.</p><Button size="sm" className="mt-4" onClick={() => router.push("/new")}><Plus className="size-3.5" />New project</Button></div></div></div>;
  }

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background">
      <SessionHeader session={active} panelOpen={panelVisible} panelAvailable={panelAvailable} sandboxStatus={sandbox.state} onTogglePanel={() => setRightPanelOpen(!rightPanelOpen)} />
      <div className="flex min-h-0 flex-1">
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", panelVisible && "max-md:hidden")}><Chat key={active.id} session={active} project={project} /></div>
        {panelVisible && <div role="separator" tabIndex={0} aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuenow={paneWidth} aria-valuemin={MIN_PANE} aria-valuemax={MAX_PANE} onPointerDown={beginResize} onPointerMove={resize} onPointerUp={endResize} onPointerCancel={endResize} onKeyDown={nudge} className="relative hidden w-px shrink-0 cursor-col-resize bg-border transition-colors duration-100 after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] hover:bg-brand focus-visible:bg-brand md:block" />}
        {panelVisible && <aside aria-label="Workspace panel" className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background motion-safe:animate-in motion-safe:slide-in-from-right-2 motion-safe:duration-150 md:w-[var(--pane)] md:flex-none" style={{ "--pane": `${paneWidth}%` } as CSSProperties}>
          <div className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-1.5" role="tablist" aria-label="Workspace views">
            <Button role="tab" aria-selected={rightPanelTab === "changes"} aria-controls="changes-panel" id="changes-tab" variant={rightPanelTab === "changes" ? "secondary" : "ghost"} size="sm" onClick={() => setRightPanelTab("changes")}>Changes</Button>
            <Button role="tab" aria-selected={rightPanelTab === "preview"} aria-controls="preview-panel" id="preview-tab" variant={rightPanelTab === "preview" ? "secondary" : "ghost"} size="sm" onClick={() => setRightPanelTab("preview")}>Preview</Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => setRightPanelOpen(false)}>Close</Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div role="tabpanel" id="changes-panel" aria-labelledby="changes-tab" className={cn("flex min-h-0 flex-1 flex-col", rightPanelTab !== "changes" && "hidden")}>
              <ReviewPane session={active} />
            </div>
            <div role="tabpanel" id="preview-panel" aria-labelledby="preview-tab" className={cn("flex min-h-0 flex-1 flex-col", rightPanelTab !== "preview" && "hidden")}>
              <PreviewPane sessionId={active.id} sandboxId={active.sandbox} />
            </div>
          </div>
        </aside>}
      </div>
    </div>
  );
}

export default Home;
