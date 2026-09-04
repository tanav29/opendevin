# RULES.md — OpenDevin build rules

Source: grilled owner on 2026-09-04. This file is source of truth for AI builders.
When README / AGENTS.md / docs conflict with this file, follow this file.

## 1. What this is + IA

Repo agent workspace. Project maps 1:1 to a user GitHub repo (public or private).
- `/p/[id]` = project page: shows project + repo, list of sessions, loader/skeleton for active/remaining sessions while provisioning, plus new-session form (branch picker existing-or-new + first prompt). Submit -> `POST /api/projects/:id/sessions` -> redirect to `/s/[id]`.
- `/s/[id]` = session/chat page: chat conversation + right panel + left sidebar + top navbar + bottom follow-up box.
  - Chat: message list, backend persists messages to DB as they stream (user on send, assistant onFinish, status running->idle/failed).
  - Right panel 3 tabs: Terminal (sandbox shell), Changes (git diffs in sandbox), Preview (sandbox browser iframe).
  - Left sidebar: sessions grouped by project, spinner on active/working session (`status=running` or sandbox creating/cloning).
  - Top navbar in `/s/[id]`: createdAt, agent status (streaming/working vs idle vs failed), sandbox status (active/ready vs provisioning vs killed/error) + reconnect.
  - Bottom: textarea for follow-ups under messages.

Legacy routes `/projects/[id]` and `/sessions/[id]` exist now — migrate to `/p/[id]` and `/s/[id]` (or keep as redirect). Empty stubs `app/p/[projectId]/` and `app/s/[id]/` are the target.

## 2. Stack — enforced

- Frontend: Next.js 16 + React 19 (`apps/frontend`, :3000).
- Backend: Express 5 + Better Auth (`apps/backend/src/index.ts`, :3001).
- DB: Prisma 6 + SQLite (`apps/backend/prisma`, `DATABASE_URL="file:./dev.db"`).
- Agent: Vercel AI SDK `ai` + `@ai-sdk/openai`, streaming via `streamText`, `openai(OPENAI_MODEL || "gpt-4o-mini")`.
- Sandbox: E2B cloud only (`e2b:Sandbox`). No local exec fallback in v1.
- Monorepo: pnpm workspaces + turbo. Package manager is pnpm, never npm/yarn.

Explicitly rejected: Hono, Drizzle, Convex. Old `AGENTS.md` text mentioning them is stale — do not follow it. `docs/session-panel-state.md` mentions Convex, adapt its contract to Prisma (see §6).

## 3. Architecture / ports

- `GET /` -> `{name:"OpenDevin API", ok:true}`, `GET /api/health` -> `{ok:true}`.
- CORS: `FRONTEND_URL || http://localhost:3000`, `credentials:true`.
- Auth: `app.all("/api/auth/*splat", toNodeHandler(auth))`, Better Auth GitHub OAuth. Callback `http://localhost:3001/api/auth/callback/github`.
- Ownership check on every session route: `ownedSession()` = session user owns `project.userId`. 401 if no session, 404 if not owned.
- Frontend talks to backend via `NEXT_PUBLIC_API_URL` or same-origin proxy, always with credentials.

## 4. V1 features (must work)

