"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
import { ArrowRight, FolderGit2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { GitHubRepositoryBranchPicker } from "@/components/github/repository-branch-picker";
import { useSessionSelection } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { repoName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";

const GIT_URL_PATTERN =
  /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[^\s/]+\/[^\s/]+/i;

/** A folder name derived from the repository, safe to show and store. */
function folderName(gitUrl: string) {
  return (
    gitUrl
      .split("/")
      .pop()
      ?.replace(/\.git$/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-") || "repository"
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-5 block">
      <span className="text-[13px] font-medium">{label}</span>
      {hint && (
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
          {hint}
        </span>
      )}
      <span className="mt-1.5 block">{children}</span>
    </label>
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
  const [baseBranch, setBaseBranch] = useState<string>();
  const [creating, setCreating] = useState(false);

  const url = gitUrl.trim();
  const validUrl = GIT_URL_PATTERN.test(url);
  const existing = (projects ?? []).find((project) => project.git === url);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const task = prompt.trim();
    if (!validUrl) {
      toast.error("Enter a public repository URL from GitHub, GitLab, or Bitbucket.");
      return;
    }
    if (!task) {
      toast.error("Describe what the first session should do.");
      return;
    }

    setCreating(true);
    const loading = toast.loading("Creating the project…");
    try {
      const project =
        existing ?? (await createProject({ git: url, name: folderName(url) }));
      if (!project) throw new Error("Could not create the project.");
      const session = await createSession({
        projectId: project._id as never,
        git: url,
        status: "idle",
        title: task.slice(0, 80),
        baseBranch,
      });
      if (!session) throw new Error("Could not create the session.");

      toast.success("Project created.", {
        id: loading,
        description: "The repository is checked out when the agent starts.",
      });
      window.sessionStorage.setItem("opendevin:initial-prompt", task);
      selectSession(session._id);
      router.push(`/s/${session._id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the project.",
        { id: loading },
      );
      setCreating(false);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="z-10 flex h-11 shrink-0 items-center gap-1.5 border-b px-1.5 sm:px-2">
        <Tooltip>
          <TooltipTrigger render={<SidebarTrigger />} />
          <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
        </Tooltip>
        <h1 className="text-[13px] font-medium tracking-[-0.01em]">
          New project
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <form
          onSubmit={submit}
          className="mx-auto w-full max-w-lg px-4 pt-10 pb-12 sm:px-6"
        >
          <h2 className="text-xl font-medium tracking-[-0.02em]">
            Point the agent at a repository
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            A project holds every session for one repository. Each session runs
            in its own sandbox, so parallel work never collides.
          </p>

          <Field
            label="Repository URL"
            hint="Paste a public URL, or choose a repository you connected from GitHub."
          >
            <Input
              value={gitUrl}
              onChange={(event) => {
                setGitUrl(event.target.value);
                setBaseBranch(undefined);
              }}
              placeholder="https://github.com/owner/repository"
              autoFocus
              spellCheck={false}
              autoCapitalize="none"
              aria-invalid={url.length > 0 && !validUrl}
              className="mono text-[13px]"
            />
            <GitHubRepositoryBranchPicker
              value={{ git: gitUrl, baseBranch }}
              onChange={({ git, baseBranch: nextBranch }) => {
                setGitUrl(git);
                setBaseBranch(nextBranch);
              }}
            />
            <span
              className={cn(
                "mt-1.5 flex items-center gap-1.5 text-[11.5px]",
                validUrl ? "text-muted-foreground" : "text-transparent",
              )}
            >
              <FolderGit2 className="size-3 shrink-0" />
              {validUrl && (
                <span className="mono truncate">
                  {existing
                    ? `Adds a session to ${existing.name}`
                    : repoName(url)}
                </span>
              )}
            </span>
          </Field>

          <Field
            label="First task"
            hint="The agent starts on this as soon as the session opens."
          >
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the change you want made…"
              rows={4}
              className="min-h-24 resize-y text-[13.5px] leading-relaxed"
            />
          </Field>

          <Button type="submit" className="mt-5" disabled={creating}>
            {creating ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <ArrowRight />
            )}
            {creating ? "Creating…" : "Create project and start"}
          </Button>
        </form>
      </div>
    </div>
  );
}
