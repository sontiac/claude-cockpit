# Voice Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push-to-talk voice control of cockpit — spawn/close/focus terminals, switch workspaces, dictate prompts into the focused terminal, hear status readbacks — via a supervised Node sidecar and a token-authed localhost WS control channel that a future phone remote reuses.

**Architecture:** Three pieces. (1) A **Rust control server** inside the Tauri backend: localhost WebSocket, token auth, JSON-RPC-ish dispatch — some commands answered from a frontend-pushed state mirror or executed directly (ptyWrite), others forwarded to the frontend over Tauri events. (2) **Frontend**: a dispatcher hook applying forwarded commands + pushing state snapshots, a PTT mic-capture hook (getUserMedia → AudioWorklet → 16kHz WAV), and a StatusBar indicator. (3) A **Node sidecar** (spawned/supervised by Rust): whisper.cpp transcription, a **Claude Agent SDK** session (`query()` with `resume`-chained session ids, `tools: []` so only the cockpit MCP tools exist) whose tools call the control channel, and TTS via macOS `say`. The Agent SDK authenticates via the existing Claude Code login — **plan-billed, no API key**.

**Tech Stack:** Rust (tokio, tokio-tungstenite), Tauri v2 + `tauri-plugin-global-shortcut`, React 19 + TS, Vitest, Node + TypeScript sidecar (`@anthropic-ai/claude-agent-sdk` + zod, `ws`), `whisper-cli` (already installed via Homebrew), `/usr/bin/say`.

**Spec:** `docs/superpowers/specs/2026-08-03-voice-agent-design.md` (as amended: Tool Runner harness; webview mic capture).

## Global Constraints

- Control server binds `127.0.0.1` only, ephemeral port; every client's **first frame** must be `{"auth": "<token>"}` with the token minted at startup — anything else closes the socket. Token reaches the sidecar via env only, never disk.
- Dictated text is written to the PTY **without** a trailing newline unless the transcript asks to send/submit (the agent controls a `submit` flag). `close_pane` requires an explicit pane reference from the user.
- The agent model is config (`~/.claude-cockpit/voice.json`), default `"sonnet"` (Claude Code model alias). The sidecar must run with **no** `ANTHROPIC_API_KEY` in its env (strip it when spawning) so the Agent SDK resolves the Claude Code plan login.
- Never launch or kill the production cockpit app; build only. The user smoke-tests voice.
- Every task ends green: `npx tsc --noEmit && npm test` at repo root; `cargo test` in `src-tauri/` for Rust tasks; `npm test` in `voice-sidecar/` for sidecar tasks.
- Existing behavior is untouched when the sidecar is absent or dead: cockpit must run exactly as today (indicator shows error state; nothing else changes).

---

## Interfaces (shared contract — read before any task)

Wire frames on the control channel (all JSON text frames):

```jsonc
// client → server, first frame
{"auth": "<token>"}
// client → server request
{"id": 3, "method": "get_state", "params": {}}
// server → client response
{"id": 3, "ok": true, "result": {...}}   // or {"id":3,"ok":false,"error":"..."}
// server → client events
{"event": "ptt", "state": "down" | "up"}
{"event": "utterance", "wav_base64": "..."}   // PTT release delivers captured audio
{"event": "state", "data": <StateSnapshot>}   // mirror updates, also sent right after auth
// client → server event (no id): sidecar's UI status, forwarded to the frontend
{"event": "voice_status", "state": "idle"|"listening"|"transcribing"|"thinking"|"speaking"|"error", "detail": "optional string"}
```

