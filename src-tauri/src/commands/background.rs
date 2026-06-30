use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::background::store::{self, BackgroundInfo};
use crate::error::CockpitError;

#[tauri::command]
pub fn list_backgrounds() -> Result<Vec<BackgroundInfo>, CockpitError> {
    Ok(store::list())
}

/// Open a native image picker and, if the user chooses a file, copy it into the
/// app's backgrounds folder and return it. Returns `Ok(None)` when the dialog is
/// cancelled, so the caller can simply do nothing.
///
/// `blocking_pick_file` must not run on the main thread (it would deadlock the
/// event loop — which froze the UI on cancel). We run it on a blocking worker so
/// the command always resolves, whether the user picks a file or cancels.
#[tauri::command]
pub async fn import_background(app: AppHandle) -> Result<Option<BackgroundInfo>, CockpitError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| CockpitError::InvalidInput(format!("dialog task failed: {e}")))?;

    let Some(file) = picked else {
        return Ok(None);
    };

    let path = file
        .into_path()
        .map_err(|e| CockpitError::InvalidInput(e.to_string()))?;

    Ok(Some(store::import(&path)?))
}

#[tauri::command]
pub fn delete_background(id: String) -> Result<Vec<BackgroundInfo>, CockpitError> {
    store::delete(&id)
}
