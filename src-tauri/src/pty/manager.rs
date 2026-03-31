use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

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

        // Inherit common env vars
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", &home);
        }
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", &path);
        }
        if let Ok(user) = std::env::var("USER") {
            cmd.env("USER", &user);
        }
        if let Ok(lang) = std::env::var("LANG") {
            cmd.env("LANG", &lang);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| crate::error::CockpitError::Pty(e.to_string()))?;

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
