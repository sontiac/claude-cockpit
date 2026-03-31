use crate::error::CockpitError;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
pub struct BrowseResult {
    current_path: String,
    parent_path: Option<String>,
    directories: Vec<DirEntry>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "__pycache__",
    "venv",
    ".venv",
    "target",
    "dist",
    "build",
    ".git",
];

fn resolve_path(path: &str) -> PathBuf {
    if path.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[1..].trim_start_matches('/'));
        }
    }
    PathBuf::from(path)
}

#[tauri::command]
pub fn browse_directory(path: String) -> Result<BrowseResult, CockpitError> {
    let resolved = resolve_path(&path);
    let resolved = resolved.canonicalize().unwrap_or(resolved);

    if !resolved.exists() {
        return Err(CockpitError::Pty("Directory not found".to_string()));
    }
    if !resolved.is_dir() {
        return Err(CockpitError::Pty("Path is not a directory".to_string()));
    }

    let current_path = resolved.to_string_lossy().to_string();

    // Parent path (None if at root)
    let parent_path = resolved.parent().map(|p| {
        let parent_str = p.to_string_lossy().to_string();
        if parent_str == current_path {
            // At root
            None
        } else {
            Some(parent_str)
        }
    }).flatten();

    let mut directories = Vec::new();

    for entry in fs::read_dir(&resolved)? {
        let entry = entry?;
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if !metadata.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden dirs
        if name.starts_with('.') {
            continue;
        }

        // Skip common non-project directories
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        directories.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: true,
        });
    }

    directories.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(BrowseResult {
        current_path,
        parent_path,
        directories,
    })
}

#[tauri::command]
pub fn get_home_dir() -> Result<String, CockpitError> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| CockpitError::Pty("Could not determine home directory".to_string()))
}
