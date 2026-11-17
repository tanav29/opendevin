# OpenDevin

OpenDevin is a human-in-the-loop coding workspace. Sign in with GitHub, open a repository in an isolated E2B sandbox, chat with an AI coding agent, inspect the terminal and file changes, preview the running application, and push the result to a GitHub branch.

The project is intended for local development and experimentation. Agent actions are visible and reviewable; this is not an unattended production deployment system.

## What it does

- GitHub OAuth through Better Auth
- Public and private GitHub repositories, and public repositories from other Git hosts
- Projects, sessions, branch selection, and persisted chat history
- Streaming AI agent responses through OpenRouter
- E2B sandboxes with tools for reading, writing, searching, and running commands
- A shared WebSocket terminal connected to the session sandbox
- File tree, diff review, file editing, and per-file revert
- Configurable setup scripts, development commands, ports, and environment variables
- Preview URLs for services running inside a sandbox
- Commit and push changes to a GitHub branch

## Repository layout

This is a pnpm workspace managed with Turborepo:

```text
apps/frontend   Next.js 16 + React 19 application     http://localhost:3000
apps/backend    Express 5 API + Socket.IO server      http://localhost:3001
                Better Auth + Prisma + PostgreSQL
                OpenRouter AI SDK + E2B sandboxes
docs/           Design and implementation notes
```

The frontend calls the backend over HTTP and uses Socket.IO for the terminal. The backend owns authentication, persistence, project and session APIs, sandbox lifecycle, agent execution, terminal access, diffs, previews, and GitHub publishing.

Important backend modules:

- `apps/backend/src/index.ts` — starts the API and Socket.IO server
- `apps/backend/src/application.ts` — Express app, CORS, Better Auth, routes, and errors
- `apps/backend/src/routes/` — project, session, chat, workspace, GitHub, and health routes
- `apps/backend/src/auth/auth.ts` — Better Auth configuration
- `apps/backend/src/chat.ts` and `apps/backend/src/agent.ts` — agent turns, streaming, tools, and persistence
- `apps/backend/src/sandbox.ts` — E2B creation, repository cloning, commands, and port probing
- `apps/backend/src/pty.ts` — terminal PTY bridge
- `apps/backend/prisma/schema.prisma` — PostgreSQL data model

Important frontend directories:

- `apps/frontend/app/` — Next.js routes and session views
- `apps/frontend/components/` — application components
- `apps/frontend/components/ui/` — local shadcn-style primitives; keep these reusable files unchanged when possible
- `apps/frontend/lib/api.ts` — authenticated API client

## Requirements

- Node.js 22 or newer
- pnpm 11 (the root `package.json` pins pnpm 11.21.0; `corepack enable` is recommended)
- A GitHub OAuth app
- An OpenRouter API key
- An E2B API key

## Environment configuration

Create the backend environment file from the checked-in example:

```bash
cp apps/backend/.env.example apps/backend/.env
```

Set these values in `apps/backend/.env`:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
BETTER_AUTH_SECRET="replace-with-a-long-random-secret"
BETTER_AUTH_URL="http://localhost:3001"
PORT="3001"
FRONTEND_URL="http://localhost:3000"

GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"

