# OpenDevin Product Plan

Updated: 2026-09-25

## North star

**Weekly verified pull requests merged per active team.**

Supporting metrics:

- Environment setup success rate
- Time to first meaningful agent activity
- Sandbox failure and recovery rate
- Human intervention time per task
- CI pass rate and revert rate
- Cost per merged pull request

## Product thesis

OpenDevin currently demonstrates a transparent, developer-supervised agent workspace. The next milestone is not more chat UI. It is a durable, observable workflow that ends in a verified pull request.

Transition the product from **human-in-the-loop** to **human-on-the-loop**: the agent works independently, surfaces decisions and evidence, and asks for intervention only when needed.

## Current baseline

Already implemented:

- GitHub authentication, repository selection, branches, and issue attachment
- E2B sandboxes with setup scripts, dev commands, ports, and environment variables
- Streaming agent turns with sandbox tools, plans, and clarification questions
- Shared terminal, file browsing/editing, diffs, per-file revert, and preview
- Session archive/reconnect/kill/delete and commit-and-push handoff
- A strong, distinctive public landing page and desktop workspace

Primary gaps:

- The first five P0 blockers below
- Durable background execution and event history
- Pull-request and CI handoff
- Verification artifacts
- Reusable environment builds
- Asynchronous triggers and notifications

## Execution rules

- Work through P0 items strictly in order.
- Keep each change minimal, focused, and independently shippable.
- Prefer edits to application code over new infrastructure.
- Do not edit `apps/frontend/components/ui/` unless explicitly necessary; prefer composing existing primitives.
- Do not migrate frameworks, databases, or authentication systems as part of P0 work.
- Do not add multi-agent orchestration, broad integrations, or organization features yet.
- Do not commit, push, deploy, or run destructive Git commands unless explicitly requested.
- After each P0 item, run `pnpm build`, `pnpm lint`, and `pnpm format`; browser-check affected flows when practical.
- Update the checkboxes and notes in this document as work completes.

---

# P0 — Release blockers

## P0-1. Complete the task-start flow

**Status:** Complete

### Problem

Session creation returns an ID, but the task form discards it. A successful task start leaves the user on the same page, allows duplicate submissions, and hides the activity that was just launched.

### Implementation

- Capture the returned session ID and navigate to `/s/[id]` immediately.
- Keep the start action locked until navigation or an explicit failure.
- Show the selected repository and source branch before submission.
- Invalidate or update the `projects`, `sessions`, and `project-sessions` queries after creation.
- Fix the repository select to use one consistent identifier for its value and emitted item.
- Remove or implement the inert paperclip control.

Primary files:

- `apps/frontend/components/task-form.tsx`
- `apps/frontend/components/layout/app-sidebar.tsx`
- Relevant task/session query invalidation

### Done when

- One submission navigates directly to the created session.
- A second submission cannot be triggered accidentally.
- Repository and branch are unambiguous before the sandbox starts.
- No existing valid repository-selection behavior regresses.

### Notes

- 2026-09-25: `TaskForm` now captures the created session ID, locks the submit action after success, navigates to `/s/[id]`, invalidates project/session queries, shows repository and source branch context, uses the repository ID consistently, and removes the inert paperclip control. A same-tick submission guard and a separate navigation/invalidation path prevent a successful create from being reopened.
- Product decision: submission now requires an explicit source branch selection or newly entered source branch; P0-5 generates and displays a separate publish destination before any push.
- Verification: `pnpm build` passed. `pnpm lint` completed with 9 pre-existing frontend warnings and no warning in the touched form. `pnpm format` still reports 13 pre-existing files; the touched form is formatted. Browser inspection on `/` confirmed the repository/branch labels and no paperclip control; authenticated end-to-end creation was unavailable because the local API returned 401 for the browser session.

## P0-2. Make authentication and API failures explicit

**Status:** Complete

### Problem

The public page renders the authenticated dashboard before auth is known and treats every request failure as “signed out.” Network, timeout, CORS, and 5xx failures therefore look like a normal logged-out visit.

### Implementation

- Add a typed API error carrying HTTP status, optional code, and server message.
- Model auth as `checking | signed-out | signed-in | unavailable`.
- Treat only 401/403 as signed out.
- Show a stable branded checking state instead of a dashboard flash on `/`.
- Add recoverable unavailable/offline states for network, timeout, and 5xx failures.
- Add route-level error and not-found experiences where needed.
- Never render “empty” or “not found” from a failed request.

