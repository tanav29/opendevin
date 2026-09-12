# OpenDevin

OpenDevin is a human-in-the-loop coding workspace. Sign in with GitHub, open a repository in an isolated E2B sandbox, chat with an AI coding agent, inspect the terminal and file changes, preview the running app, and publish GitHub changes as a branch and pull request.

The project is intended for local development and experimentation. Agent actions are observable and reviewable; this is not an unattended production deployment system.

## Features

- GitHub OAuth with Better Auth
- Public and private GitHub repositories, plus public GitLab and Bitbucket repositories
- Project and session management
- Branch selection when starting a session
- Streaming AI chat with persisted messages
- Sandboxed repository workspaces powered by E2B
- Agent tools for listing files, reading files, writing files, and running commands
- Shared terminal connected to the session sandbox
- Git diff review and `.patch` download
- GitHub branch and pull-request publishing
- Preview of a sandbox service through an E2B public URL

## Architecture

OpenDevin is a pnpm and Turborepo monorepo:

```text
apps/frontend  Next.js 16 + React 19 web application       :3000
apps/backend   Express 5 API + Better Auth + AI SDK         :3001
                 Prisma 6 + SQLite persistence
                 E2B cloud sandboxes
```

The frontend communicates with the backend over HTTP and WebSockets. The backend owns authentication, projects, sessions, chat persistence, sandbox lifecycle, terminal access, diffs, and GitHub publishing.

### Important directories

- `apps/frontend/app` — Next.js routes and session UI
- `apps/frontend/components` — application components and local UI components
- `apps/backend/src/index.ts` — API routes, chat streaming, and WebSocket handling
- `apps/backend/src/auth` — Better Auth configuration
- `apps/backend/src/sandbox.ts` — E2B provisioning and sandbox tools
- `apps/backend/src/pty.ts` — terminal PTY bridge
- `apps/backend/prisma/schema.prisma` — SQLite data model
- `docs` — implementation notes and state contracts

## Requirements

- Node.js 22+
- pnpm 11 (`corepack enable` is recommended)
- A GitHub OAuth app
- An OpenAI or OpenRouter API key
- An E2B API key

## GitHub OAuth setup

Create or use a GitHub OAuth app and configure this callback URL for local development:

```text
http://localhost:3001/api/auth/callback/github
```

The OAuth scope includes repository access so OpenDevin can work with private repositories and publish pull requests using the signed-in user’s GitHub token.

## Local setup

Install dependencies and create the local SQLite schema:

```bash
pnpm install
pnpm --filter @opendevin/backend db:push
```

Create the environment files:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

At minimum, configure the backend values below:

```dotenv
DATABASE_URL="file:./dev.db"
BETTER_AUTH_SECRET="replace-with-a-long-random-secret"
BETTER_AUTH_URL="http://localhost:3001"
FRONTEND_URL="http://localhost:3000"
PORT="3001"

GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"

OPENAI_API_KEY="your-openai-api-key"
OPENAI_MODEL="gpt-4o-mini"
E2B_API_KEY="your-e2b-api-key"
```

OpenRouter can be used instead of OpenAI:

```dotenv
OPENROUTER_API_KEY="your-openrouter-api-key"
OPENAI_BASE_URL="https://openrouter.ai/api/v1"
MODEL="your-model-id"
```

The frontend defaults to the local API, but this can be set explicitly in `apps/frontend/.env`:

```dotenv
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

Start both applications from the repository root:

```bash
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000). The backend health check is available at [http://localhost:3001/api/health](http://localhost:3001/api/health).

## Common commands

```bash
pnpm dev                                      # Run frontend and backend
pnpm build                                    # Build all workspaces
pnpm lint                                     # Lint all workspaces
pnpm format                                   # Check formatting
pnpm format:fix                               # Format all workspaces
pnpm --filter @opendevin/backend db:push     # Apply Prisma schema to SQLite
pnpm --filter @opendevin/backend db:studio   # Open Prisma Studio
pnpm --filter @opendevin/backend build       # Generate Prisma client and compile API
pnpm --filter @opendevin/backend start       # Run the compiled backend
```

## Typical workflow

1. Sign in with GitHub.
2. Create a project from a repository URL or start a blank workspace.
3. Choose an existing branch or enter a new branch name.
4. Send the initial prompt. The backend creates an E2B sandbox and clones the repository.
5. Chat with the agent and use the Terminal, Changes, and Preview panels to inspect its work.
6. Download a patch or publish the changes to GitHub as a branch and pull request.

The agent does not automatically start a development server in the sandbox. Use the terminal or ask the agent to start one before opening Preview.

## Data and security

- Local application data is stored in `apps/backend/prisma/dev.db` through Prisma and SQLite.
- Session routes verify that the signed-in user owns the project.
- GitHub access tokens are used server-side for private repository cloning and pull-request publishing; they must not be logged or committed.
- E2B sandboxes are temporary cloud workspaces and may expire. The UI exposes reconnect and error states when a sandbox is unavailable.
- Never commit `.env` files, API keys, OAuth secrets, tokens, or the local SQLite database.

## Development notes

- The supported backend is Express; Hono is not used by the current implementation.
- Prisma/SQLite is the current persistence layer; Convex and Drizzle are not used by the current implementation.
- Reusable shadcn UI files under `apps/frontend/components/ui` should remain unchanged when modifying application features.
- Keep changes small, run the relevant build or lint command, and verify behavior through the local UI and `/api/health` endpoint.

## License

No license has been specified yet.