1. Projects: `GET/POST /api/projects`, `GET /api/projects/:id`. Fields `name*, repo, userId`.
2. Branches: `GET /api/projects/:projectId/branches` via `git ls-remote --heads`, 15s timeout, max 200, defaultBranch = main > master > first. Return empty list on failure, never 500. Used by `/p/[id]` picker (select existing + input for new/exact name).
3. Sessions: `POST /api/projects/:projectId/sessions {message*, branch?}` creates `projectSession{title=message[0:60], status=running, sandboxId="", sandboxStatus=creating, workspacePath=/home/user/workspace}` + user message, then `void provisionSandbox(id)`. `GET` list + single + `/messages` + `/status`. `/p/[id]` lists them with loader for `running/creating/cloning`, click -> `/s/[id]`.
4. Provision: `provisionSandbox()` in `apps/backend/src/sandbox.ts`: creating -> create E2B (60min timeout) -> cloning/ready -> `cloneRepo(depth 1, branch?)` -> ready/idle, else error/failed + `lastError` (2k chars max). Requires `E2B_API_KEY`.
5. Chat + persist: `POST /api/sessions/:id/chat {message*}`: save user msg immediately, set running, load history, `Sandbox.connect(sandboxId)` -> `sandboxTools`, else `sandboxNote` fallback. System prompt mentions E2B path + repo + branch, prefers list/read before answering. Stream `text/plain` chunks, onFinish save assistant msg + idle, on stream error set failed. Frontend streams via reader and finalizes; backend is source of truth — refetch `/messages` after done.
6. Tools (only these 4 + git/terminal/preview to add, path traversal stripped via `replace(..)+..`): `list_files(path)`, `read_file(path, 20k cap)`, `run_command(cwd, 60s cap)`, `write_file(path, content)`. `AGENT_STOP = stepCountIs(8)`.
7. Status/reconnect: `GET /status` returns sandboxStatus/sandboxAvailable/sandboxId/workspacePath/lastError/status/repo/branch + createdAt for navbar. `POST /reconnect`: if `checkSandboxAvailable(pwd)` -> ready else creating+running + re-provision. Navbar + sidebar poll every 3s while creating/cloning/running.
8. `/s/[id]` right panel tabs (gap — must implement, keep panel open + tab + width in localStorage, reset URL/error on sandbox change):
   - Terminal: full PTY via xterm.js in UI + backend WS bridge to E2B `sandbox.pty`. Single shared PTY per session (survives tab close/reconnect, killed only on sandbox kill/reconnect). Backend: `pty.create({cols, rows, timeoutMs:0})`, `send_stdin(pid)`, stream `onData/onPty`, `kill`. Frontend: `xterm` + `xterm-addon-fit`, resize forwarding, reconnect replay. Auth via `ownedSession`, cwd = workspacePath. No PTY when sandbox not ready — show unavailable + reconnect.
   - Changes: active-sandbox-only. Backend runs `git -C workspace diff` (cap output, e.g. 100k) via `Sandbox.connect`, returns raw diff. Frontend renders with React diff/patch component (diffs.com-style pretty UI). Explicit no-changes state. Do not persist stale diff as truth; refetch on tab focus. Download `.patch`, publish GitHub branch + PR using reused OAuth token (PR only GitHub).
   - Preview: E2B public URL via SDK `sandbox.getHost(port)` -> `https://<host>` e.g. `https://3000-<id>.e2b.app` (never hand-concat, use getHost). Do NOT auto-start dev server — user/agent starts it via terminal/agent. Browser-like UI asks for port (default 3000) + path (default `/`), then shows iframe only after resolve succeeds. Retry re-resolves, reset URL on sandboxId change. See https://docs.e2b.dev/network/public-url.
9. Sidebar/navbar (gap): left sidebar sessions grouped by project + spinner for `running`; top navbar in `/s/[id]` shows createdAt + agent streaming state + sandbox active/killed; bottom textarea for follow-ups.

## 5. Auth / repos

- GitHub OAuth via Better Auth only.
- Private repos allowed in v1 by reusing OAuth token for `git clone` + PR publish. Never log token. If clone needs auth and token missing/insufficient, surface clear error, do not silently fall back to public.
- Accept `https://`, `http://`, `git@` in `isRepoUrl`. Sanitize branch: `^[\w.\-/]+$`, max 200, reject `..`, leading `/` or `-`.

## 6. Session / panel state (adapt panel spec to Prisma)

Prisma fields are source of truth: `status idle|running|failed`, `sandboxId`, `sandboxStatus creating|cloning|ready|error`, `workspacePath`, `branch`, `lastError`, `messages`, plus diff field to add.
- `sandboxId` alone != running. Available only after `checkSandboxAvailable` succeeds.
- On sandbox missing/expired: stop loading, keep panel open + tab + width, keep last diff readable, offer retry/reconnect, reset iframe URL.
- Client-only (localStorage): selected session id, panel open/collapsed + width + active tab (Preview/Changes). Reset request-scoped preview URL/error on session/sandbox change.
- `undefined` query = loading, not empty. Errors must name capability + recovery action.

## 7. How AI must build

- Minimal edits that just work. No duplication, no dead code, no second backend platform.
- Never edit `apps/frontend/components/ui/*` (shadcn).
- Never commit `.env`, keys, tokens, or `dev.db`. Use `apps/backend/.env` from `.env.example`.
- Shell-quote all repo/branch/paths (`shellQuote`), slice outputs (stdout 12k, stderr 4k, file 20k, clone error 2k).
- Use `pnpm --filter @opendevin/backend db:push`, `pnpm dev/build/lint`. Frontend has no fmt (`echo` stub), backend build = `prisma generate && tsc`.
- Keep replies short, verify by running code. Check `provisionSandbox`, `checkSandboxAvailable`, `ownedSession` before changing chat/sandbox routes.

## 8. Run locally

```bash
pnpm install
pnpm --filter @opendevin/backend db:push
pnpm dev  # :3000 frontend, :3001 backend
```

Env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `E2B_API_KEY`, `FRONTEND_URL`, `PORT`.

## 9. Non-goals / forbids (v1)

- Defer: multi-provider models, local sandbox fallback, team/orgs, second backend, extra agent tools beyond the 4.
- Forbid: unattended writes to prod, force-push, `rm -rf` outside workspace, sudo in sandbox, mirroring server session fields in client store, claiming sandbox running from id alone, clearing diff on sandbox expiry.