Primary files:

- `apps/frontend/lib/api.ts`
- `apps/frontend/app/page.tsx`
- `apps/frontend/hooks/use-session.ts`
- `apps/frontend/app/error.tsx` and/or route-level error boundaries

### Done when

- Signed-out visitors see a stable public experience without a dashboard flash.
- Backend outages are not misrepresented as signed out.
- Failed session/project loads show retryable errors rather than empty or not-found states.

### Notes

- 2026-09-25: Added `ApiError` status/code/server-message handling with a configurable request timeout (30-second default; long-running workspace operations override it); `useSession` now exposes `checking`, `signed-out`, `signed-in`, and `unavailable`; home, sidebar, settings, project, and session loads now distinguish auth, not-found, and recoverable failures. Added `app/error.tsx` and a shared retryable error state.
- Product decision: only 401/403 transitions to signed-out; all other verification failures remain unavailable with an explicit retry path.
- Verification: `pnpm build` passed. `pnpm lint` completed with 3 pre-existing frontend warnings outside touched P0-2 files. `pnpm format` still reports 9 pre-existing files; all touched P0-2 files are formatted. Browser checks with mocked `/api/me` responses verified the 503 unavailable screen, the 401 public landing state, and no dashboard form flash.

## P0-3. Introduce a truthful lifecycle state machine

**Status:** Complete

### Problem

Agent and sandbox state are loosely coupled strings. A failed setup script is stored as a ready sandbox with a hidden error, and the initial run has weak live supervision.

### Implementation

- Define shared lifecycle phases and legal transitions in the backend.
- Separate provisioning, agent, and verification state sufficiently to avoid contradictory UI.
- Mark setup command failures as provisioning failures, not ready with hidden `lastError`.
- Persist an actionable failure when the initial model run cannot start.
- Return the session's stored model instead of the current global model.
- Surface sandbox and agent state in the session header.
- Let the user stop a running initial/headless turn, not only a locally initiated stream.
- Disable or explain submission when another client owns the active turn.

Primary files:

- `apps/backend/src/sandbox.ts`
- `apps/backend/src/chat.ts`
- `apps/backend/src/routes/sessions.ts`
- `apps/frontend/app/s/[id]/page.tsx`

Note: durable worker queues and normalized run events are a later P1 feature. P0-3 only requires truthful, actionable state.

### Done when

- No session silently becomes idle without an assistant result or actionable error.
- Setup, sandbox, and agent failures are visible in the primary session UI.
- A user can stop an active headless run.
- Polling and button state no longer rely on a single ambiguous status string.

### Notes

- 2026-09-25: Added backend lifecycle phases and transition policy; sessions now use `queued` while provisioning, `setting-up` for setup, and normalized provisioning/agent/verification fields in status responses. Setup failures, missing model configuration, empty assistant results, provider failures, and interrupted runs persist actionable state. Stored session models are returned, active turns are claimed before asynchronous work, and `/stop` cancels headless turns.
- Product decision: unavailable/active states are represented explicitly rather than inferred from `sandboxId` or one ambiguous status string; durable run events remain deferred to P1.
- Verification: `pnpm build` passed; backend/frontend lint completed with 3 pre-existing frontend warnings outside touched lifecycle files; `pnpm format` still reports 8 pre-existing files and all touched files are formatted. Browser inspection verified the stored model/status response, visible Sandbox/Agent/Result header state, unavailable sandbox labeling, and a mocked headless run showing Stop plus an explanation instead of an enabled composer.

## P0-4. Make sandbox reconnect safe

**Status:** Complete

### Problem

Reconnect can create a clean sandbox and silently discard uncommitted work while presenting the action as a continuation.

### Implementation

- Detect whether the unavailable session has a non-empty persisted diff or other unsaved work.
- Never silently replace a dirty workspace.
- Return an explicit conflict/recovery response describing the recoverable patch.
- Require explicit user confirmation before starting a clean replacement.
- Clearly distinguish review-only `lastDiff` from a restorable workspace.
- Preserve and display the patch download/recovery path.
- Add tests or deterministic coverage for clean and dirty reconnect behavior.

Primary files:

