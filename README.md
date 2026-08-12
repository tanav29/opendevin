# OpenDevin

OpenDevin is a local autonomous coding workspace. It uses an AI model (via OpenRouter) to plan and edit code inside isolated [E2B](https://e2b.dev) sandboxes, with a Next.js interface and an Express API.

## What it does

OpenDevin turns a coding request into a direct, observable conversation:

1. Start a workspace from a public Git repository (or a chat without a sandbox).
2. Chat with the agent as it inspects the repository and makes changes directly.
3. The agent works through minimal tools: read, edit, write, run commands, and web search.
4. Review the activity and changed files, and use the integrated terminal to inspect the workspace directly.

No plan approval gates or separate run pipeline. Sessions and chat history are persisted with Convex, and the agent is subject to workspace guardrails: sensitive files are blocked, command output is bounded and redacted, and destructive commands such as force pushes and recursive deletes are rejected.

This project is designed for local experimentation and human-in-the-loop development—not unattended production changes. The current repository flow accepts public GitHub, GitLab, and Bitbucket URLs, while GitHub authentication and publishing changes are not yet part of the local workflow.

## Architecture

- **Frontend:** Next.js and React provide chat, activity, diff review, and an xterm.js terminal.
- **Backend:** Express coordinates sessions, streams AI responses over Server-Sent Events, and exposes the terminal over WebSockets.
- **Agent:** An AI model supplied through the AI SDK (OpenRouter) talks directly to the sandbox.
- **Sandbox:** E2B provides an isolated checkout where commands, reads, edits, and searches run.
- **Persistence:** Convex stores sessions and chat messages with realtime subscriptions.

## Repository layout

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build/repo) monorepo:

- `apps/frontend` — Next.js web application (`:3000`)
- `apps/backend` — Express API, Convex persistence client, agent runtime, and terminal WebSocket server (`:3001`)

## Prerequisites

- Node.js 20 or newer
- pnpm 10 (`corepack enable`)
- An [E2B API key](https://e2b.dev/docs) for sandbox execution
- An [OpenRouter API key](https://openrouter.ai) for the model

## Configuration

Create `apps/backend/.env`:

```dotenv
CONVEX_URL="https://your-deployment.convex.cloud"
E2B_API_KEY="your-e2b-api-key"
OPENROUTER_API_KEY="your-openrouter-api-key"
MODEL="some/openrouter-model"
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

The application now stores sessions and chat messages in Convex. Configure `CONVEX_URL` for the backend and `NEXT_PUBLIC_CONVEX_URL` for the frontend (both should point to the same deployment), then run `pnpm convex:dev` once to connect the local project and generate `convex/_generated`.
