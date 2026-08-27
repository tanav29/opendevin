# OpenDevin

# GH APP LINK - https://github.com/settings/apps/tp-opendevin

OpenDevin is a local autonomous coding workspace. It uses an AI model (via OpenRouter) to plan and edit code inside an isolated sandbox, with a Next.js interface.

## What it does

OpenDevin turns a coding request into a direct, observable conversation:

1. Start a workspace from a public Git repository.
2. Chat with the agent as it inspects the repository and makes changes directly.
3. The agent works through minimal tools: read, edit, write, run commands, and web search.
4. Review the changed files side by side.
5. Download the patch, or connect GitHub to publish it as a branch and pull request.

No plan approval gates or separate run pipeline. Sessions and chat history are persisted with Convex, and the session is driven by a small AI SDK agent using OpenRouter. The agent owns the tool loop and per-session workspace; Convex stores the session metadata (repository, title, status, diff) that the sidebar and project pages render.

This project is designed for local experimentation and human-in-the-loop development—not unattended production changes. The repository flow accepts public GitHub, GitLab, and Bitbucket URLs. Patch downloads work for all three; direct pull request publishing is available for GitHub repositories.

## Architecture

- **Frontend:** Next.js + React, chat, activity, and diff review. `/api/chat` streams AI SDK UI messages.
- **Agent:** an authored AI SDK agent in `apps/frontend/agent/` using OpenRouter, repository tools, and web search.
- **Sandbox:** each session gets a persistent E2B cloud sandbox with its repository checked out at `/workspace`.
- **Persistence:** Convex stores sessions, projects, and the serialized AI SDK message transcript.

## Repository layout

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build/repo) monorepo:

- `apps/frontend` — Next.js web application + AI SDK agent (`:3000`)
- `convex/` — Convex schema and functions (shared deployment)

## Prerequisites

- Node.js 22 or newer
- pnpm (`corepack enable`)
- An [E2B API key](https://e2b.dev/docs/getting-started/api-key) for isolated cloud sandboxes
- An [OpenRouter API key](https://openrouter.ai) for the model

## Configuration

Create `apps/frontend/.env` (see `apps/frontend/.env.example`):

```dotenv
NEXT_PUBLIC_CONVEX_URL="https://your-deployment.convex.cloud"
OPENROUTER_API_KEY="your-openrouter-api-key"
E2B_API_KEY="your-e2b-api-key"
MODEL="openai/gpt-5.4-mini"
GITHUB_CLIENT_ID="your-oauth-app-client-id"
GITHUB_CLIENT_SECRET="your-oauth-app-client-secret"
GITHUB_COOKIE_SECRET="at-least-32-random-characters"
```

For repository publishing, create a GitHub OAuth App with
`http://localhost:3000/api/github/callback` as its authorization callback URL.
The app requests `public_repo` access. Tokens stay in an encrypted, HTTP-only
cookie and are never sent to the agent sandbox. When the user cannot push to
the source repository, OpenDevin creates or reuses their fork before opening
the pull request.

For application sign-in, create a second GitHub OAuth App. Its callback URL is
`https://<your-convex-deployment>.convex.site/api/auth/callback/github` (find
this HTTP Actions URL in the Convex dashboard). Set its credentials on Convex:

```bash
pnpm exec convex env set AUTH_GITHUB_ID "your-github-login-client-id"
pnpm exec convex env set AUTH_GITHUB_SECRET "your-github-login-client-secret"
```

This GitHub login is what scopes projects and sessions to one user. It is
separate from the repository-publishing OAuth app because GitHub OAuth Apps
accept only one callback URL.

## Run locally

```bash
pnpm install
pnpm convex:dev
pnpm dev
```

Open `http://localhost:3000`. Turborepo starts the frontend and its AI SDK chat route.

## Common commands

```bash
pnpm dev          # Start the frontend
pnpm build        # Build/check all workspaces
pnpm lint         # Lint all workspaces
pnpm format       # Check formatting
pnpm format:fix   # Format files
pnpm convex:dev   # Run Convex locally and generate bindings
pnpm convex:codegen # Regenerate Convex bindings
```

Do not commit `.env` files or API keys.