- `apps/backend/src/routes/sessions.ts`
- `apps/backend/src/sandbox.ts`
- `apps/backend/src/workspace.ts`
- `apps/frontend/app/s/[id]/page.tsx`
- Session information/reconnect UI

### Done when

- Reconnect either restores the working state or asks before discarding it.
- The UI never claims continuity when only a fresh clone exists.
- A recoverable patch remains available throughout recovery.

### Notes

- 2026-09-25: Added a deterministic reconnect policy with clean, dirty, confirmed-replacement, active-turn, and reattach branches. Dirty sessions return a structured `409` conflict with review-only patch metadata and do not mutate the sandbox; only an explicit `confirmReplace: true` starts a fresh clone. The UI explains continuity loss and links to Changes/download before confirmation.
- Product decision: an empty persisted diff is treated as the available clean-state signal for this P0; the saved patch is explicitly review/download-only and is not represented as a restorable workspace. Durable workspace snapshots remain P1.
- Verification: `pnpm --filter @opendevin/backend test` passed 15 focused lifecycle/reconnect tests. `pnpm build` passed; `pnpm lint` completed with zero warnings/errors; `pnpm format` still reports 7 pre-existing files and all touched files are formatted. Browser inspection verified the dirty conflict dialog and that confirmation sends `{ "confirmReplace": true }` before replacement.

## P0-5. Protect files and Git operations

**Status:** Complete

### Implementation

- Honor the backend's truncated-file response and make oversized files read-only.
- Prevent saving partial file content.
- Prevent path/content mismatches when changing files.
- Warn before navigating away with unsaved edits.
- Show saved/dirty state.
- Require or explicitly generate a session branch; never silently publish to the current/default branch.
- Show repository, source branch, destination branch, and changed-file count before pushing.
- Warn when `git add -A` includes untracked files.
- Add file-specific confirmation before revert.
- Make archive behavior explicit and recoverable, or stop the sandbox when archiving.
- Fix attachment size/count limits so accepted content cannot exceed backend limits.

Primary files:

- `apps/frontend/app/s/[id]/files-tab.tsx`
- `apps/frontend/app/s/[id]/changes-tab.tsx`
- `apps/frontend/app/s/[id]/page.tsx`
- `apps/frontend/components/session-summary.tsx`
- `apps/backend/src/routes/workspace.ts`
- `apps/backend/src/routes/sessions.ts`

### Done when

- Opening and saving a truncated file cannot destroy omitted content.
- Every publish action names its exact remote target.
- Revert and archive have clear consequences and recovery paths.
- Attachment limits match the backend contract.

### Notes

- 2026-09-25: File reads now honor `truncated`, render oversized content read-only, save against an immutable loaded path plus expected original content, show Saved/Unsaved state, and warn on unload or same-origin navigation. Revert and archive now require explicit confirmation; archive stops the sandbox. Commit preflight names repository/source/generated destination/changed files, requires confirmation before staging untracked files, and always pushes to a generated session branch rather than the current/default branch. Attachment count and serialized message size now match the 20,000-character backend contract.
- Product decision: the selected task branch is the source branch; publish destination is deterministically generated as `opendevin/session-<id>` and persisted after a successful push. No database/framework migration was added.
- Verification: `pnpm --filter @opendevin/backend test` passed 15 focused tests. `pnpm build` passed; `pnpm lint` completed with zero warnings/errors; `pnpm format` still reports 7 pre-existing files and all touched files are formatted. Browser checks verified truncated read-only behavior, exact publish metadata and untracked confirmation gating, and archive consequences.

### P0 review follow-up

- 2026-09-25: An independent backend/frontend review found lifecycle, reconnect, timeout, and stale-data edge cases. The follow-up fixes make every unavailable/errored sandbox replacement require explicit confirmation, keep fresh-clone continuity warnings and recovery patches authoritative, snapshot before kill/archive/revert, block manual saves and commits during active turns, prevent clean checkouts from being pushed as new work, re-check the reviewed tree immediately before `git add -A`, preserve cached auth/workspace data through background-refetch failures, split agent failures from workspace failures, and give slow sandbox operations request-specific timeouts.
- Verification after the follow-up: `pnpm build` passes; `pnpm --filter @opendevin/backend test` passes 15 tests; frontend and backend lint report zero warnings; all touched files are formatted. Seven pre-existing frontend files still fail the repository-wide format check, including two `components/ui/` files that this plan does not modify.

