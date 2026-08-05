# OpenDevin

A local autonomous coding workspace: connect a Git repository, provision an isolated E2B sandbox, and collaborate with an Ollama-powered coding agent.

## Run locally

```bash
cd backend
pnpm install
pnpm db:generate
pnpm dev

# in another terminal
cd frontend
pnpm install
pnpm dev
```

The frontend runs at `http://localhost:3000`; the API runs at `http://localhost:3001`.

Backend `.env` requires `E2B_API_KEY` and `DATABASE_URL`. Set `OLLAMA_MODEL` to change the model (defaults to `qwen3.5:4b`) and start Ollama locally.

## Included

- Repository connection and isolated E2B workspace provisioning
- Persistent Prisma/SQLite sessions with status and archive support
- Streaming agent endpoint with repository tools: commands, file reads, exact edits, and writes
- Responsive workspace UI with session navigation, chat composer, activity panel, and connection states
- CORS, health endpoint, input validation, and actionable error states
