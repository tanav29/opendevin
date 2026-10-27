"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

export type SkillRef = {
  id: string; // "{source}/{slug}", the stable skills.sh identifier
  name: string;
  source: string; // GitHub "owner/repo" or well-known source
  slug: string; // skill identifier within the source
  installs?: number;
};

export const MAX_SKILLS = 8;

// Selected skills are appended to the message as a <skills> block; the backend
// parses it and hands the agent exact `npx skills add` commands in its system
// prompt (see buildSkillsNote in apps/backend/src/agent.ts).
export function serializeSkills(skills: SkillRef[]) {
  if (skills.length === 0) return "";
  return `<skills>\n${skills
    .map((skill) => `${skill.source}@${skill.slug}`)
    .join("\n")}\n</skills>`;
}

export function useSkills() {
  const [skills, setSkills] = useState<SkillRef[]>([]);
  const skillsRef = useRef<SkillRef[]>([]);

  function commit(next: SkillRef[]) {
    skillsRef.current = next;
    setSkills(next);
  }

  function toggle(skill: SkillRef) {
    const current = skillsRef.current;
    if (current.some((selected) => selected.id === skill.id)) {
      commit(current.filter((selected) => selected.id !== skill.id));
      return;
    }
    if (current.length >= MAX_SKILLS) {
      toast.error(`Only ${MAX_SKILLS} skills can be selected.`);
      return;
    }
    commit([...current, skill]);
  }

  function remove(id: string) {
    commit(skillsRef.current.filter((selected) => selected.id !== id));
  }

  function resetSkills() {
    commit([]);
  }

  return { skills, toggle, remove, resetSkills };
}
