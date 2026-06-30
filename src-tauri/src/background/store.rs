use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::CockpitError;

/// Image extensions we accept for a custom background.
const ALLOWED_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

/// Persisted index entry for one user-uploaded background.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexEntry {
    id: String,
    name: String,
    file_name: String,
}

/// What the frontend receives: the stored background plus its absolute path
/// (turned into a loadable URL via Tauri's asset protocol on the JS side).
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

fn base_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-cockpit")
}

fn backgrounds_dir() -> PathBuf {
    let dir = base_dir().join("backgrounds");
    fs::create_dir_all(&dir).ok();
    dir
}

fn index_file() -> PathBuf {
    base_dir().join("backgrounds.json")
}

fn load_index() -> Vec<IndexEntry> {
    let path = index_file();
    if !path.exists() {
        return Vec::new();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_index(items: &[IndexEntry]) -> Result<(), CockpitError> {
    let path = index_file();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&path, serde_json::to_string_pretty(items)?)?;
    Ok(())
}

fn to_info(entry: &IndexEntry, dir: &Path) -> BackgroundInfo {
    BackgroundInfo {
        id: entry.id.clone(),
        name: entry.name.clone(),
        path: dir.join(&entry.file_name).to_string_lossy().into_owned(),
    }
}

/// List stored backgrounds, dropping any whose file has gone missing on disk so
/// the picker never shows a dead entry.
pub fn list() -> Vec<BackgroundInfo> {
    let dir = backgrounds_dir();
    load_index()
        .into_iter()
        .filter(|e| dir.join(&e.file_name).exists())
        .map(|e| to_info(&e, &dir))
        .collect()
}

/// Copy an image from `src` into the app's backgrounds folder and record it in
/// the index. The stored file is named by a fresh uuid (so re-uploading the same
/// filename never collides); the display name is taken from the original stem.
pub fn import(src: &Path) -> Result<BackgroundInfo, CockpitError> {
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| ALLOWED_EXT.contains(&e.as_str()))
        .ok_or_else(|| {
            CockpitError::InvalidInput("Unsupported image type".to_string())
        })?;

    if !src.is_file() {
        return Err(CockpitError::InvalidInput(
            "Selected path is not a file".to_string(),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.{ext}");
    let dir = backgrounds_dir();
    fs::copy(src, dir.join(&file_name))?;

    let name = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Background")
        .to_string();

    let entry = IndexEntry {
        id,
        name,
        file_name,
    };
    let mut index = load_index();
    index.push(entry.clone());
    save_index(&index)?;

    Ok(to_info(&entry, &dir))
}

/// Remove a stored background (file + index entry) and return the updated list.
/// A missing id is a no-op.
pub fn delete(id: &str) -> Result<Vec<BackgroundInfo>, CockpitError> {
    let dir = backgrounds_dir();
    let mut index = load_index();
    if let Some(pos) = index.iter().position(|e| e.id == id) {
        let removed = index.remove(pos);
        fs::remove_file(dir.join(&removed.file_name)).ok();
        save_index(&index)?;
    }
    Ok(list())
}
