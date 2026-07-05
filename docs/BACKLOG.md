# Backlog

Small tracked items not yet scheduled. One line per item; detail lives in the
linked spec/commit when picked up.

- B1 — ContextPill shows stale token count after `/clear` in Claude (and possibly
  `/resume`): the pane appears to stay attached to the previous session's context.
  Likely the session id is resolved once at spawn and never re-resolved when Claude
  starts a new session. Reported 2026-07-05.