---

# P1 — Competitive product loop

## Durable agent runs

- Persisted `AgentRun` and ordered `RunEvent` records
- Durable provisioning/execution worker boundary
- Startup reconciliation for stale runs
- Event streaming instead of most polling
- Idempotency for session creation and side effects

## Pull-request and CI loop

- Draft PR creation after push
- Base/head branch, PR URL, number, and state persisted
- Check-run and review-comment synchronization
- Agent follow-ups that fix CI or address review feedback
- PR templates and branch-protection awareness

## Verification and artifacts

- Browser automation inside the sandbox
- Screenshots, video, console errors, and failed network requests
- Session and PR evidence
- A final summary of files, commands, tests, and remaining risk

## Reusable environments

- Versioned environment templates
- Background dependency builds and last-known-good fallback
- Multiple long-running services
- Monorepo and later multi-repository support
- Separate setup, build, agent, and test logs

## Asynchronous loop

- GitHub issue/PR comment triggers
- GitHub Actions failure follow-up
- Email, Slack, and webhook completion notifications
- Expiring read-only session links

## Session inbox and collaboration

- Search, grouping, filters, pin, rename, restore, and full navigation
- Organization membership and repository scopes
- Audit events and usage budgets

## Model, cost, and knowledge controls

- Per-run model and mode
- Token, step, wall-time, and monetary budgets
- Usage ledger
- `AGENTS.md`, project knowledge, and reusable playbooks
- MCP servers and documentation/web tools

---

# Cross-cutting polish

## Application structure

- Split public and authenticated route groups
- Keep the app shell off landing and login routes
- Eliminate nested main landmarks
- Pause polling on hidden or inactive routes
- Reduce initial bundle weight and long-session rendering cost

## Session UX

- Persistent lifecycle and current-action header
- Expandable tool timeline with full arguments, output, duration, and failures
- Plan checklist with real progress
- Conditional streaming auto-scroll and “jump to latest”
- Only the latest unanswered clarification remains interactive
- Composer drafts and unsaved-navigation protection
- Terminal connecting, connected, reconnecting, and closed states

## Workspace and navigation

- Mobile sheet for Files, Terminal, Changes, and Preview
- Semantic tabs and keyboard-accessible resizing
- Full project/session browser instead of silent truncation
- Compact, polished collapsed sidebar

## Trust and safety

- Explain GitHub permissions, model-provider transmission, autonomous tools, preview URL exposure, sandbox lifetime, and secret handling
- Move toward a GitHub App with selected repositories and least-privilege permissions
- Encrypt tokens and separate masked secrets from ordinary environment configuration

## Accessibility

- Explicit form labels
- Accessible icon-button names
- Live status regions
- `aria-current` and semantic tabs
- Application-wide reduced motion
- Contrast and touch-target improvements

---

# 90-day sequence

## Days 1–14: Reliable alpha

- P0-1 through P0-5
- Security dependency updates
- Focused test coverage
- CI for build, lint, format, and tests

## Days 15–45: Private beta

- Durable agent runs and event timeline
- PR creation and CI feedback loop
- Safe environment snapshots
- Notifications and shareable sessions
- Session inbox

## Days 46–90: Competitive beta

- Browser verification and artifacts
- GitHub issue/PR triggers
- Model and budget controls
- `AGENTS.md` and playbooks
- MCP and multi-repository environments
- Organizations and collaboration

# Deferred until the foundation is proven

- Multi-agent swarms
- Custom IDE
- Broad integration marketplace
- Additional chat redesign
- Organization administration before provider permissions and audit logs
- Multi-repository and parallel orchestration before durable single-agent runs

# Release quality gate

The current repository now has focused lifecycle/reconnect tests but no CI, passes lint with zero warnings, fails formatting on 7 pre-existing files, and has critical dependency advisories. Establish the following before a public beta:

- `pnpm build` passes
- `pnpm lint` has zero warnings
- `pnpm format` passes
- Focused unit/integration tests cover security and state transitions
- End-to-end coverage covers create task → session → diff → safe publish
- Dependency audit is triaged with critical/high findings resolved or explicitly accepted
- Migrations and lockfile are tracked
- A product license and naming decision are recorded