Methods (`method` → route): `get_state` → answered from mirror; `write_to_pane {paneId?, text, submit}` → backend (resolves `paneId` omitted ⇒ mirror's focused terminal, then `pty_write`, appending `"\r"` iff `submit`); `spawn_terminal {projectName?, provider?, workspaceName?}`, `switch_workspace {name}`, `focus_pane {label}`, `close_pane {label}` → forwarded to frontend.

`StateSnapshot` (TS `src/types/control.ts`, mirrored by Rust serde struct):

```typescript
export interface StateSnapshot {
  workspaces: { id: string; name: string; active: boolean }[];
  terminals: {
    id: string; label: string; status: string;
    workspaceId: string; projectId: string | null; focused: boolean;
  }[];
  projects: { id: string; name: string }[];
}
```

---

### Task 1: Control protocol types + routing (Rust, pure)

**Files:**
- Create: `src-tauri/src/control/mod.rs`, `src-tauri/src/control/protocol.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod control;`)

**Interfaces:**
- Produces: `protocol::{Request, Response, Route, route_of, parse_request, check_auth}` — Task 2 consumes exactly these.

- [ ] **Step 1: Write the failing tests** (in `protocol.rs` `#[cfg(test)]`)

```rust
#[test]
fn auth_frame_with_correct_token_passes() {
    assert!(check_auth(r#"{"auth":"tok-1"}"#, "tok-1"));
}

#[test]
fn auth_frame_with_wrong_or_malformed_token_fails() {
    assert!(!check_auth(r#"{"auth":"nope"}"#, "tok-1"));
    assert!(!check_auth(r#"{"id":1,"method":"get_state"}"#, "tok-1"));
    assert!(!check_auth("not json", "tok-1"));
}

#[test]
fn requests_parse_and_route() {
    let r = parse_request(r#"{"id":7,"method":"get_state","params":{}}"#).unwrap();
    assert_eq!(r.id, 7);
    assert_eq!(route_of(&r.method), Some(Route::Mirror));
    let w = parse_request(r#"{"id":8,"method":"write_to_pane","params":{"text":"ls"}}"#).unwrap();
    assert_eq!(route_of(&w.method), Some(Route::Backend));
    let s = parse_request(r#"{"id":9,"method":"switch_workspace","params":{"name":"Two"}}"#).unwrap();
    assert_eq!(route_of(&s.method), Some(Route::Frontend));
    assert_eq!(route_of("bogus"), None);
}

#[test]
fn voice_status_event_is_not_a_request() {
    assert!(parse_request(r#"{"event":"voice_status","state":"thinking"}"#).is_none());
}
```

- [ ] **Step 2: Run to verify failure** — `cd src-tauri && cargo test control::` → compile error (module missing). 
- [ ] **Step 3: Implement** — `Request {id: u64, method: String, params: serde_json::Value}`; `parse_request` returns `Option<Request>` (None when `method`/`id` absent); `check_auth` strict-parses `{"auth": s}`; `Route {Mirror, Backend, Frontend}`; `route_of` matches the five frontend/backend/mirror methods above, `None` otherwise. `Response::ok(id, result)` / `Response::err(id, msg)` serializing to the wire shape.
- [ ] **Step 4: `cargo test` green.** 
- [ ] **Step 5: Commit** — `feat(control): wire protocol types, auth check, request routing`

---

### Task 2: Control server — WS listener, mirror, dispatch (Rust)

