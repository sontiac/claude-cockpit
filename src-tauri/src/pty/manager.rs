use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// The user's real `PATH`, as seen by their interactive login shell.
///
/// When cockpit is launched from Finder/Spotlight/Dock, macOS gives the process
/// a minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) that omits wherever tools
/// like `claude` actually live (npm-global, Homebrew, `~/.local/bin`, nvm, …).
/// Every terminal we spawn would then fail to find `claude`. We resolve the real
/// PATH once by asking the login+interactive shell for it, and inject it into
/// every child. Cached because it spawns a shell (which may source slow rc files).
fn login_shell_path() -> Option<String> {
    static PATH: OnceLock<Option<String>> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        // -i (interactive) + -l (login) so both .zshrc and .zprofile-style PATH
        // edits are applied, matching what the user sees in a real terminal.
        std::process::Command::new(&shell)
            .args(["-ilc", "printf %s \"$PATH\""])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })
    .clone()
}

/// Normalize a macOS `AppleLocale` identifier (e.g. "en_US", "en-US",
/// "es_UY@currency=UYU") into a locale-database name like "en_US.UTF-8".
///
/// Returns `None` for identifiers that could not name a locale-database
/// entry; the result is joined onto `/usr/share/locale`, so anything outside
/// `[A-Za-z0-9_]` is rejected rather than sanitized.
fn utf8_locale_candidate(apple_locale: &str) -> Option<String> {
    let base = apple_locale
        .trim()
        .split('@')
        .next()
        .unwrap_or("")
        .replace('-', "_");
    if base.is_empty() || !base.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    Some(format!("{base}.UTF-8"))
}

/// The `LANG` value a real terminal would hand its children, or `None` if the
/// user's locale has no UTF-8 entry in the system locale database.
///
/// GUI apps launched from Finder/Dock get no locale variables at all, so PTY
/// children inherit a C locale in which tools treat text as MacRoman instead
/// of UTF-8 — most visibly `pbcopy` (Claude Code's copy-to-clipboard), which
/// double-encodes every non-ASCII character ("–" pastes as "‚Äì"). Real
/// terminals fix this by deriving `LANG` from the user's macOS locale
/// preference; we do the same. Cached because it spawns `defaults`.
fn user_utf8_lang() -> Option<String> {
    static LANG: OnceLock<Option<String>> = OnceLock::new();
    LANG.get_or_init(|| {
        let apple_locale = std::process::Command::new("defaults")
            .args(["read", "-g", "AppleLocale"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())?;
        utf8_locale_candidate(&apple_locale)
            .filter(|c| std::path::Path::new("/usr/share/locale").join(c).is_dir())
    })
    .clone()
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Running,
    Idle,
    Responding,
    Exited,
}

#[derive(Clone, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub label: String,
    pub color: String,
    pub status: TerminalStatus,
    pub cwd: String,
    pub command: String,
    pub project_id: Option<String>,
}

pub struct PtyHandle {
    pub info: TerminalInfo,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

impl Drop for PtyHandle {
    fn drop(&mut self) {
        // Closing the PTY only sends the child a hangup, which Claude ignores —
        // so without an explicit kill the child process leaks and multiple
        // instances end up resuming the same session (which then refuses to
        // persist). Killing here ensures `pty_kill` and app shutdown actually
        // terminate the child.
        let _ = self.killer.kill();
    }
}

impl PtyHandle {
    pub fn spawn(
        app: AppHandle,
        id: String,
        cwd: String,
        command: Option<String>,
        label: String,
        color: String,
        project_id: Option<String>,
    ) -> Result<Self, crate::error::CockpitError> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| crate::error::CockpitError::Pty(e.to_string()))?;

        let cmd_str = command.clone().unwrap_or_else(|| {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        });

        let mut cmd = CommandBuilder::new(&cmd_str);

        // If command has args (e.g. "claude --dangerously-skip-permissions")
        if let Some(ref full_cmd) = command {
            let parts: Vec<&str> = full_cmd.split_whitespace().collect();
            if parts.len() > 1 {
                cmd = CommandBuilder::new(parts[0]);
                for arg in &parts[1..] {
                    cmd.arg(arg);
                }
            }
        }

        cmd.cwd(&cwd);

        // Inherit the full parent environment. portable-pty's CommandBuilder
        // does an env_clear() before spawning and passes only the vars set here,
        // so without this the child runs with a near-empty environment — which
        // silently breaks tools that depend on it. A terminal emulator must hand
        // the child the same environment a normal shell would.
        //
        // Exception: Claude Code's own session markers. If cockpit was itself
        // launched from within a Claude Code session, these leak in and tell the
        // Claude instances cockpit spawns that they are *nested child sessions*
        // (CLAUDE_CODE_CHILD_SESSION=1), so they don't persist their own
        // conversation. Cockpit spawns fresh top-level sessions, so strip them —
        // a normal terminal launch wouldn't carry them either.
        for (key, value) in std::env::vars() {
            if key == "CLAUDECODE"
                || key == "CLAUDE_EFFORT"
                || key.starts_with("CLAUDE_CODE_")
            {
                continue;
            }
            cmd.env(key, value);
        }
        // Replace the (possibly minimal, GUI-launch) PATH with the user's real
        // login-shell PATH so tools like `claude` are found regardless of how
        // cockpit itself was launched.
        if let Some(path) = login_shell_path() {
            cmd.env("PATH", path);
        }

