"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckIcon, PlusSignIcon, Search01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MAX_SKILLS, type SkillRef } from "./use-skills";

function formatInstalls(installs?: number) {
  if (!installs || installs < 1) return "";
  if (installs < 1_000) return String(installs);
  if (installs < 1_000_000) return `${(installs / 1_000).toFixed(installs < 10_000 ? 1 : 0)}K`;
  return `${(installs / 1_000_000).toFixed(1)}M`;
}

// Big picker modal: search the skills.sh catalog and tick the skills the agent
// should install and follow. Selection lives in the parent page via useSkills.
export function SkillsModal({
  open,
  onOpenChange,
  selected,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: SkillRef[];
  onToggle: (skill: SkillRef) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillRef[] | null>(null);
  const [popular, setPopular] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!open) return;
    const gen = ++generation.current;
    // Debounce live searches; the popular list loads immediately on open.
    const delay = query.trim().length >= 2 ? 300 : 0;
    const timer = setTimeout(() => {
      setLoading(true);
      api<{ skills: SkillRef[]; popular: boolean }>(
        `/api/skills?q=${encodeURIComponent(query.trim())}`,
      )
        .then((body) => {
          if (gen !== generation.current) return;
          setResults(body.skills);
          setPopular(body.popular);
          setError(null);
        })
        .catch((err) => {
          if (gen !== generation.current) return;
          setError(err instanceof ApiError ? err.message : "Could not search skills.sh.");
        })
        .finally(() => {
          if (gen === generation.current) setLoading(false);
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [open, query]);

  const selectedIds = new Set(selected.map((skill) => skill.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(680px,85vh)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add skills</DialogTitle>
          <DialogDescription>
            Search skills.sh and tick the skills the agent should use. It installs each one with{" "}
            <code className="font-mono text-[12px]">npx skills add</code> and follows its
            instructions; skill files stay out of your repository.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            strokeWidth={1.8}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="Search skills.sh — e.g. react, prisma, tdd…"
            aria-label="Search skills"
            className="pl-9"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">{error}</p>
          ) : (
            <>
              <p className="px-1 pb-1.5 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                {popular ? "Popular skills" : `Results for “${query.trim()}”`}
                {loading && results ? " · searching…" : ""}
              </p>
              {loading && !results ? (
                <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                  Loading skills…
                </p>
              ) : null}
              {results && results.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                  No skills found for “{query.trim()}”.
                </p>
              ) : null}
              {(results ?? []).map((skill) => {
                const isSelected = selectedIds.has(skill.id);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => onToggle(skill)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "border-blue-700/40 bg-blue-700/5"
                        : "border-transparent hover:bg-muted/70"
                    }`}
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                        isSelected
                          ? "border-blue-700 bg-blue-700 text-white"
                          : "border-border bg-background"
                      }`}
                    >
                      {isSelected && <HugeiconsIcon icon={CheckIcon} size={12} strokeWidth={2.5} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{skill.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {skill.source}
                      </span>
                    </span>
                    {skill.installs ? (
                      <span
                        className="shrink-0 font-mono text-[11px] text-muted-foreground"
                        title={`${skill.installs.toLocaleString()} installs`}
                      >
                        {formatInstalls(skill.installs)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {selected.length}/{MAX_SKILLS} selected
          </p>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Selected skills shown above the prompt, mirroring the attachment chips.
export function SkillChips({
  skills,
  onRemove,
}: {
  skills: SkillRef[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
      {skills.map((skill) => (
        <span
          key={skill.id}
          title={skill.source}
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[11px]"
        >
          <HugeiconsIcon
            icon={SparklesIcon}
            size={12}
            strokeWidth={1.8}
            className="text-blue-700"
          />
          {skill.name}
          <button
            type="button"
            onClick={() => onRemove(skill.id)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${skill.name}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

// Plus icon in the composer: opens a small menu with the Skills option, which
// opens the picker modal.
export function SkillsButton({
  selected,
  onToggle,
  disabled = false,
}: {
  selected: SkillRef[];
  onToggle: (skill: SkillRef) => void;
  disabled?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Add skills"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="px-2 text-[12px]"
      >
        <HugeiconsIcon icon={PlusSignIcon} size={18} strokeWidth={1.8} />
      </Button>
      {menuOpen && (
        <div className="absolute bottom-9 left-0 z-40 w-48 rounded-xl border bg-popover p-1 shadow-md">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setModalOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
          >
            <HugeiconsIcon
              icon={SparklesIcon}
              size={16}
              strokeWidth={1.8}
              className="text-blue-700"
            />
            <span className="flex-1">Skills</span>
            {selected.length > 0 && (
              <span className="rounded-full bg-blue-700 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {selected.length}
              </span>
            )}
          </button>
        </div>
      )}
      <SkillsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        selected={selected}
        onToggle={onToggle}
      />
    </div>
  );
}
