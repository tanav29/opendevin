# OpenDevin

# GH APP LINK - https://github.com/settings/apps/tp-opendevin
# SHADCN theme - bdvw9qPg

OpenDevin is a small Next.js developer workspace with an Express API, Better Auth, and a Prisma SQLite database.

## What it does

OpenDevin turns a coding request into a direct, observable conversation:

1. Start a workspace from a public Git repository.
2. Chat with the agent as it inspects the repository and makes changes directly.
3. The agent works through minimal tools: read, edit, write, run commands, and web search.
4. Review the changed files side by side.
5. Download the patch, or connect GitHub to publish it as a branch and pull request.

The first version intentionally keeps the foundation small: authentication and projects are ready, while sessions and agent features can be added without introducing a second backend platform.

This project is designed for local experimentation and human-in-the-loop development—not unattended production changes. The repository flow accepts public GitHub, GitLab, and Bitbucket URLs. Patch downloads work for all three; direct pull request publishing is available for GitHub repositories.

## Architecture

- **Frontend:** Next.js + React (`:3000`).
- **Backend:** Express + Better Auth (`:3001`).
- **Persistence:** Prisma + SQLite stores users and projects.

## Repository layout

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build/repo) monorepo:

- `apps/frontend` — Next.js web application (`:3000`)
- `apps/backend` — Express API, auth, and Prisma schema (`:3001`)

## Prerequisites

- Node.js 22 or newer
- pnpm (`corepack enable`)
- A GitHub OAuth application for sign-in

## Configuration

Create `apps/backend/.env` from `.env.example` and set GitHub OAuth credentials:

```dotenv
GITHUB_CLIENT_ID="your-oauth-app-client-id"
GITHUB_CLIENT_SECRET="your-oauth-app-client-secret"
DATABASE_URL="file:./dev.db"
```

Use `http://localhost:3001/api/auth/callback/github` as the OAuth callback URL.

## Run locally

```bash
pnpm install
pnpm --filter @opendevin/backend db:push
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
pnpm --filter @opendevin/backend db:studio # Open the local database
```

Do not commit `.env` files or API keys.
