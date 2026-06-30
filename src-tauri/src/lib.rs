pub mod background;
pub mod commands;
pub mod error;
pub mod project;
pub mod pty;
pub mod session;
pub mod state;
pub mod stats;
pub mod workspace;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Claude Code marks the processes it spawns with these env vars. If cockpit
    // was itself launched from within a Claude Code session, they're inherited
    // and then passed to the Claude instances cockpit spawns — making those run
    // as nested *child* sessions (CLAUDE_CODE_CHILD_SESSION=1) that never persist
    // their conversation to disk. Clearing them from our own environment up front
    // (before any PTY is spawned, while still single-threaded) guarantees every
    // terminal is a clean top-level session, regardless of how the child inherits
    // the environment. A normal launch wouldn't carry these either.
    let claude_session_vars: Vec<String> = std::env::vars()
        .map(|(k, _)| k)
        .filter(|k| k == "CLAUDECODE" || k == "CLAUDE_EFFORT" || k.starts_with("CLAUDE_CODE_"))
        .collect();
    for key in claude_session_vars {
        std::env::remove_var(key);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::terminal::get_terminals,
            commands::session::get_sessions,
            commands::session::get_session_context,
            commands::session::get_project_paths,
            commands::project::get_projects,
            commands::project::add_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::project::reorder_projects,
            commands::workspace::get_workspace,
            commands::workspace::save_workspace,
            commands::workspace::set_session_title,
            commands::stats::get_player_stats,
            commands::system::browse_directory,
            commands::system::get_home_dir,
            commands::background::list_backgrounds,
            commands::background::import_background,
            commands::background::delete_background,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