**Files:**
- Create: `src-tauri/src/control/server.rs`
- Modify: `src-tauri/src/state.rs` (add `control: ControlState`), `src-tauri/src/lib.rs` (start server in `.setup()`), `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: Task 1's protocol items; `crate::pty` write path used by the existing `pty_write` command.
- Produces:
  - `ControlState { token: String, port: OnceLock<u16>, mirror: Mutex<Option<serde_json::Value>>, clients: Mutex<Vec<UnboundedSender<String>>>, pending: Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>> }` in `state.rs`.
  - `control::server::start(app: AppHandle)` — binds `127.0.0.1:0`, stores port, accept-loop via `tauri::async_runtime::spawn`.
  - `control::server::broadcast(app, frame: &str)` — send to all authed clients.
  - Tauri commands (register in `lib.rs`): `push_control_state(state: serde_json::Value)` (store mirror + broadcast `{"event":"state",...}`), `control_respond(cid: u64, ok: bool, payload: serde_json::Value)` (resolve pending oneshot).
- Dispatch per request: `Mirror` → answer from mirror (`ok:false` "no state yet" if None); `Backend` (`write_to_pane`) → resolve target pane (param or mirror's `focused` terminal), write `text` + optional `"\r"` via the pty registry, reply; `Frontend` → insert oneshot into `pending` keyed by a fresh correlation id, `app.emit("control:command", {cid, method, params})`, await with 10s timeout → reply.
- Frontend-bound events the server also emits on non-request frames: `voice_status` → `app.emit("voice:status", …)`.

- [ ] **Step 1: `cargo add tokio-tungstenite futures-util` in `src-tauri/`** (tokio itself comes with tauri; confirm `tokio` features include `net`,`sync` — add if not).
- [ ] **Step 2: Write the failing test** — an integration-style test in `server.rs` for the auth handshake + mirror answer, using a real localhost socket but a bare `tokio_tungstenite::connect_async` client (no Tauri app needed for the core loop: factor the per-connection handler as `handle_socket(stream, deps)` where `deps` is a small trait or struct of closures for mirror-read/backend-write/forward, so the test injects fakes):

```rust
#[tokio::test]
async fn rejects_bad_auth_and_answers_get_state_after_good_auth() {
    let deps = TestDeps::with_mirror(serde_json::json!({"workspaces": []}));
    let addr = spawn_test_server("tok-1", deps).await;
    // Bad auth: connection closes without a response.
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}")).await.unwrap();
    ws.send("{\"auth\":\"wrong\"}".into()).await.unwrap();
    assert!(matches!(ws.next().await, None | Some(Ok(Message::Close(_)))));
    // Good auth: get_state answered from the mirror.
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}")).await.unwrap();
    ws.send("{\"auth\":\"tok-1\"}".into()).await.unwrap();
    let _state_event = ws.next().await; // initial {"event":"state",...}
    ws.send("{\"id\":1,\"method\":\"get_state\",\"params\":{}}".into()).await.unwrap();
    let reply: serde_json::Value = serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(reply["id"], 1);
    assert_eq!(reply["ok"], true);
}
```

- [ ] **Step 3: Verify RED, implement `handle_socket` + `start` + commands, verify GREEN** (`cargo test control::`).
- [ ] **Step 4: Wire `start(app)` into `.setup()` in `lib.rs`; register the two new commands in the `invoke_handler` list; full `cargo test` green.**
- [ ] **Step 5: Commit** — `feat(control): localhost WS control server with mirror + frontend forwarding`

---

### Task 3: Frontend dispatcher hook + state mirror (`useControlBridge`)

**Files:**
- Create: `src/hooks/useControlBridge.ts`, `src/hooks/useControlBridge.test.ts`, `src/types/control.ts`
- Modify: `src/App.tsx` (mount the hook), `src/lib/ipc.ts` (add `pushControlState`, `controlRespond`)

**Interfaces:**
- Consumes: Tauri event `control:command` `{cid, method, params}`; existing App-level callbacks.
- Produces: `useControlBridge(deps: ControlBridgeDeps): void` where

```typescript
export interface ControlBridgeDeps {
  snapshot: StateSnapshot;                    // rebuilt each render from terminals/workspaces/projects
  spawnTerminal(p: { projectName?: string; provider?: string; workspaceName?: string }): Promise<void>;
  switchWorkspace(name: string): boolean;     // false = no such workspace
  focusPane(label: string): boolean;
  closePane(label: string): boolean;
}
```

The hook (a) debounce-pushes `snapshot` via `pushControlState` whenever it changes (300ms), and (b) listens for `control:command`, applies via deps, replies `controlRespond(cid, ok, result)`. Unknown method ⇒ `ok:false`. App implements the deps by name-matching against its existing state (`workspaces.find(w => w.name === name)` etc.) and reusing `spawn`, `switchWorkspace`, `setActiveId`, `closePane`.

- [ ] **Step 1: Write failing tests** — mock `../lib/ipc` (`pushControlState`, `controlRespond`) and `@tauri-apps/api/event` (`listen` captured handler), `renderHook`:
  - pushes the snapshot on mount (after debounce, fake timers) and again when it changes; not when unchanged.
  - a `control:command` for `switch_workspace` calls `deps.switchWorkspace("Two")` and replies `controlRespond(cid, true, …)`.
  - deps returning `false` ⇒ `controlRespond(cid, false, …)`; unknown method ⇒ `ok:false`.
- [ ] **Step 2: RED** (`npx vitest run src/hooks/useControlBridge.test.ts`), **Step 3: implement**, **Step 4: GREEN + `npx tsc --noEmit && npm test`.**
- [ ] **Step 5: Wire in App.tsx** — build `snapshot` with `useMemo` from `terminals`/`workspaces`/`projects`/`activeId`/`activeWorkspaceId`; implement deps; mount hook. Full suite green.
- [ ] **Step 6: Commit** — `feat(control): frontend dispatcher + state mirror push`

---

### Task 4: Sidecar supervision (Rust)

**Files:**
- Create: `src-tauri/src/control/sidecar.rs`
- Modify: `src-tauri/src/lib.rs` (spawn after server start; kill on `RunEvent::Exit`), `src-tauri/tauri.conf.json` (`bundle.resources` maps `../voice-sidecar/dist/` → `voice-sidecar/`)

**Behavior:** resolve entry as `$COCKPIT_VOICE_SIDECAR` (dev override) else `<resource_dir>/voice-sidecar/index.js`; if the file is missing or `node` isn't on PATH, emit `voice:status {state:"error", detail}` and stop (cockpit unaffected). Spawn `node <entry>` with env `COCKPIT_CONTROL_PORT`, `COCKPIT_CONTROL_TOKEN`, and **`ANTHROPIC_API_KEY` removed** from the inherited env (the Agent SDK must resolve the Claude Code plan login, not a metered key); on exit, respawn with backoff 1s→2s→4s→…→30s cap; give up after 5 consecutive crashes within 60s (error status). Kill child on app exit.

- [ ] **Step 1: Failing tests for the pure pieces** — `backoff_delay(attempt) -> Duration` (1,2,4,…,30 cap) and `should_give_up(crash_times: &[Instant], now) -> bool` (5 within 60s). 
- [ ] **Step 2: RED → implement → GREEN.** Supervision loop itself is thin glue around these (spawn via `std::process::Command`, monitor thread) — no test, verified in Task 10 smoke.
- [ ] **Step 3: Full `cargo test` green; commit** — `feat(control): voice sidecar supervision with backoff`

---

### Task 5: PTT global shortcut (Rust)

**Files:**
- Modify: `src-tauri/Cargo.toml` (`cargo add tauri-plugin-global-shortcut`), `src-tauri/src/lib.rs`, `src-tauri/capabilities/*.json` (permission `global-shortcut:allow-register` if the default capability file gates plugins), `src-tauri/src/control/mod.rs` (config loader)

**Behavior:** read `~/.claude-cockpit/voice.json` (serde, all fields optional):

```jsonc
{ "hotkey": "CmdOrCtrl+Shift+Space", "model": "sonnet", "whisperModel": "small.en" }
```

Register the hotkey with `tauri_plugin_global_shortcut::Builder::new().with_handler(...)`; on `ShortcutState::Pressed` → `app.emit("voice:ptt", "down")` **and** `broadcast({"event":"ptt","state":"down"})`; `Released` → same with `"up"`. Registration failure (hotkey taken) ⇒ `voice:status` error, not a crash.

- [ ] **Step 1: Failing test** for `VoiceConfig::load_from(json: &str)` defaults + overrides (pure). RED → implement → GREEN.
- [ ] **Step 2: Wire plugin + handler in `lib.rs`; `cargo test` + `cargo check` green.**
- [ ] **Step 3: Commit** — `feat(voice): push-to-talk global hotkey + voice config`

---

### Task 6: WAV encoder (frontend, pure)

**Files:**
- Create: `src/lib/wavEncode.ts`, `src/lib/wavEncode.test.ts`

**Interfaces:** `encodeWav16kMono(chunks: Float32Array[], sampleRate: number): ArrayBuffer` — concatenates chunks, converts Float32 [-1,1] → PCM16 with clamping, prepends a 44-byte RIFF/WAVE header for mono 16-bit at `sampleRate`.

- [ ] **Step 1: Failing tests** — header bytes (`"RIFF"`, `"WAVE"`, `"fmt "`, `"data"` markers; channel count 1; sample rate field; bits 16; data length = samples×2); sample conversion (`0 → 0`, `1 → 32767`, `-1 → -32768`, `2 → clamped 32767`); multi-chunk concatenation. Use `DataView` assertions.
- [ ] **Step 2: RED → implement → GREEN → commit** — `feat(voice): PCM16 WAV encoder`

---

### Task 7: Mic capture hook + StatusBar indicator (frontend)

**Files:**
- Create: `src/hooks/useVoiceCapture.ts`, `src/lib/voiceIndicator.ts`, `src/lib/voiceIndicator.test.ts`
- Modify: `src/App.tsx` (mount capture hook), `src/components/layout/StatusBar.tsx` (indicator), `src/lib/ipc.ts` (`voiceUtterance(wavBase64)` → invoke `voice_utterance`), `src-tauri/src/control/server.rs` + `lib.rs` (add `voice_utterance` command: wrap as `{"event":"utterance","wav_base64":…}` and broadcast), `src-tauri/tauri.conf.json` or `Info.plist` config (`NSMicrophoneUsageDescription`)

**`useVoiceCapture`:** listens to `voice:ptt`. On `"down"`: `getUserMedia({audio: {channelCount: 1}})`, `new AudioContext({sampleRate: 16000})`, AudioWorklet from an inline Blob module that posts Float32 frames; accumulate. On `"up"`: stop tracks/context, `encodeWav16kMono`, base64, `voiceUtterance(...)`. Errors (mic denied) → local `voice:status`-equivalent state via a callback so the indicator shows error. Guard: a `"up"` with no active capture is a no-op.

**Indicator:** `voiceIndicator(state)` pure map → `{colorClass, label}` (idle: muted; listening: red pulse; transcribing/thinking: amber; speaking: cyan; error: red outline). StatusBar renders a mic glyph with `title={label + (detail ? `: ${detail}` : "")}`, driven by a `useVoiceStatus` listener on `voice:status`.

- [ ] **Step 1: Failing tests** — `voiceIndicator` mapping (all six states); `useVoiceCapture` with mocked `voice:ptt` listener + mocked `getUserMedia`/AudioContext (class stubs): down→up produces one `voiceUtterance` call whose payload decodes to a WAV header; up-without-down is a no-op.
- [ ] **Step 2: RED → implement → GREEN (`npm test`, `tsc`); `cargo test` for the new command.**
- [ ] **Step 3: Commit** — `feat(voice): PTT mic capture and status indicator`

---

### Task 8: Sidecar scaffold — package, channel client, config

**Files:**
- Create: `voice-sidecar/package.json`, `voice-sidecar/tsconfig.json`, `voice-sidecar/vitest.config.ts`, `voice-sidecar/src/channel.ts`, `voice-sidecar/src/channel.test.ts`, `voice-sidecar/src/config.ts`, `voice-sidecar/src/config.test.ts`
- `package.json`: deps `@anthropic-ai/claude-agent-sdk`, `ws`, `zod`; dev `typescript`, `vitest`, `esbuild`, `@types/ws`, `@types/node`; scripts `build: esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=dist/index.js --external:@anthropic-ai/claude-agent-sdk` (the SDK drives the `claude` binary and must not be inlined — ship `node_modules` for it alongside, or run unbundled with `node --enable-source-maps`; pick whichever the build step verifies works, and record the choice), `test: vitest run`, `typecheck: tsc --noEmit`.

**Interfaces (Tasks 9–11 consume):**

```typescript
// channel.ts
export interface Channel {
  request<T>(method: string, params?: unknown): Promise<T>;   // rejects on ok:false or 10s timeout
  sendStatus(state: VoiceState, detail?: string): void;        // {"event":"voice_status",...}
  onEvent(handler: (frame: Record<string, unknown>) => void): void; // ptt/utterance/state events
  connect(): Promise<void>;  // ws://127.0.0.1:$COCKPIT_CONTROL_PORT, first frame = auth token, auto-reconnect w/ backoff
}
export function createChannel(port: number, token: string): Channel;
// config.ts
export interface VoiceConfig { model: string; whisperModel: string; }
export function loadConfig(path?: string): VoiceConfig; // ~/.claude-cockpit/voice.json, defaults as in Task 5
```

- [ ] **Step 1: Failing tests** — `channel.test.ts` against an in-process `ws` `WebSocketServer`: sends auth first; `request` resolves on `{id, ok:true}` and rejects on `ok:false`; concurrent requests correlate by id; `config.test.ts`: defaults when file missing, overrides merge.
- [ ] **Step 2: RED → implement → GREEN** (`cd voice-sidecar && npm test && npm run typecheck`).
- [ ] **Step 3: Commit** — `feat(voice-sidecar): scaffold, control-channel client, config`

---

### Task 9: Transcription — whisper-cli wrapper + model download

**Files:**
- Create: `voice-sidecar/src/transcribe.ts`, `voice-sidecar/src/transcribe.test.ts`

**Interfaces:**

```typescript
export function whisperArgs(modelPath: string, wavPath: string): string[];
// ["-m", modelPath, "-f", wavPath, "--no-prints", "--no-timestamps"]
export function modelUrl(name: string): string;
// https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<name>.bin
export function modelPath(name: string): string;   // ~/.claude-cockpit/voice/models/ggml-<name>.bin
export async function ensureModel(name: string, onProgress: (pct: number) => void): Promise<string>;
export async function transcribe(wav: Buffer, cfg: VoiceConfig): Promise<string>; // temp file → spawn whisper-cli → trimmed stdout
```

- [ ] **Step 0: Verify the CLI contract before coding** — run `whisper-cli --help 2>&1 | grep -E "no-prints|no-timestamps|output"`. If the flags differ from `--no-prints`/`--no-timestamps`, use what `--help` shows and adjust `whisperArgs` + its test to match reality. Record the confirmed flags in a comment.
- [ ] **Step 1: Failing tests** — `whisperArgs` exact vector; `modelUrl`/`modelPath` strings; `transcribe` with the spawn injected (pass a `spawnFn` param defaulting to `child_process.spawn`) — fake emits stdout `" open the mythology project \n"` → resolves `"open the mythology project"`; nonzero exit rejects with stderr text.
- [ ] **Step 2: RED → implement → GREEN. One real-audio integration check (manual, not CI):** generate a spoken sample with `say -o /tmp/t.aiff "hello world" && ffmpeg -y -i /tmp/t.aiff -ar 16000 -ac 1 /tmp/t.wav` and confirm `transcribe` returns text containing "hello" (skip-if-no-model guard).
- [ ] **Step 3: Commit** — `feat(voice-sidecar): whisper transcription + model management`

---

### Task 10: Agent SDK session + TTS + main loop

**Files:**
- Create: `voice-sidecar/src/agent.ts`, `voice-sidecar/src/agent.test.ts`, `voice-sidecar/src/speak.ts`, `voice-sidecar/src/index.ts`

**Agent (`agent.ts`)** — a headless Claude Code session on the user's plan.
Each utterance is one `query()`; continuity comes from `resume`-chaining the
session id, so the whole voice conversation is a single real session on disk
(visible in cockpit's sidebar like any other). `tools: []` strips every
built-in — the model sees only the cockpit MCP tools.

> Before coding, verify the option names used below (`systemPrompt`, `tools`,
> `mcpServers`, `allowedTools`, `resume`, `model`) against the TypeScript
> reference at `code.claude.com/docs/en/agent-sdk/typescript` — adjust to
> what the installed SDK version exports, and record any differences.

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

export function buildServer(channel: Channel) {
  return createSdkMcpServer({
    name: "cockpit",
    version: "1.0.0",
    tools: [
      tool(
        "get_state",
        "Current cockpit state: workspaces, terminals (with focus + status), projects. Call this first whenever the user references anything by name.",
        {},
        async () => text(await channel.request("get_state")),
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        "write_to_pane",
        "Type text into a terminal. Use for dictation. Set submit=true ONLY when the user explicitly said to send/submit/run it — otherwise the text is left for review.",
        {
          paneId: z.string().optional().describe("Terminal id from get_state; omit for the focused terminal"),
          text: z.string(),
          submit: z.boolean().default(false),
        },
        async (args) => text(await channel.request("write_to_pane", args))
      ),
      tool(
        "spawn_terminal",
        "Open a new terminal, optionally for a named project / provider / workspace.",
        { projectName: z.string().optional(), provider: z.string().optional(), workspaceName: z.string().optional() },
        async (args) => text(await channel.request("spawn_terminal", args))
      ),
      tool(
        "switch_workspace",
        "Switch to a workspace by its exact name (resolve via get_state first).",
        { name: z.string() },
        async (args) => text(await channel.request("switch_workspace", args))
      ),
      tool(
        "focus_pane",
        "Focus a terminal by its exact label (resolve via get_state first).",
        { label: z.string() },
        async (args) => text(await channel.request("focus_pane", args))
      ),
      tool(
        "close_pane",
        "Close a terminal. Only call when the user named a specific terminal explicitly — never guess a target.",
        { label: z.string() },
        async (args) => text(await channel.request("close_pane", args))
      ),
    ],
  });
}

const SYSTEM = `You are the voice controller for Claude Cockpit, a terminal manager.
Your final text is spoken aloud by TTS: keep it to one short sentence, no markdown, no lists.
Dictation: when the user is telling a terminal's Claude something, use write_to_pane with their words; set submit only on an explicit "send it" / "submit" / "run it".
Never close anything the user did not explicitly name. If a name is ambiguous, ask (briefly) instead of guessing.`;

export async function handleUtterance(
  cfg: VoiceConfig, channel: Channel,
  sessionId: string | null, transcript: string,
): Promise<{ spoken: string; sessionId: string | null }> {
  let spoken = "";
  let sid = sessionId;
  for await (const message of query({
    prompt: transcript,
    options: {
      model: cfg.model,
      systemPrompt: SYSTEM,
      tools: [],                                   // no built-ins: cockpit tools only
      mcpServers: { cockpit: buildServer(channel) },
      allowedTools: ["mcp__cockpit__*"],
      ...(sessionId ? { resume: sessionId } : {}),
    },
  })) {
    if (message.type === "system" && message.subtype === "init") sid = message.session_id;
    if (message.type === "result") {
      sid = message.session_id ?? sid;
      if (message.subtype === "success") spoken = message.result.trim();
    }
  }
  return { spoken, sessionId: sid };
}
```

**Auth note:** the sidecar must inherit the user's login environment but the
supervisor (Task 4) strips `ANTHROPIC_API_KEY` from the child env so the
Agent SDK resolves the Claude Code plan credentials — voice turns bill to
the plan, not to a metered key.

**TTS (`speak.ts`):** `speak(text, spawnFn = spawn)` — kill any previous `say` child, spawn `/usr/bin/say` with `[text]`, resolve on exit. Empty text ⇒ no-op.

**Main (`index.ts`):** read env port/token → `createChannel.connect()` → `sendStatus("idle")` → `ensureModel` (progress → `sendStatus("idle", "downloading model 42%")`) → on `{"event":"ptt","state":"down"}` → `sendStatus("listening")`; on `{"event":"utterance"}` → `transcribing` → `transcribe` → `thinking` → `handleUtterance` (threading the held `sessionId`; store the returned one) → `speaking` → `speak` → `idle`. Any thrown error → `sendStatus("error", msg)` then back to `idle` on next PTT. The Agent SDK resolves the Claude Code plan login on its own — no client construction, no API key.

- [ ] **Step 1: Failing tests (`agent.test.ts`)** — mock `@anthropic-ai/claude-agent-sdk` at the module boundary: the mocked `tool()` records `(name, description, schema, handler)` so tests can invoke handlers directly; the mocked `query()` is a controllable async generator:
  - `buildServer`'s `write_to_pane` handler, invoked with `{text: "hi"}` after Zod-parsing through the recorded schema, sends `{text: "hi", submit: false}` to the channel (dictation guard default).
  - `close_pane` handler passes the exact label through; `get_state` carries `readOnlyHint`.
  - `handleUtterance` passes `resume` only when a session id is held, captures the id from the init/result messages, and returns the success `result` as `spoken`.
  - `speak("")` never spawns; `speak("hi", fake)` spawns `/usr/bin/say` with `["hi"]` and kills a still-running previous child first.
- [ ] **Step 2: RED → implement → GREEN** (`cd voice-sidecar && npm test && npm run typecheck && npm run build`).
- [ ] **Step 3: Commit** — `feat(voice-sidecar): tool-runner agent, TTS, main loop`

---

### Task 11: Full verification + build

- [ ] **Step 1:** `npx tsc --noEmit && npm test` (root), `cd src-tauri && cargo test --quiet`, `cd voice-sidecar && npm run typecheck && npm test && npm run build` — all green.
- [ ] **Step 2:** `npm run tauri build` (do **not** launch — the user runs cockpit live). Confirm the bundle contains `Resources/voice-sidecar/index.js`.
- [ ] **Step 3: Hand the user this smoke checklist:**
  1. Relaunch cockpit → mic indicator appears in the StatusBar (idle). First run: tooltip shows model download progress, then idle.
  2. Hold the hotkey (default Cmd+Shift+Space), say "which terminals are running?", release → indicator walks listening → transcribing → thinking → speaking; a one-sentence spoken summary plays.
  3. "Open a terminal in <project name>" → terminal spawns in that project.
  4. Focus a terminal, dictate "explain this repo" → text appears in the terminal input **without** submitting; say "send it" → it submits.
  5. "Close the <label> terminal" closes exactly that pane; "close the terminal" (no name) gets a spoken clarification, closes nothing.
  6. Quit cockpit → `pgrep -f voice-sidecar` and `pgrep whisper-cli` are empty (no orphans).
  7. `lsof -iTCP -sTCP:LISTEN -P | grep node` / same for cockpit → the control port is bound to 127.0.0.1 only.
- [ ] **Step 4:** Mark this plan done in place (one line, date + commit SHA) per repo convention.

---

## Self-Review (completed at plan-writing time)

- **Spec coverage:** control channel + token auth + loopback (Tasks 1–2); state mirror (2–3); command surface incl. write/spawn/switch/focus/close + dictation guard (2, 3, 10); PTT hotkey (5); webview mic capture (6–7); whisper STT + model download w/ progress (9); Agent SDK session on plan auth + config model (4, 10); TTS via `say` behind `speak` (10); StatusBar indicator incl. error states for dead sidecar/failed hotkey (4, 5, 7); supervision + clean shutdown (4, 11). Out of scope per spec: wake word, phone client, barge-in, conversational session analysis.
- **Sequencing:** server (2) precedes bridge (3) and sidecar tasks; capture (7) depends on encoder (6) and PTT (5); sidecar main (10) consumes 8–9.
- **Type consistency:** `Channel`/`VoiceConfig` shapes match across Tasks 8–10; wire frames match Tasks 1–2; `StateSnapshot` defined once and referenced by 2, 3, 10.
- **Verified environment facts:** `whisper-cli` installed (Homebrew 1.8.6); `@tauri-apps/plugin-global-shortcut` 2.3.2 exists; no `sox` (why capture is webview-side); `ffmpeg` present (used only in Task 9's manual audio check).
