# OpenDevin Cloud-Agent Roadmap

## Goal

Evolve OpenDevin from a local human-in-the-loop coding workspace into a safe, multi-user, Devin-like cloud coding agent.

The product loop should be:

```text
User request
  -> authenticated session
  -> isolated cloud sandbox
  -> agent plans and edits code
  -> project runs in sandbox
  -> user reviews live preview and evidence
  -> pull request or approved merge
  -> sandbox is cleaned up
```

## Current baseline

Already working:

- Next.js chat interface
- Ollama-powered coding agent
- E2B sandbox per repository workspace
- Read-only planning followed by explicit approval
- Repository tools: read, edit, write, command, Git inspection
- SSE run activity streaming
- Convex persistence for sessions, runs, events, and artifacts
- Per-run branches
- Validation commands and limited recovery attempts
- Diff/review UI
- Interactive terminal over WebSocket
- Basic path, command, output-size, and secret-redaction guardrails

Important current limitations:

- Public repositories only
- No users, authentication, organizations, or authorization
- No live application preview
- No GitHub push, pull request, or merge workflow
- No cost/token accounting
- No robust session timeout/cleanup worker
- API and terminal routes are effectively unauthenticated
- Convex-backed persistence

## Product decisions

1. Keep plan approval enabled by default. Automatic execution can be an explicit trusted-workspace setting later.
2. Every task executes in an isolated sandbox and a dedicated Git branch.
3. The main API server never executes repository code directly.
4. Users see simple progress messages; raw logs and terminal output remain an advanced view.
5. Pull requests are the default delivery mechanism. Merging to the default branch requires an organization admin.
6. Never store or reuse Claude Pro subscription OAuth tokens. Hosted model access must use an approved API-key/BYOK design.
7. Do not expose the product publicly until authentication, ownership checks, rate limits, and sandbox cleanup are complete.

---

## Phase 0 — Stabilize the existing MVP

### Work

- Add automated tests for `safePath`, `safeCommand`, output redaction, session lifecycle, plan approval, cancellation, and validation recovery.
- Add shared status constants instead of free-form status strings.
- Add structured backend logging with request, session, run, and sandbox IDs.
- Validate all request bodies with Zod, including prompts, session IDs, event cursors, and validation commands.
- Fix error handling so raw internal errors, credentials, and sandbox identifiers are not unnecessarily returned.
- Decide whether a stopped sandbox can be resumed; otherwise clearly model it as terminal and create a new workspace.

### Acceptance criteria

- `pnpm build`, `pnpm lint`, and tests pass.
- Invalid paths, commands, prompts, and IDs are rejected consistently.
- A failed planning or execution run always reaches a durable terminal status.
- The UI can refresh and reconstruct the latest run from persisted events.

---

## Phase 1 — Live preview (highest product priority)

### Backend

Create a project runtime configuration containing:

- Install command
- Frontend start command
- Backend start command
- Frontend port
- Backend port
- Environment variables
- Health-check URL
- Startup timeout

Add a sandbox runtime service, preferably in:

- `apps/backend/src/services/sandbox-runtime.ts`
- `apps/backend/src/services/preview.ts`

Responsibilities:

1. Start configured services inside the sandbox.
2. Capture stdout/stderr with bounded output and redaction.
3. Wait for health checks.
4. Expose ports with E2B host URLs.
5. Store preview metadata on the session.
6. Restart or refresh services after agent changes.
7. Kill all child processes when the session ends.

Extend `Sessions` with fields such as:

- `previewUrl`
- `apiPreviewUrl`
- `runtimeStatus`
- `runtimeError`
- `lastHealthCheckAt`

### Frontend

Add:

- `PreviewPane`
- Preview URL/status indicator
- Loading, crashed, and unavailable states
- Refresh button
- Split layout: chat/activity on the left, preview on the right
- A safe external-link fallback when iframe embedding is blocked

### Acceptance criteria

