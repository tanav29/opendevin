# OpenDevin

OpenDevin is a local autonomous coding workspace. It uses an Ollama model to plan and edit code inside isolated [E2B](https://e2b.dev) sandboxes, with a Next.js interface and an Express API.

## What it does

OpenDevin turns a coding request into a reviewable, observable task run:

1. Start a workspace from a public Git repository.
2. Let the agent inspect the repository and propose a plan.
3. Approve the plan before the agent can modify files.
4. Execute the work in an isolated sandbox using repository-aware tools.
5. Review the activity, changed files, diff, and validation results in the UI.
6. Use the integrated terminal to inspect the workspace directly.

Runs and their event history are persisted with Convex, so progress, plans, artifacts, and validation status remain available after refreshing the application. The agent is also subject to workspace guardrails: sensitive files are blocked, command output is bounded and redacted, and destructive commands such as force pushes and recursive deletes are rejected.

This project is designed for local experimentation and human-in-the-loop development—not unattended production changes. The current repository flow accepts public GitHub, GitLab, and Bitbucket URLs, while GitHub authentication and publishing changes are not yet part of the local workflow.

## Architecture

- **Frontend:** Next.js and React provide chat, run activity, plan approval, diff review, validation controls, and an xterm.js terminal.
- **Backend:** Express coordinates sessions and runs, streams run events over Server-Sent Events, and exposes the terminal over WebSockets.
- **Agent:** Ollama supplies the local language model through the AI SDK. Separate planning and execution phases make proposed changes explicit before mutation.
- **Sandbox:** E2B provides an isolated checkout where commands, reads, edits, and validation run.
- **Persistence:** Convex stores sessions, messages, agent runs, events, and review artifacts with realtime subscriptions.

## Repository layout

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build/repo) monorepo:

- `apps/frontend` — Next.js web application (`:3000`)
- `apps/backend` — Express API, Convex persistence client, agent runtime, and terminal WebSocket server (`:3001`)

## Prerequisites

- Node.js 20 or newer
- pnpm 10 (`corepack enable`)
- [Ollama](https://ollama.com) running locally
- An [E2B API key](https://e2b.dev/docs) for sandbox execution

Pull the default model before starting the app:

```bash
ollama pull qwen3.5:4b
```

## Configuration

Create `apps/backend/.env`:

```dotenv
CONVEX_URL="https://your-deployment.convex.cloud"
E2B_API_KEY="your-e2b-api-key"
OLLAMA_MODEL="qwen3.5:4b"
PORT=3001
FRONTEND_URL="http://localhost:3000"
```

The frontend defaults to `http://localhost:3001`. To use another API URL, set `NEXT_PUBLIC_API_URL` in `apps/frontend/.env.local`.

## Run locally

```bash
pnpm install
pnpm convex:dev
pnpm convex:dev
pnpm dev
```

Open `http://localhost:3000`. Turborepo starts both the frontend and backend. The API health check is available at `http://localhost:3001/health`.

## Common commands

```bash
pnpm dev          # Start frontend and backend in watch mode
pnpm build        # Build/check all workspaces
pnpm lint         # Lint all workspaces
pnpm format       # Check formatting
pnpm format:fix   # Format files
pnpm convex:dev  # Run Convex locally and generate bindings
pnpm convex:codegen # Regenerate Convex bindings
```

Do not commit `.env` files or API keys. Backend-specific commands can be run with `pnpm --filter @opendevin/backend <command>`.
## Convex persistence

The application now stores sessions, chat messages, agent runs, activity events, and review artifacts in Convex. Configure `CONVEX_URL` for the backend and `NEXT_PUBLIC_CONVEX_URL` for the frontend (both should point to the same deployment), then run `pnpm convex:dev` once to connect the local project and generate `convex/_generated`.