        // GUI-launched cockpit carries no locale variables, so children would
        // run in the C locale and treat text as MacRoman (e.g. `pbcopy`
        // mangles every non-ASCII copy). Hand children a UTF-8 locale the way
        // real terminals do — unless the environment already provides one.
        let has_locale = ["LC_ALL", "LC_CTYPE", "LANG"]
            .iter()
            .any(|k| std::env::var(k).is_ok_and(|v| !v.is_empty()));
        if !has_locale {
            match user_utf8_lang() {
                Some(lang) => cmd.env("LANG", lang),
                // Locale absent from the system database: still guarantee
                // UTF-8 text handling, mirroring Terminal.app's fallback.
                None => cmd.env("LC_CTYPE", "UTF-8"),
            }
        }

        // Terminal-specific overrides applied on top of the inherited env.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| crate::error::CockpitError::Pty(e.to_string()))?;

        // Grab a killer handle before the child is moved into the wait thread,
        // so the PtyHandle can terminate the child on drop.
        let killer = child.clone_killer();

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| crate::error::CockpitError::Pty(e.to_string()))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| crate::error::CockpitError::Pty(e.to_string()))?;

        let master = Arc::new(Mutex::new(pair.master));
        let writer = Arc::new(Mutex::new(writer));

        let info = TerminalInfo {
            id: id.clone(),
            label,
            color,
            status: TerminalStatus::Running,
            cwd,
            command: cmd_str,
            project_id,
        };

        // Shared timestamp for idle detection across threads
        let last_output = Arc::new(Mutex::new(Instant::now()));

        // Reader thread: reads PTY output and emits to frontend
        let app_clone = app.clone();
        let term_id = id.clone();
        let last_output_reader = last_output.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut was_idle = false;

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — process exited
                        let _ = app_clone.emit(
                            &format!("terminal:status:{}", term_id),
                            serde_json::json!({ "status": "exited" }),
                        );
                        let _ = app_clone.emit(
                            &format!("terminal:exit:{}", term_id),
                            serde_json::json!({ "code": serde_json::Value::Null }),
                        );
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();

                        // Emit output to frontend
                        let _ = app_clone.emit(
                            &format!("terminal:output:{}", term_id),
                            serde_json::json!({ "data": data }),
                        );

                        // Status detection
                        let now = Instant::now();
                        if was_idle {
                            // Was idle, now receiving output -> responding
                            let _ = app_clone.emit(
                                &format!("terminal:status:{}", term_id),
                                serde_json::json!({ "status": "responding" }),
                            );
                            was_idle = false;
                        }

                        // Update shared last_output timestamp
                        if let Ok(mut lo) = last_output_reader.lock() {
                            *lo = now;
                        }

                        // Check for prompt character (idle detection)
                        let output_str = String::from_utf8_lossy(&data);
                        let has_prompt = output_str.contains('❯')
                            || output_str.contains("$ ")
                            || output_str.contains("% ");

                        if has_prompt {
                            let app_idle = app_clone.clone();
                            let id_idle = term_id.clone();
                            let lo_check = last_output_reader.clone();
                            let snapshot = now;
                            std::thread::spawn(move || {
                                std::thread::sleep(Duration::from_millis(500));
                                // Only emit idle if no new output arrived since snapshot
                                let still_idle = lo_check
                                    .lock()
                                    .map(|lo| *lo == snapshot)
                                    .unwrap_or(false);
                                if still_idle {
                                    let _ = app_idle.emit(
                                        &format!("terminal:status:{}", id_idle),
                                        serde_json::json!({ "status": "idle" }),
                                    );
                                }
                            });
                            was_idle = true;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Wait for child exit in background
        let app_exit = app.clone();
        let exit_id = id.clone();
        std::thread::spawn(move || {
            if let Ok(status) = child.wait() {
                let code = status.exit_code() as i32;
                let _ = app_exit.emit(
                    &format!("terminal:exit:{}", exit_id),
                    serde_json::json!({ "code": code }),
                );
            }
        });

        Ok(PtyHandle {
            info,
            master,
            writer,
            killer,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), crate::error::CockpitError> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|e| crate::error::CockpitError::Pty(e.to_string()))?;
        writer
            .write_all(data)
            .map_err(|e| crate::error::CockpitError::Io(e))?;
        writer.flush().map_err(|e| crate::error::CockpitError::Io(e))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), crate::error::CockpitError> {
        let master = self
            .master
            .lock()
            .map_err(|e| crate::error::CockpitError::Pty(e.to_string()))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| crate::error::CockpitError::Pty(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::utf8_locale_candidate;

    #[test]
    fn plain_apple_locale_maps_to_utf8_locale() {
        assert_eq!(
            utf8_locale_candidate("en_US"),
            Some("en_US.UTF-8".to_string())
        );
    }

    #[test]
    fn hyphenated_identifier_is_normalized_to_underscore() {
        assert_eq!(
            utf8_locale_candidate("en-US"),
            Some("en_US.UTF-8".to_string())
        );
    }

    #[test]
    fn keyword_modifiers_are_stripped() {
        assert_eq!(
            utf8_locale_candidate("es_UY@currency=UYU"),
            Some("es_UY.UTF-8".to_string())
        );
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        assert_eq!(
            utf8_locale_candidate("en_US\n"),
            Some("en_US.UTF-8".to_string())
        );
    }

    #[test]
    fn empty_identifier_yields_none() {
        assert_eq!(utf8_locale_candidate(""), None);
        assert_eq!(utf8_locale_candidate("  \n"), None);
    }

    #[test]
    fn identifiers_with_unexpected_characters_yield_none() {
        // The candidate is joined onto /usr/share/locale, so anything that
        // could escape that directory must be rejected outright.
        assert_eq!(utf8_locale_candidate("../../etc/passwd"), None);
        assert_eq!(utf8_locale_candidate("en US"), None);
    }
}