- A configured sample application starts inside E2B.
- The frontend preview loads from the browser.
- Frontend API requests reach the sandbox backend.
- Agent changes can be viewed after an automatic or manual refresh.
- Runtime failures appear as useful user-facing messages and detailed activity events.

---

## Phase 2 — GitHub integration and delivery

### Authentication and repository access

Add GitHub OAuth with the minimum required scopes. Use a provider library such as Arctic or a maintained OAuth implementation. Add:

- OAuth callback routes
- Encrypted access-token storage
- Token refresh/revocation handling
- Repository listing and selection
- Private repository cloning
- Repository ownership/access checks

Suggested files:

- `apps/backend/src/auth/*`
- `apps/backend/src/integrations/github.ts`
- `apps/backend/src/routes/github.ts`
- `apps/backend/src/middleware/require-auth.ts`

### Branch and pull request workflow

Add backend operations:

- Push the run branch using the authenticated GitHub token
- Create a pull request
- Persist PR URL, number, title, body, and commit SHA
- Close/discard a run without pushing
- Merge only after admin authorization
- Stop the sandbox after delivery

Extend `AgentRun` with fields such as:

- `deliveryStatus`
- `commitSha`
- `prUrl`
- `prNumber`
- `deliveredAt`

Add frontend actions:

- `Create pull request`
- `Open pull request`
- `Merge to default branch` for admins
- `Discard changes`

### Acceptance criteria

- A private repository can be selected and cloned by an authorized user.
- A run branch can be pushed without exposing tokens in logs.
- A pull request is created with summary and validation results.
- Members cannot merge; admins can merge.
- Sandbox cleanup occurs after PR, merge, discard, or failure.

---

## Phase 3 — Authentication, organizations, and authorization

### Data model

Add:

- `User`
- `AuthSession`
- `Organization`
- `OrganizationMember`
- `Project`
- `ProjectMember` if project-level access is needed
- `Invite`
- OAuth account/token records

Use Convex as the single production and local persistence layer.

### Authorization rules

- Every session belongs to a user and organization/project.
- Every run is accessible only to authorized organization members.
- Project configuration is admin-only.
- Chat/run creation is member-only.
- PR creation is member-only.
- Merge and repository configuration are admin-only.
- Terminal access is disabled or restricted for non-trusted users.

Protect every route, SSE stream, WebSocket upgrade, and frontend query with authorization middleware.

### Acceptance criteria

- Anonymous users cannot list, read, stop, or control sessions.
- A user cannot access another organization's session by changing an ID.
- Invitations and role changes work end to end.
- GitHub repositories shown belong to the authenticated user or organization.

---

## Phase 4 — Project setup and reproducible sandboxes

Replace ad-hoc repository startup with an explicit project setup flow.

### Project setup fields

- Repository and default branch
- Framework/runtime version
- Install/build/start commands
- Required ports
- Required external services
- Safe environment variables/secrets
- Agent context instructions
- Allowed file patterns
- Validation commands
- Session duration and budget limits

### Sandbox lifecycle

Create a reusable template or image for each project when possible. At session start:

1. Create the sandbox from the project template.
2. Clone the selected branch.
3. Create a task branch.
4. Inject secrets only at runtime.
5. Start dependencies and application processes.
6. Run health checks.
7. Return preview metadata.

Acceptance criteria:

- A new session is reproducible from project configuration.
- Secrets are never persisted in Git artifacts or UI messages.
- A failed startup gives actionable diagnostics.

---

## Phase 5 — Limits, security, and reliability

### Agent and API limits

Implement:

- Maximum run duration
- Maximum sandbox lifetime
- Maximum model steps
- Maximum prompt/output size
- Per-session and per-user cost limits
- Concurrent-run limits per project
- Rate limiting for session creation, chat, terminal input, and GitHub actions
- Idempotency keys for delivery operations

Add usage fields to `AgentRun`:

- `inputTokens`
- `outputTokens`
- `estimatedCost`
- `maxBudget`

### Sandbox security

