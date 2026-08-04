# Voice Agent — Design

**Date:** 2026-08-03
**Status:** Draft — pending user review

## Problem

Cockpit runs many Claude terminals; the user wants hands-free control —
spawning terminals, switching workspaces, dictating prompts, and hearing
status — without reaching for keyboard/mouse. A future phone-remote channel
should reuse the same control surface.

## Decisions (from brainstorm)

- **Activation:** push-to-talk global hotkey (hold/toggle). Mic is verifiably
  off otherwise. No wake word in v1.
- **v1 scope:** cockpit control + dictation into the focused terminal +
  spoken status readback. No conversational session analysis in v1.
- **STT:** local Whisper (whisper.cpp), on-device, offline.
- **TTS:** local. v1 uses macOS `say` behind a swappable `Speaker` interface
  (zero dependencies; a nicer local voice can replace it later without
  touching callers).

## Architecture

Three pieces, joined by one control channel:

```
┌─────────────┐  global hotkey   ┌──────────────────┐
│  Cockpit    │ ───────────────► │  Voice sidecar    │
│  (Tauri)    │                  │  (Node + Agent SDK)│
│             │ ◄──────────────── │  mic → whisper.cpp │
│  WS control │   JSON commands  │  agent → tools     │
│  server     │   + event stream │  say → TTS         │
└─────────────┘                  └──────────────────┘
```

### 1. Control channel (Rust, in cockpit)

A localhost WebSocket server inside the Tauri backend — **the** controller
API. JSON-RPC-shaped: requests invoke the same underlying operations the
frontend's ~37 Tauri commands use; a server-push event stream carries
terminal status changes (for readback and future phone remote).

- Bound to `127.0.0.1`, ephemeral port, token-authenticated (token minted at
  startup, passed to the sidecar via its environment — never on disk).
- v1 command surface (names indicative, finalized in the plan):
  `spawn_terminal {projectId?, provider?, workspaceId?}`,
  `switch_workspace {workspaceId}`, `focus_pane {paneId}`,
  `close_pane {paneId}`, `write_to_pane {paneId, text}` (→ ptyWrite),
  `get_state {}` (projects, workspaces, terminals + statuses).
- Commands that today live purely in frontend state (workspace switching,
  focus) are forwarded to the frontend over a Tauri event and applied by a
  small dispatcher hook — the WS server is the single entry point either way.
- The phone remote later connects to this same server (auth hardening then:
  pairing, TLS or tunnel — out of scope now, but nothing in v1 may assume
  the only client is the sidecar).

### 2. Voice sidecar (Node + Claude Agent SDK)

Spawned and supervised by cockpit (auto-restart on crash, killed on quit).
Owns the mic, whisper.cpp streaming transcription, TTS, and an Agent SDK
agent whose tools map 1:1 onto the control channel commands.

- Push-to-talk flow: cockpit's global-shortcut handler (Tauri
  global-shortcut plugin) sends `ptt_down`/`ptt_up` to the sidecar; the
  sidecar records while held, transcribes on release, feeds the transcript
  to the agent.
- The agent decides: control command(s) via tools, dictation
  (`write_to_pane` to the focused terminal), or a spoken answer built from
  `get_state`.
- Dictation guard: text is written to the PTY **without** a trailing newline
  by default ("send it" / "submit" appends `\r`) — a mis-transcription must
  not auto-execute in a terminal.

### 3. Cockpit UI

Minimal: a StatusBar mic indicator (idle / listening / thinking / speaking)
and a settings row for the hotkey. No new panes.

## Error handling

- Sidecar not running / channel down → mic indicator shows error state;
  hotkey does nothing audible except a soft failure sound.
- Whisper model missing → sidecar downloads on first run with progress
  surfaced in the StatusBar indicator's tooltip.
- Unknown/ambiguous voice command → agent answers by voice ("I didn't catch
  which project"), never guesses a destructive action; `close_pane` requires
  an explicit pane reference.

## Testing

- Control channel: Rust unit tests for auth rejection + command dispatch
  (fake state); protocol types shared/mirrored in TS with round-trip tests.
- Agent tools: TS unit tests against a fake channel client (each tool sends
  the right frame; dictation guard appends no `\r` unless told).
- STT/TTS: manual smoke (scripted phrases checklist) — audio I/O is not
  unit-testable meaningfully.

## Out of scope (v1)

Wake word; conversational analysis of session content; phone remote client;
non-macOS platforms; barge-in (interrupting TTS by speaking).
