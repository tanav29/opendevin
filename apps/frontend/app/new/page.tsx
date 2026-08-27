"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { ArrowRight, FolderGit2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { GitHubRepositoryBranchPicker } from "@/components/github/repository-branch-picker";
import { useProjects, useSessionSelection } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { PageHeader, PageShell, PageContainer } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { repoName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";

function folderName(gitUrl: string) {
  return (
    gitUrl.split("/").pop()?.replace(/\.git$/, "").replace(/[^a-zA-Z0-9._-]/g, "-") || "repository"
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mt-6 block">
      <span className="text-[13px] font-medium tracking-[-0.01em]">{label}</span>
      {hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export default function NewPage() {
  const router = useRouter();
  const { selectSession } = useSessionSelection();
  const createProject = useMutation(api.projects.create);
  const createSession = useMutation(api.sessions.create);
  const { projects } = useProjects();
  const [prompt, setPrompt] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [baseBranch, setBaseBranch] = useState<string>();
  const [creating, setCreating] = useState(false);

  const url = gitUrl.trim();
  const valid = url.length > 0;
  const existing = projects.find((p) => p.git === url);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const task = prompt.trim();
    if (!url) {
      toast.error("Choose a repository first.");
      return;
    }
    if (!task) {
      toast.error("Describe what the first session should do.");
      return;
    }
    setCreating(true);
    const loading = toast.loading("Creating project…");
    try {
      const rawProject = existing ? ({ _id: existing.id } as never) : await createProject({ git: url, name: folderName(url) });
      const project = rawProject as unknown as { _id: string; _creationTime: number } | null;
      if (!project) throw new Error("Could not create the project.");
      const session = await createSession({
        projectId: project._id as never,
        git: url,
        status: "idle",
        title: task.slice(0, 80),
        baseBranch,
      });
      if (!session) throw new Error("Could not create the session.");
      toast.success("Project ready.", { id: loading, description: "Opening your first session…" });
      window.sessionStorage.setItem("opendevin:initial-prompt", task);
      const sid = (session as unknown as { _id: string })._id;
      selectSession(sid);
      router.push(`/s/${sid}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the project.", { id: loading });
      setCreating(false);
    }
  }

  return (
    <PageShell header={<PageHeader title="New project" />}>
      <PageContainer size="sm" className="pt-10 pb-12">
        <form onSubmit={submit} className="animate-rise">
          <p className="eyebrow">Start here</p>
          <h2 className="mt-2 text-[22px] font-medium tracking-[-0.025em]">Point the agent at a repository</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            A project holds every session for one repository. Each session runs in its own sandbox, so parallel
            work never collides.
          </p>

          <Field label="Repository">
            <GitHubRepositoryBranchPicker
              value={{ git: gitUrl, baseBranch }}
              onChange={({ git, baseBranch: next }) => {
                setGitUrl(git);
                setBaseBranch(next);
              }}
            />
            <span
              className={cn(
                "mt-2 flex items-center gap-1.5 text-[11.5px]",
                valid ? "text-muted-foreground" : "text-transparent",
              )}
            >
              <FolderGit2 className="size-3 shrink-0" />
              {valid && (
                <span className="mono truncate">
                  {existing ? `Adds a session to ${existing.name}` : repoName(url)}
                </span>
              )}
            </span>
          </Field>

          <Field label="First task" hint="The agent starts on this as soon as the session opens.">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the change you want made…"
              rows={4}
              className="min-h-24 resize-y text-[13px] leading-relaxed"
            />
          </Field>

          <Button type="submit" className="mt-6 w-full sm:w-auto" disabled={creating}>
            {creating ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
            {creating ? "Creating…" : "Create project and start"}
          </Button>
        </form>
      </PageContainer>
    </PageShell>
  );
}