- Run repository code only inside the sandbox.
- Use non-root sandbox users.
- Restrict sensitive file reads and writes.
- Redact secrets from stdout, stderr, events, artifacts, diffs, and model context.
- Validate validation commands before execution.
- Block force pushes, destructive Git commands, credential access, and unsafe path traversal.
- Restrict network access where project requirements allow it.
- Add an explicit approval for elevated or irreversible actions.
- Keep a durable audit trail of tool calls and delivery actions.

### Cleanup and recovery

Create a worker, for example:

- `apps/backend/src/jobs/cleanup-sandboxes.ts`

It should find expired, orphaned, failed, and completed sessions and kill their sandboxes/processes. Use a persistent lease/heartbeat so a backend restart does not lose ownership of cleanup.

Acceptance criteria:

- No sandbox survives beyond its configured lifetime.
- Backend restart can reconnect to or safely terminate active sessions.
- Repeated delivery requests do not create duplicate PRs or merges.
- Limits are enforced server-side, not only in the UI.

---

## Phase 6 — Hosted model and worker architecture

The current Ollama model is suitable for local development. For hosted use:

- Move long-running planning/execution from the Express request process to a job queue/worker.
- Persist run state before starting work.
- Support cancellation through durable job state.
- Use a production model provider or an approved BYOK API-key flow.
- Record provider/model, token usage, latency, and cost.
- Keep model credentials server-side or encrypted per user/organization.

Suggested components:

- Redis-backed queue such as BullMQ, or a managed job system
- `agent-worker`
- `sandbox-worker`
- `cleanup-worker`
- Central event publisher for SSE/WebSocket clients

Acceptance criteria:

- A backend HTTP restart does not terminate or corrupt a run.
- Multiple runs can execute without blocking the API process.
- Users can reconnect and receive missed events from the database.

---

## Phase 7 — Quality and production readiness

### Observability

- Structured logs
- Error tracking
- Sandbox startup latency
- Agent success/failure rate
- Validation pass rate
- Preview health rate
- Cost per run
- PR delivery rate
- Cleanup failure alerts

### Testing

Add end-to-end coverage for:

1. Sign in and authorization.
2. Repository selection and private clone.
3. Project setup and template build.
4. Sandbox startup and live preview.
5. Plan generation and approval.
6. Agent edit and validation recovery.
7. Diff review.
8. PR creation.
9. Admin merge.
10. Cancellation, timeout, reconnect, and cleanup.
11. Cross-organization access denial.
12. Secret redaction and command guardrails.

### Deployment

- Convex
- Redis/job queue if workers are used
- Managed frontend
- API service
- Worker services
- Secret manager
- HTTPS everywhere
- Database backups and migrations
- E2B production account/configuration

---

## Prioritized delivery schedule

| Priority | Deliverable | Result |
|---|---|---|
| P0 | Phase 0 stabilization | Safe, testable current MVP |
| P0 | Phase 1 live preview | Users can see the app being changed |
| P0 | Phase 2 GitHub PR flow | Changes can reach a real repository |
| P0 | Phase 3 auth and authorization | Safe multi-user foundation |
| P1 | Phase 4 project setup/templates | Reproducible project sessions |
| P1 | Phase 5 limits/security/cleanup | Production safety and predictable costs |
| P1 | Phase 6 workers/hosted model | Reliable cloud execution |
| P2 | Phase 7 observability/deployment | Production operations and scale |

## Definition of done for a Devin-like MVP

The MVP is ready when an authenticated user can:

1. Connect an authorized private GitHub repository.
2. Configure how the project starts.
3. Start an isolated cloud session on a new branch.
4. See a working live preview.
5. Ask the agent to make a change.
6. Watch safe, human-readable progress.
7. Review the diff and validation results.
8. Fix validation failures through another approved run.
9. Create a pull request.
10. Have the sandbox automatically cleaned up.

Until steps 1, 3, 4, 7, 9, and 10 are complete, OpenDevin should remain labeled an experimental/local workspace rather than a production cloud agent.
