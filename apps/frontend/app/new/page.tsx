"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, FolderGit2, LoaderCircle, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { API, useSessionSelection } from "@/components/providers";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export default function NewPage() {
  const router = useRouter();
  const { selectSession } = useSessionSelection();
  const [prompt, setPrompt] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [chatOnly, setChatOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) {
      toast.error("Describe what you want to work on.");
      return;
    }

    setCreating(true);
    const loadingToast = toast.loading(
      chatOnly ? "Creating chat…" : "Starting sandbox…",
    );
    try {
      const response = await fetch(`${API}/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          sandbox: !chatOnly,
          ...(gitUrl.trim() && !chatOnly ? { gitUrl: gitUrl.trim() } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not create session.");

      toast.success(chatOnly ? "Chat created" : "Workspace started", {
        id: loadingToast,
        description: chatOnly
          ? "You can now chat without a sandbox."
          : "Your repository workspace is ready.",
      });
      window.sessionStorage.setItem("opendevin:initial-prompt", prompt.trim());
      selectSession(data.sessionId);
      router.push(`/s/${data.sessionId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create session.", {
        id: loadingToast,
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <header className="z-10 flex h-10 shrink-0 items-center border-b px-2 sm:px-3">
        <Tooltip>
          <TooltipTrigger render={<SidebarTrigger />} />
          <TooltipContent>Toggle sidebar</TooltipContent>
        </Tooltip>
        <h1 className="ml-2 text-sm font-medium">New session</h1>
      </header>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-10">
        <form onSubmit={createSession} className="w-full max-w-lg">
          <p className="text-sm text-muted-foreground">
            Isolated workspace, or a chat without a sandbox.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={!chatOnly}
              onClick={() => setChatOnly(false)}
              className={cn(
                "rounded-md border p-3 text-left",
                !chatOnly ? "border-foreground/20 bg-muted" : "hover:bg-muted/50",
              )}>
              <FolderGit2 className="size-4 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Workspace</p>
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                Agent in a sandbox, optionally cloned from Git.
              </p>
            </button>
            <button
              type="button"
              aria-pressed={chatOnly}
              onClick={() => setChatOnly(true)}
              className={cn(
                "rounded-md border p-3 text-left",
                chatOnly ? "border-foreground/20 bg-muted" : "hover:bg-muted/50",
              )}>
              <MessageSquareText className="size-4 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Chat only</p>
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                Questions and planning, no sandbox.
              </p>
            </button>
          </div>

          {!chatOnly && (
            <label className="mt-5 block text-sm font-medium">
              Git repository URL{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
              <Input
                value={gitUrl}
                onChange={(event) => setGitUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                className="mt-1.5"
              />
            </label>
          )}

          <label className="mt-4 block text-sm font-medium">
            What do you want to do?
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                chatOnly
                  ? "Ask a question or describe what you need…"
                  : "Describe the change you want made…"
              }
              rows={4}
              className="mt-1.5 min-h-24 resize-y"
              autoFocus
            />
          </label>

          <Button type="submit" className="mt-4" disabled={creating}>
            {creating ? <LoaderCircle className="animate-spin" /> : <Bot />}
            {creating ? "Creating…" : chatOnly ? "Start chat" : "Create workspace"}
          </Button>
        </form>
      </div>
    </main>
  );
}
