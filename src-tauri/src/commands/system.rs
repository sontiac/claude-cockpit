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

/// Cap for read_text_file: markdown plans are small; anything bigger than this
/// is not something we should ship to the webview in one string.
const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct TextFile {
    pub content: String,
    pub mtime_ms: u64,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Modification time of a file in ms since epoch. The markdown viewer polls
/// this cheaply and only re-reads the file when it changes.
#[tauri::command]
pub fn stat_file(path: String) -> Result<u64, CockpitError> {
    let meta = fs::metadata(resolve_path(&path))?;
    Ok(mtime_ms(&meta))
}

/// Read a UTF-8 text file for in-app preview (markdown viewer pane).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextFile, CockpitError> {
    let resolved = resolve_path(&path);
    let meta = fs::metadata(&resolved)?;
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err(CockpitError::InvalidInput(format!(
            "File is too large to preview ({} bytes; max {} bytes)",
            meta.len(),
            MAX_TEXT_FILE_BYTES
        )));
    }
    let content = fs::read_to_string(&resolved)?;
    Ok(TextFile {
        content,
        mtime_ms: mtime_ms(&meta),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_text_file_round_trips_and_stat_matches() {
        let path = std::env::temp_dir().join("cockpit-read-text-test.md");
        fs::write(&path, "# hello").unwrap();
        let s = path.to_string_lossy().to_string();

        let file = read_text_file(s.clone()).unwrap();
        assert_eq!(file.content, "# hello");
        assert!(file.mtime_ms > 0);
        assert_eq!(stat_file(s).unwrap(), file.mtime_ms);

        fs::remove_file(&path).ok();
    }

    #[test]
    fn read_text_file_missing_errors() {
        assert!(read_text_file("/nonexistent/cockpit-missing.md".into()).is_err());
        assert!(stat_file("/nonexistent/cockpit-missing.md".into()).is_err());
    }

    #[test]
    fn read_text_file_rejects_oversize() {
        let path = std::env::temp_dir().join("cockpit-oversize-test.md");
        let f = fs::File::create(&path).unwrap();
        f.set_len(MAX_TEXT_FILE_BYTES + 1).unwrap();
        drop(f);
        assert!(read_text_file(path.to_string_lossy().to_string()).is_err());
        fs::remove_file(&path).ok();
    }
}
