# Provider Profiles — Kimi (and friends) behind Claude Code

**Date:** 2026-07-18
**Status:** Approved

## Goal

Let individual cockpit terminals run Claude Code against non-Anthropic,
Anthropic-compatible APIs — first target: Moonshot's Kimi (K3). The user picks
the provider per terminal at spawn. Everything built on Claude Code's
transcripts (session sidebar, starring, resume, model/effort/token readouts,
XP) keeps working, because the CLI is still Claude Code — only its API
endpoint and model change via environment variables.

Explicitly out of scope: other agent CLIs (OpenCode, Kimi CLI) as first-class
citizens, and proxy daemons (CLIProxyAPI). Those can still be typed as custom
project commands, with degraded readouts.

## Background

Claude Code honors `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_MODEL`, the `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` slots,
and `CLAUDE_CODE_SUBAGENT_MODEL`. Moonshot exposes an Anthropic-compatible
endpoint at `https://api.moonshot.ai/anthropic`.

**Open verification item:** Moonshot's docs currently show the Claude Code
recipe with `kimi-k2.7-code`; K3 (`kimi-k3`, 1M context, released
2026-07-16) is so far only documented on their OpenAI-compatible endpoint.
Verify `kimi-k3` works via `/anthropic` with a real API key during
implementation; if not, ship the profile defaulting to `kimi-k2.7-code` and
flip to `kimi-k3` in config when available. The model id is profile data, so
this is a config edit, not a code change.

## Design

### 1. Rust owns profiles and secrets

Profiles live entirely in the Rust backend; the frontend never sees env values
or API keys.

- **Profile shape:** `{ id, label, env: {VAR: value}, contextWindow? }`.
  `env` values may contain `${SECRET_NAME}` references.
- **Built-ins** (in code):
  - `claude` — label "Claude", empty env. Exactly today's behavior; default.
  - `kimi` — label "Kimi", env:
    `ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic`,
    `ANTHROPIC_AUTH_TOKEN=${MOONSHOT_API_KEY}`,
    `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`,
    `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`,
    `CLAUDE_CODE_SUBAGENT_MODEL` all set to the Kimi model id (see
    verification item); `contextWindow: 1048576`.
- **User overrides:** optional `~/.claude-cockpit/providers.json` — an array
  of profiles merged over the built-ins by `id` (same id replaces, new id
  appends). Malformed file → log + fall back to built-ins; never crash spawn.
- **Secret resolution at spawn, in Rust:** `${NAME}` resolves from the
  process environment first, then `~/.config/sontiac/.env` (the machine-wide
  secrets file, parsed as simple `KEY=value` lines). Unresolvable secret →
  spawn fails with a `CockpitError` naming the missing variable; the UI
  surfaces it. No silent fallback (that would quietly bill Anthropic).
- **IPC:** `list_providers` returns `[{id, label, contextWindow}]` — never
  env values or secrets. `pty_spawn` gains
  `provider: Option<String>`; unknown id → error. `None` behaves as `claude`.
- Profile env is applied after the inherited environment and before cockpit's
  terminal overrides (`TERM`, `COLORTERM`, locale).

### 2. Persistence

`PersistedTerminal` gains an optional `provider` field storing the profile
**id** — never resolved env, so no secret ever lands in the workspace store.
Restore respawns the terminal with its profile; a persisted id that no longer
exists falls back to `claude` with a logged warning.

### 3. UI

- The new-terminal action keeps its one-click default (default profile). A
  small dropdown affordance on the button lists all profiles from
  `list_providers`; picking one spawns a terminal on that provider.
- Terminals on a non-default provider show a small provider chip (the
  profile label) in the terminal header next to the model readout.
- Spawn errors (missing secret, unknown provider) surface in the terminal
  cell like existing spawn failures.

### 4. Readouts

- Transcripts still land in `~/.claude/projects` — sidebar, starring,
  resume, `--session-id` injection, and XP are untouched.
- `formatModelShort` learns Kimi ids: `kimi-k3` → "Kimi K3",
  `kimi-k2.7-code` → "Kimi K2.7" (fallback for unknown shapes stays the raw
  id).
- The context-usage badge scales its tier thresholds proportionally when the
  terminal's profile declares `contextWindow` (baseline 1M = current
  absolute thresholds). Both shipping profiles are 1M, so today's visuals are
  unchanged; a future sub-1M provider gets honest tiers. The terminal's
  profile id is already known to the frontend, and `list_providers` includes
  `contextWindow` for this purpose (id, label, contextWindow — still no env).

## Error handling summary

| Failure | Behavior |
|---|---|
| Missing `${SECRET}` | Spawn fails; error names the variable |
| Unknown provider id at spawn | Spawn fails with error |
| Persisted provider id no longer exists | Restore falls back to `claude`, logs |
| Malformed `providers.json` | Ignored with log; built-ins only |

## Testing

- **Rust:** profile merge (override/append/malformed), `${SECRET}`
  resolution (process env, secrets file, missing → error), env assembly
  order, unknown-id rejection.
- **TS:** `formatModelShort` Kimi mappings; provider picker renders
  `list_providers` results; persisted provider id round-trips; context badge
  scaling with a non-1M `contextWindow`.
- **Manual (needs real key):** spawn a Kimi terminal, confirm `/status`
  inside Claude Code shows the Moonshot base URL and the Kimi model, and that
  a short session writes a normal transcript (readouts populate).
