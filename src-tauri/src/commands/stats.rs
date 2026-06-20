use crate::stats::aggregator::{self, PlayerStats};

/// Lifetime player stats aggregated from every Claude transcript. Run on a
/// blocking thread because the first call may fold many large files; a failed
/// join degrades to empty stats rather than erroring the UI.
#[tauri::command]
pub async fn get_player_stats() -> PlayerStats {
    tauri::async_runtime::spawn_blocking(aggregator::get_player_stats)
        .await
        .unwrap_or_default()
}
