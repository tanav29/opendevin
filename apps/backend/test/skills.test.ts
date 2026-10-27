import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillsNote, buildSystemPrompt, parseSkillsBlock } from "../src/agent.js";

test("parses a <skills> block into source/slug pairs", () => {
  const message =
    "Build a landing page\n\n<skills>\nanthropics/skills@frontend-design\nprisma/skills@prisma-client-api\n</skills>";
  assert.deepEqual(parseSkillsBlock(message), [
    { source: "anthropics/skills", slug: "frontend-design" },
    { source: "prisma/skills", slug: "prisma-client-api" },
  ]);
});

test("returns no skills when the message has no <skills> block", () => {
  assert.deepEqual(parseSkillsBlock("Fix the login bug"), []);
  assert.deepEqual(parseSkillsBlock("<skills></skills>"), []);
  assert.deepEqual(parseSkillsBlock("<skills>not-a-pair</skills>"), []);
});

test("drops invalid or duplicate entries and caps the selection", () => {
  const entries = Array.from({ length: 14 }, (_, i) => `owner/repo@skill-${i}`).join("\n");
  const parsed = parseSkillsBlock(`<skills>\ndup@skill\n${entries}\n</skills>`);
  // "dup@skill" has no owner/repo source, so only the valid entries are kept.
  assert.equal(parsed.length, 10);
  assert.deepEqual(parsed[0], { source: "owner/repo", slug: "skill-0" });
  assert.deepEqual(parsed.at(-1), { source: "owner/repo", slug: "skill-9" });
  const duplicated = parseSkillsBlock("<skills>\nowner/repo@skill\nowner/repo@skill\n</skills>");
  assert.deepEqual(duplicated, [{ source: "owner/repo", slug: "skill" }]);
});

test("buildSkillsNote embeds the exact install commands", () => {
  const note = buildSkillsNote([{ source: "anthropics/skills", slug: "frontend-design" }]);
  assert.match(
    note,
    /DISABLE_TELEMETRY=1 npx skills add anthropics\/skills --skill frontend-design -a universal -y --copy/,
  );
  assert.match(note, /\.agents\/skills\/\{slug\}\/SKILL\.md/);
  assert.match(note, /gitignored/);
  assert.equal(buildSkillsNote([]), "");
});

test("buildSystemPrompt appends the skills note only when skills are selected", () => {
  const plain = buildSystemPrompt("/ws", null, "", "", "");
  assert.doesNotMatch(plain, /skills protocol/i);
  const withSkills = buildSystemPrompt("/ws", null, "", "", "", [
    { source: "prisma/skills", slug: "prisma-cli" },
  ]);
  assert.match(withSkills, /npx skills add prisma\/skills --skill prisma-cli/);
});
