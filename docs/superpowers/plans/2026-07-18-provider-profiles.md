# Provider Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-terminal provider profiles so a cockpit terminal can run Claude Code against Kimi (Moonshot) or other Anthropic-compatible APIs, selected at spawn.

**Architecture:** Profiles (id, label, env map with `${SECRET}` refs, optional contextWindow) live in the Rust backend — built-ins `claude` + `kimi`, overridable via `~/.claude-cockpit/providers.json`. Secrets resolve at spawn from the process env then `~/.config/sontiac/.env`; the frontend only ever sees `{id, label, contextWindow}`. `pty_spawn` takes a provider id; terminals persist it; the new-terminal button gets a provider dropdown; the header shows a chip for non-default providers; `formatModelShort` and the context badge learn Kimi.

**Tech Stack:** Rust (Tauri 2), TypeScript/React, vitest, cargo test.

## Global Constraints

- Frontend must never receive resolved env values or secrets — only `{id, label, contextWindow}` (spec §1).
- Persist the profile **id**, never resolved env (spec §2).
- Missing secret / unknown provider id → spawn fails with a clear error; no silent fallback (spec §1).
- Malformed `providers.json` → log and use built-ins; never crash (spec §1).
- Persisted provider id that no longer exists → restore as `claude`, log a warning (spec §2).
- Kimi built-in: `ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic`, `ANTHROPIC_AUTH_TOKEN=${MOONSHOT_API_KEY}`, model slots (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`) = `kimi-k3`, `contextWindow: 1048576`. Verify `kimi-k3` works via the Anthropic endpoint with the real key at the end; if not, flip the model values to `kimi-k2.7-code` in the built-in (single constant).
- Follow existing patterns: `CockpitError`, `base_dir()`-style config paths, existing test styles.

---

### Task 1: Rust provider module (pure logic + tests)

**Files:**
- Create: `src-tauri/src/providers.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod providers;` — same place other modules are declared)

**Interfaces:**
- Produces: `Provider { id: String, label: String, env: Vec<(String, String)>, context_window: Option<u64> }` (serde Serialize/Deserialize; env as ordered pairs), `pub fn built_ins() -> Vec<Provider>`, `pub fn merge(built: Vec<Provider>, user: Vec<Provider>) -> Vec<Provider>`, `pub fn resolve_env(env: &[(String, String)], lookup: impl Fn(&str) -> Option<String>) -> Result<Vec<(String, String)>, CockpitError>`, `pub fn load() -> Vec<Provider>` (built-ins merged with `~/.claude-cockpit/providers.json` if present/valid), `pub fn secret_lookup(name: &str) -> Option<String>` (process env, then `~/.config/sontiac/.env` parsed as `KEY=value` lines, `#` comments and `export ` prefixes tolerated).

- [ ] **Step 1: Write failing tests** in `providers.rs` `#[cfg(test)]`:

```rust
#[test]
fn built_ins_contain_claude_default_and_kimi() {
    let ps = built_ins();
    assert_eq!(ps[0].id, "claude");
    assert!(ps[0].env.is_empty());
    let kimi = ps.iter().find(|p| p.id == "kimi").unwrap();
    assert!(kimi.env.iter().any(|(k, v)| k == "ANTHROPIC_BASE_URL" && v == "https://api.moonshot.ai/anthropic"));
    assert!(kimi.env.iter().any(|(k, v)| k == "ANTHROPIC_AUTH_TOKEN" && v == "${MOONSHOT_API_KEY}"));
    assert_eq!(kimi.context_window, Some(1_048_576));
}

#[test]
fn merge_replaces_same_id_and_appends_new() { /* user redefines kimi (label "K"), adds "glm"; result keeps order, kimi replaced, glm appended */ }

#[test]
fn resolve_env_substitutes_secret_refs() { /* env [("A","${X}"),("B","plain")], lookup X->"v" => [("A","v"),("B","plain")] */ }

#[test]
fn resolve_env_missing_secret_names_variable() { /* lookup -> None => Err whose Display contains "MOONSHOT_API_KEY" */ }

#[test]
fn parse_secrets_file_handles_comments_export_and_quotes() { /* "# c\nexport K=v\nQ=\"x\"\n" => K=v, Q=x */ }
```

- [ ] **Step 2:** `cargo test providers` → FAIL (module/functions missing).
- [ ] **Step 3:** Implement `providers.rs`: structs + fns above. `${NAME}` matching via simple scan (`v.starts_with("${") && v.ends_with('}')` is NOT enough — support refs embedded in longer strings using a small replace loop over `${...}` occurrences). `load()` reads `dirs::home_dir().join(".claude-cockpit/providers.json")`; parse `Vec<Provider>`; on error `log::warn!` (or `eprintln!` matching repo style) and return built-ins.
- [ ] **Step 4:** `cargo test providers` → PASS.
- [ ] **Step 5:** Commit `feat(providers): provider profile model, merge, secret resolution`.

### Task 2: Spawn integration + list_providers IPC

**Files:**
- Modify: `src-tauri/src/pty/manager.rs` (`PtyHandle::spawn` gains `extra_env: Vec<(String, String)>`, applied after inherited env + locale, before `TERM`/`COLORTERM` overrides)
- Modify: `src-tauri/src/commands/terminal.rs` (`pty_spawn` gains `provider: Option<String>`; resolves profile → env via `providers::load()` + `resolve_env(..., secret_lookup)`; unknown id → `CockpitError::InvalidInput("unknown provider: ...")`)
- Create: `src-tauri/src/commands/providers.rs` (`list_providers` command returning `Vec<ProviderSummary { id, label, context_window }>`)
- Modify: `src-tauri/src/lib.rs` (register `list_providers`)

**Interfaces:**
- Consumes: Task 1's `providers::{load, resolve_env, secret_lookup}`.
- Produces: `pty_spawn(..., provider: Option<String>)`; `list_providers() -> Vec<ProviderSummary>`; `TerminalInfo` gains `provider: Option<String>` (serialized to frontend).

- [ ] Steps: failing test for env-application order isn't unit-testable through a real PTY — instead add a pure helper `fn spawn_env(profile_env: &[(String,String)]) -> ...` ONLY if extraction is natural; otherwise cover via Task 1 units + manual step in Task 7. Test `ProviderSummary` serialization shape (`context_window` camelCased to match frontend expectations — follow existing serde conventions in the repo). Implement, `cargo test`, commit `feat(providers): provider-aware spawn and list_providers IPC`.

### Task 3: Persistence of provider id

**Files:**
- Modify: `src-tauri/src/workspace/store.rs` (`PersistedTerminal` gains `#[serde(default)] pub provider: Option<String>`)
- Modify: `src/types/terminal.ts` (`PersistedTerminal.provider: string | null`; `BackendTerminalInfo.provider: string | null`)
- Modify: `src/hooks/useTerminals.ts` (persist mapping includes `provider: t.provider`; restore path passes `provider` to spawn; unknown-id fallback happens in Rust at spawn? NO — spec says restore falls back to claude: frontend passes persisted id, Rust `pty_spawn` returns InvalidInput for unknown ids, so restore must pre-validate: fetch `listProviders()` once during restore, map missing ids → `undefined` + `console.warn`)

**Interfaces:**
- Consumes: `listProviders()` from Task 4 (order tasks 3⇄4 pragmatically in one branch; commit together if needed).
- Produces: round-tripped `provider` on persisted terminals.

- [ ] Steps: extend existing store round-trip test (Rust) with a provider value + missing-field default; TS: extend `usePanes.test.ts`-style persistence test if one covers terminals. Implement, test, commit `feat(providers): persist per-terminal provider id`.

### Task 4: Frontend IPC + spawn threading

**Files:**
- Modify: `src/lib/ipc.ts`:

```ts
export interface ProviderSummary { id: string; label: string; contextWindow: number | null; }
export const listProviders = () => invoke<ProviderSummary[]>("list_providers");
// ptySpawn params gain provider?: string, passed as provider: params.provider ?? null
```

- Modify: `src/hooks/useTerminals.ts` (spawn `options.provider` threaded to `ptySpawn`; resume flow keeps provider of the restored terminal)

- [ ] Steps: type-check-driven (tsc), extend spawn hook test if present, commit `feat(providers): frontend provider plumbing`.

### Task 5: UI — provider picker + header chip

**Files:**
- Modify: `src/components/terminal/TerminalGrid.tsx` (both "New Terminal" affordances: keep single-click default; add a dropdown — reuse the existing popover/menu pattern used by the move-to-workspace menu — listing `listProviders()` labels; selecting spawns with that provider id)
- Modify: `src/components/terminal/TerminalCell.tsx` (when `terminal.provider` set and ≠ `"claude"`, render chip before ContextPill: small rounded label with the provider's `label` from a cached `listProviders()` result — add `src/hooks/useProviders.ts` with a module-level cache so N cells don't refetch)
- Create: `src/hooks/useProviders.ts`
- Test: extend `TerminalCell` / grid tests following existing component-test style

- [ ] Steps: failing component test (chip renders for kimi, absent for claude/null), implement, test, commit `feat(providers): provider picker and header chip`.

### Task 6: Readouts — model names + context badge scaling

**Files:**
- Modify: `src/lib/constants.ts`:

```ts
// formatModelShort: before the claude regex, add
const kimi = id.match(/^kimi-k(\d+(?:\.\d+)?)(?:-\w+)*$/);
if (kimi) return `Kimi K${kimi[1]}`;
// contextTier(tokens, contextWindow?: number | null): scale each tier max by
// (contextWindow / 1_048_576) when contextWindow provided; else unchanged.
```

- Modify: `src/components/terminal/ContextPill.tsx` (accept `contextWindow?: number | null`, pass to `contextTier`)
- Modify: `src/components/terminal/TerminalCell.tsx` (pass the provider's contextWindow from useProviders)
- Test: `constants` unit tests: `formatModelShort("kimi-k3") === "Kimi K3"`, `("kimi-k2.7-code") === "Kimi K2.7"`, claude ids unchanged; `contextTier(200_000, 262_144)` lands in a hotter tier than `contextTier(200_000)`.

- [ ] Steps: failing tests, implement, test, commit `feat(providers): Kimi model names and scaled context tiers`.

### Task 7: End-to-end verification + build

- [ ] `cargo test`, `npx tsc --noEmit`, `npx vitest run` — all green.
- [ ] Check `~/.config/sontiac/.env` for `MOONSHOT_API_KEY` (presence only — never print). If present: verify the Kimi profile end-to-end with a minimal curl to `https://api.moonshot.ai/anthropic/v1/messages` using model `kimi-k3` (1-token request); on model-not-found, flip built-in model values to `kimi-k2.7-code` and note it. If absent: leave `kimi-k3`, tell the user to add the key.
- [ ] Commit any adjustment, push, `cargo tauri build`.
- [ ] Report honestly what was and wasn't verified live.
