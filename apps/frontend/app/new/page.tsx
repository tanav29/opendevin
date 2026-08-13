"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, FolderGit2, LoaderCircle, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { API, useSessionSelection } from "@/components/providers";

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
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f8] px-4 py-10 text-[#172027]">
      <form
        onSubmit={createSession}
        className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            New session
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Start working with OpenDevin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Use an isolated repository workspace, or start a chat without a sandbox.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            aria-pressed={!chatOnly}
            onClick={() => setChatOnly(false)}
            className={`rounded-xl border p-4 text-left transition-colors ${!chatOnly ? "border-primary bg-primary/5" : "border-black/10 hover:bg-muted/50"}`}>
            <FolderGit2 className="size-5" />
            <p className="mt-3 text-sm font-medium">Workspace</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Run an agent in a sandbox, optionally cloned from Git.</p>
          </button>
          <button
            type="button"
            aria-pressed={chatOnly}
            onClick={() => setChatOnly(true)}
            className={`rounded-xl border p-4 text-left transition-colors ${chatOnly ? "border-primary bg-primary/5" : "border-black/10 hover:bg-muted/50"}`}>
            <MessageSquareText className="size-5" />
            <p className="mt-3 text-sm font-medium">Chat only</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Ask questions and plan work without creating a sandbox.</p>
          </button>
        </div>

        {!chatOnly && (
          <label className="mt-6 block text-sm font-medium">
            Git repository URL <span className="font-normal text-muted-foreground">(optional)</span>
            <Input
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              className="mt-2"
            />
          </label>
        )}

        <label className="mt-6 block text-sm font-medium">
          What do you want to do?
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={chatOnly ? "Ask a question or describe what you need…" : "Describe the change you want made…"}
            rows={5}
            className="mt-2 resize-y"
            autoFocus
          />
        </label>

        <Button type="submit" size="lg" className="mt-6 w-full" disabled={creating}>
          {creating ? <LoaderCircle className="animate-spin" /> : <Bot />}
          {creating ? "Creating…" : chatOnly ? "Start chat" : "Create workspace"}
        </Button>
      </form>
    </main>
  );
}
