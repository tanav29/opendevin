# Session panel state contract

This document defines the data and UI behavior for the session right panel. It
is the source of truth for implementing Preview, Changes, and session status.

## Ownership of state

| State | Owner | Persistence |
| --- | --- | --- |
| Session id, repository, created and updated times | Convex `sessions` record | Convex |
| Sandbox id and workspace path | Convex `sessions.sandbox` and `sessions.cwd` | Convex |
| Agent lifecycle (`idle`, `running`, `failed`) | Convex `sessions.status` | Convex |
| Transcript and latest patch | Convex `sessions.parts` and `sessions.diff` | Convex |
| Selected session | Client UI state | Local storage, keyed globally |
| Right-panel open/collapsed state, width, and active tab | Client UI state | Local storage |
| Preview port, path, resolved URL, request/error state | Client UI state | Reset when its session or sandbox changes |

Do not mirror server-backed session fields in a client store. Convex remains the
live source for them, so reconnects and updates from another client cannot
leave the interface showing stale lifecycle data.

## Right-panel states

The right panel has one of these externally visible states:

- **Hidden:** the panel is collapsed by user choice. A persistent, labelled
  restore control remains available. Its selected tab is retained.
- **Unavailable:** the selected session does not have an available sandbox.
  The panel must explain that Preview is unavailable and Changes shows only the
  last saved diff, if any. It must not claim the sandbox is running.
- **Loading:** the session has a sandbox id but the requested preview endpoint,
  diff, or sandbox availability check is pending. Controls that would use the
  result are disabled and labelled as loading.
- **Preview:** an available sandbox is selected and the Preview tab is active.
  The iframe is shown only after its URL resolves successfully.
- **Changes:** the Changes tab is active. It renders the latest persisted patch
  for the selected session, including an explicit no-changes state.

A panel can be open while its content is unavailable or loading. That keeps a
user's layout choice independent of short-lived infrastructure state.

## Sandbox lifecycle

A session is **sandbox-enabled** when `sessions.sandbox` is set. It is
**sandbox-available** only after an operation against that sandbox succeeds.
The existing preview endpoint makes that operation with `findSandbox(sessionId)`
and returns `404` when the sandbox is missing.

A sandbox is considered **running** while the active agent request is using it
or while a sandbox-dependent request succeeds. Its id alone is not evidence
that it is still running: sandboxes can expire outside the application.

When a sandbox-dependent operation reports that the sandbox is missing,
expired, or unreachable:

1. Stop loading and move Preview to an unavailable/error state.
2. Keep the panel open and retain the user's selected tab and dimensions.
3. Keep the last persisted diff readable; never clear it because the sandbox
   stopped.
4. Offer retry/reconnect. A retry must resolve the sandbox again rather than
   reuse an old preview URL.
5. Reset any iframe URL and preview request state when the sandbox id changes.

## Session status model

The current persisted model has these fields:

- `createdAt`: immutable creation timestamp.
- `updatedAt`: last successful session mutation timestamp; useful for recency,
  but not a substitute for a lifecycle event time.
- `sandbox` and `cwd`: sandbox identity and workspace location, when assigned.
- `status`: agent lifecycle: `idle`, `running`, or `failed`.
- `parts` and `diff`: the persisted transcript and most recently collected
  patch.

The UI derives streaming state from the active chat transport and displays it
alongside the persisted lifecycle state:

| Display state | Condition |
| --- | --- |
| Active | transport is submitted or streaming; persist `running` |
| Paused | transport is ready but the user stopped an in-progress turn |
| Complete | transport is ready and persisted status is `idle` |
| Failed | transport reports an error or persisted status is `failed` |
| Reconnecting | Convex data is unavailable after it was previously available, or a retry is in progress |

Client transport state is intentionally not persisted because it is tied to one
browser connection. After a refresh or reconnect, the UI should show the last
persisted status until a new live transport state is known.

## State transitions and session switching

- Changing the selected session retains the user's panel open/collapsed choice,
  width, and selected tab, but resets request-scoped Preview state (port may be
  retained only as a user preference, never its URL or error).
- A selected Preview tab remains selected after collapsing and restoring the
  panel. If the new session has no available sandbox, it instead shows the
  Preview unavailable state with an explanation.
- A missing selected session is an empty workspace state, not a sandbox error.
- Convex query `undefined` is loading/disconnected data, not an empty session
  list. Do not render no-session or no-changes conclusions before the query is
  resolved.
- Errors must name the failed capability (for example, “Preview unavailable”)
  and include a recovery action where retrying can help.