MODEL="openai/gpt-4o-mini"
OPENROUTER_API_KEY="your-openrouter-api-key"
E2B_API_KEY="your-e2b-api-key"
```

`MODEL` may be a full OpenRouter model ID such as `anthropic/claude-sonnet-4`; a model without a provider prefix is automatically treated as an OpenAI model. The backend currently reads `OPENROUTER_API_KEY` and does not use a separate `OPENAI_API_KEY`.

The frontend API URL can be configured with `NEXT_PUBLIC_API_URL`; see `apps/frontend/.env.example`. Set `FRONTEND_URL` to the frontend origin for authentication and CORS. Optionally set `EXA_API_KEY` to enable agent web search.

Do not commit either environment file.

## GitHub OAuth setup

Create a GitHub OAuth App and set its authorization callback URL to:

```text
http://localhost:3001/api/auth/callback/github
```

OpenDevin requests `read:user`, `user:email`, and `repo` access. The repository scope is used to clone private repositories and push commits. If an existing GitHub token does not have the required access, sign out and sign in again after changing the OAuth app permissions.

## Installation and first run

From the repository root:

```bash
corepack enable
pnpm install
pnpm --filter @opendevin/backend db:push
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Check the backend at [http://localhost:3001/api/health](http://localhost:3001/api/health); it should return `{ "ok": true }`.

The database command creates or updates the PostgreSQL database specified by `DATABASE_URL`. Prisma Client is generated automatically by the backend build, or explicitly with:

```bash
pnpm --filter @opendevin/backend db:generate
```

## Common commands

```bash
pnpm dev                                      # Run frontend and backend
pnpm build                                    # Build every workspace
pnpm lint                                     # Lint every workspace
pnpm format                                   # Check formatting
pnpm format:fix                               # Format every workspace

pnpm --filter @opendevin/frontend dev        # Run only the frontend
pnpm --filter @opendevin/backend dev         # Run only the backend
pnpm --filter @opendevin/backend build       # Generate Prisma Client and compile API
pnpm --filter @opendevin/backend start       # Run the compiled backend
pnpm --filter @opendevin/backend db:push          # Apply the Prisma schema to PostgreSQL
pnpm --filter @opendevin/backend db:migrate  # Create/apply a development migration
pnpm --filter @opendevin/backend db:reset    # Reset the development database
pnpm --filter @opendevin/backend exec prisma studio
```

## Typical workflow

1. Sign in with GitHub.
2. Create a project from a repository URL, or use a blank project.
3. Configure an optional setup script, development command, port, and environment variables.
4. Start a session, choose a branch, and send the first prompt.
5. OpenDevin creates an E2B sandbox, clones the repository, runs the setup script, and starts the agent turn.
6. Review the agent response, files, terminal output, plan, and changes.
7. Start the development server from the Preview panel or terminal, then open the E2B preview URL.
8. Revert individual files or commit and push changes to GitHub.

If a project has a `dev` script, the Preview panel can infer a command from `package.json`. Otherwise configure a command explicitly. The service must listen on `0.0.0.0` inside the sandbox; OpenDevin sets this for its inferred commands.

## API and connection notes

All application routes are under `/api` and require the Better Auth session unless noted:

| Area | Routes |
| --- | --- |
| Health | `GET /api/health` |
| Auth | Better Auth routes under `/api/auth/*` |
| User and GitHub | `GET /api/me`, `GET /api/github/repos` |
| Projects | `/api/projects` and `/api/projects/:id` |
| Sessions | `/api/sessions`, `/api/sessions/:id`, and related session actions |
| Chat | `POST /api/sessions/:id/chat`, `POST /api/sessions/:id/stop` |
| Workspace | Diff, files, revert, preview, dev server, commit, and draft pull-request routes under `/api/sessions/:id/*` |
| Terminal | Socket.IO at `/api/socket.io` |

The chat endpoint streams responses. The terminal uses Socket.IO events for input, resize, output, replay, readiness, and errors.

## Data, sandboxes, and security

- PostgreSQL stores users, Better Auth accounts and sessions, projects, project sessions, and chat messages.
- Each API operation checks that the authenticated user owns the project or session being accessed.
- GitHub access tokens are kept server-side and used for private clones and GitHub pushes. Never log, commit, or expose them to the frontend.
- E2B sandboxes are temporary cloud workspaces with a one-hour timeout. Reconnect reattaches to a live sandbox or restores the latest durable checkpoint into a new one. Without a checkpoint, creating a fresh clone requires confirmation and keeps the saved review-only patch.
- Project environment variables are passed into setup and development commands inside the sandbox. Do not put secrets in repository files or prompts.
- Never commit `.env` files, API keys, OAuth secrets, or tokens.

### Workspace checkpoints

Use **Checkpoints** in the session header to capture a named checkpoint, inspect its source commit and branch, restore it, or **Fork from here** into a new session. Restore requires confirmation because it replaces the current workspace. The replacement becomes active only after restoration succeeds; failure retains the old sandbox, checkpoints, and recovery patch. Forks get their own durable checkpoint copy.

Checkpoints live in PostgreSQL, independently of E2B sandbox lifetime. Apply the additive migration with `pnpm --filter @opendevin/backend exec prisma migrate deploy` before deploying this feature. Python 3 and Git must be available in the sandbox. Automatic recovery checkpoints are captured after provisioning and whenever the workspace diff is snapshotted (including completed agent turns, commits, and sandbox shutdown). The latest 10 automatic checkpoints and up to 20 manual checkpoints are kept per session. Manual checkpoints can be deleted explicitly.

The current HEAD and its reachable history (including unpushed commits and shallow history), index, staged/unstaged changes, deletions, executable modes, and nonignored untracked regular files are preserved, including binary contents. Checkpoints cover only `/home/user/workspace`. They do not include other branches, ignored files, dependencies, running processes, Git configuration, hooks, remotes, credentials, or environment settings. Restore configures the project's clean HTTP(S) origin URL; reinstall dependencies and restart development processes afterward.

Capture is bounded to 20 MiB of encoded data, 20 MiB of Git objects, 50,000 Git objects, 2,000 changed/untracked files, and 5 MiB per changed file. Symlinks, submodules, linked worktrees, unresolved merges, SHA-256 repositories, and Git LFS object storage are unsupported. Capture refuses private files in Git history/index, common credential patterns, and configured project environment values in file/object contents. Private untracked paths such as `.env*`, `.npmrc`, SSH keys, and credential directories are excluded and listed in the inspector. This detection cannot identify every possible embedded secret: keep credentials out of source files and history. Stop terminal commands and other external writers before capture; detected concurrent edits fail capture instead of truncating it. Changes made after the selected checkpoint are not recovered on reconnect. Automatic capture failures are visible in the checkpoint dialog and never erase previous checkpoints.

## Development notes

- The current backend is Express, not Hono.
- The current persistence layer is Prisma with PostgreSQL, not Drizzle or Convex.
- Frontend application code belongs in `apps/frontend`; avoid editing reusable files in `apps/frontend/components/ui/`.
- Keep changes focused and run the relevant build, lint, or formatting command before opening a pull request.

## License

No license has been specified yet.
