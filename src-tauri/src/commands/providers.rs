use crate::providers::{load, ProviderSummary};

/// The provider profiles a terminal can spawn with, reduced to what the
/// frontend may see (id, label, context window) — env values can hold
/// secrets and stay in the backend.
#[tauri::command]
pub fn list_providers() -> Vec<ProviderSummary> {
    load().iter().map(ProviderSummary::from).collect()
}
