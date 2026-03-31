pub mod commands;
pub mod error;
pub mod project;
pub mod pty;
pub mod session;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::terminal::get_terminals,
            commands::session::get_sessions,
            commands::session::get_project_paths,
            commands::project::get_projects,
            commands::project::add_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::system::browse_directory,
            commands::system::get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
