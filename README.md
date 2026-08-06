# OpenDevin

A local autonomous coding workspace powered by an Ollama agent and isolated E2B sandboxes.

## Monorepo

This repository is a pnpm + Turborepo monorepo:

- `apps/frontend` — Next.js web application
- `apps/backend` — Express API, Prisma schema, and agent runtime

## Run locally

```bash
pnpm install
pnpm db:generate
pnpm dev
```

Turborepo starts both applications. The frontend runs at `http://localhost:3000`; the API runs at `http://localhost:3001`.

Backend `.env` requires `E2B_API_KEY` and `DATABASE_URL`. Set `OLLAMA_MODEL` to change the model (defaults to `qwen3.5:4b`) and start Ollama locally.

## Common commands

```bash
pnpm build
pnpm lint
pnpm db:migrate
```
