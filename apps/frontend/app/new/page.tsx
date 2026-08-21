"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { FolderGit2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSessionSelection } from "@/components/providers";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@convex/_generated/api";

const GIT_URL_PATTERN =
  /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[^\s/]+\/[^\s/]+/i;

function repoName(gitUrl: string) {
  return (
    gitUrl
      .split("/")
      .pop()
      ?.replace(/\.git$/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-") || "repository"
  );
}

export default function NewPage() {
  const router = useRouter();
  const { selectSession } = useSessionSelection();
  const createProject = useMutation(api.projects.create);
  const createSession = useMutation(api.sessions.create);
  const projects = useConvexQuery(api.projects.list, {}) as
    | { _id: string; git: string; name: string }[]
    | undefined;
  const [prompt, setPrompt] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [creating, setCreating] = useState(false);

  async function createProjectHandler(event: FormEvent) {
    event.preventDefault();
    const url = gitUrl.trim();
    const task = prompt.trim();
    if (!url) {
      toast.error("Enter a Git repository URL.");
      return;
    }
    if (!GIT_URL_PATTERN.test(url)) {
      toast.error("Enter a valid public Git repository URL.");
      return;
    }
    if (!task) {
      toast.error("Describe what you want to work on.");
      return;
    }

    setCreating(true);
    const loadingToast = toast.loading("Creating workspace…");
    try {
      const existing = (projects ?? []).find(
        (project) => project.git === url,
      );
      const project = existing
        ? existing
        : await createProject({ git: url, name: repoName(url) });
      if (!project) throw new Error("Could not create project.");
      const session = await createSession({
        projectId: project._id as never,
        git: url,
        status: "idle",
        title: task.slice(0, 80),
      });
      if (!session) throw new Error("Could not create session.");

      toast.success("Project created", {
        id: loadingToast,
        description: "The repository will be checked out when the agent starts.",
      });
      window.sessionStorage.setItem("opendevin:initial-prompt", task);
      selectSession(session._id);
      router.push(`/s/${session._id}`);
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
        <form onSubmit={createProjectHandler} className="w-full max-w-lg">
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
