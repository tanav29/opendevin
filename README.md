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
apps/backend    Express 5 API + WebSocket server      http://localhost:3001
                Better Auth + Prisma + SQLite
                OpenRouter AI SDK + E2B sandboxes
docs/           Design and implementation notes
```

The frontend calls the backend over HTTP and uses a WebSocket for the terminal. The backend owns authentication, persistence, project and session APIs, sandbox lifecycle, agent execution, terminal access, diffs, previews, and GitHub publishing.

Important backend modules:

- `apps/backend/src/index.ts` — starts the API and WebSocket server
- `apps/backend/src/app.ts` — Express app, CORS, Better Auth, routes, and errors
- `apps/backend/src/routes/` — project, session, chat, workspace, GitHub, and health routes
- `apps/backend/src/auth/auth.ts` — Better Auth configuration
- `apps/backend/src/chat.ts` and `apps/backend/src/agent.ts` — agent turns, streaming, tools, and persistence
- `apps/backend/src/sandbox.ts` — E2B creation, repository cloning, commands, and port probing
- `apps/backend/src/pty.ts` — terminal PTY bridge
- `apps/backend/prisma/schema.prisma` — SQLite data model

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
DATABASE_URL="file:./dev.db"
BETTER_AUTH_SECRET="replace-with-a-long-random-secret"
BETTER_AUTH_URL="http://localhost:3001"
FRONTEND_URL="http://localhost:3000"
PORT="3001"

GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"

MODEL="openai/gpt-4o-mini"
OPENROUTER_API_KEY="your-openrouter-api-key"
E2B_API_KEY="your-e2b-api-key"
```

`MODEL` may be a full OpenRouter model ID such as `anthropic/claude-sonnet-4`; a model without a provider prefix is automatically treated as an OpenAI model. The backend currently reads `OPENROUTER_API_KEY` and does not use a separate `OPENAI_API_KEY`.

The frontend defaults to `http://localhost:3001`. To use another backend URL, create `apps/frontend/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

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
pnpm --filter @opendevin/backend exec prisma db push
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Check the backend at [http://localhost:3001/api/health](http://localhost:3001/api/health); it should return `{ "ok": true }`.

The database command creates or updates the local SQLite database at `apps/backend/prisma/dev.db` when `DATABASE_URL` is `file:./dev.db`. Prisma Client is generated automatically by the backend build, or explicitly with:

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
pnpm --filter @opendevin/backend exec prisma db push # Apply the Prisma schema to SQLite
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
| Workspace | Diff, files, revert, preview, dev server, and commit routes under `/api/sessions/:id/*` |
| Terminal | WebSocket `/api/sessions/:id/pty` |

The chat endpoint streams plain text. The terminal WebSocket accepts JSON `input` and `resize` messages and returns terminal data, replay, readiness, and error messages.

## Data, sandboxes, and security

- SQLite stores users, Better Auth accounts and sessions, projects, project sessions, and chat messages.
- Each API operation checks that the authenticated user owns the project or session being accessed.
- GitHub access tokens are kept server-side and used for private clones and GitHub pushes. Never log, commit, or expose them to the frontend.
- E2B sandboxes are temporary cloud workspaces with a one-hour timeout. They can expire or become unavailable; use Reconnect sandbox to provision a replacement.
- Project environment variables are passed into setup and development commands inside the sandbox. Do not put secrets in repository files or prompts.
- Never commit `.env` files, API keys, OAuth secrets, tokens, or the local SQLite database.

## Development notes

- The current backend is Express, not Hono.
- The current persistence layer is Prisma with SQLite, not Drizzle or Convex.
- Frontend application code belongs in `apps/frontend`; avoid editing reusable files in `apps/frontend/components/ui/`.
- Keep changes focused and run the relevant build, lint, or formatting command before opening a pull request.

## License

No license has been specified yet.
