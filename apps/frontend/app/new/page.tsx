"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderGit2, LoaderCircle } from "lucide-react";
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

export default function NewPage() {
  const router = useRouter();
  const { selectSession } = useSessionSelection();
  const [prompt, setPrompt] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [creating, setCreating] = useState(false);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!gitUrl.trim()) {
      toast.error("Enter a Git repository URL.");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Describe what you want to work on.");
      return;
    }

    setCreating(true);
    const loadingToast = toast.loading("Creating folder and starting sandbox…");
    try {
      const response = await fetch(`${API}/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          gitUrl: gitUrl.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not create project.");

      toast.success("Project created", {
        id: loadingToast,
        description: "Your repository workspace is ready.",
      });
      window.sessionStorage.setItem("opendevin:initial-prompt", prompt.trim());
      selectSession(data.sessionId);
      router.push(`/s/${data.sessionId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create project.", {
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
        <h1 className="ml-2 text-sm font-medium">New project</h1>
      </header>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-10">
        <form onSubmit={createProject} className="w-full max-w-lg">
          <p className="text-sm text-muted-foreground">
            Create a folder for a repository. Every session in the folder gets
            its own sandbox with the same repository checked out.
          </p>

          <label className="mt-5 block text-sm font-medium">
            Git repository URL
            <Input
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              className="mt-1.5"
              autoFocus
            />
          </label>

          <label className="mt-4 block text-sm font-medium">
            What should the first session do?
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the change you want made…"
              rows={4}
              className="mt-1.5 min-h-24 resize-y"
            />
          </label>

          <Button type="submit" className="mt-4" disabled={creating}>
            {creating ? <LoaderCircle className="animate-spin" /> : <FolderGit2 />}
            {creating ? "Creating…" : "Create project"}
          </Button>
        </form>
      </div>
    </main>
  );
}