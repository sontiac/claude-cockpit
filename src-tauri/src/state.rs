use std::collections::HashMap;
use std::sync::Mutex;

use crate::pty::manager::PtyHandle;
use crate::workspace::store::Geometry;

pub struct AppState {
    pub terminals: Mutex<HashMap<String, PtyHandle>>,
    /// Pre-maximize window frame per window label, so `toggle_maximize` can
    /// restore a window to where it sat before it was maximized.
    pub maximize_frames: Mutex<HashMap<String, Geometry>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            maximize_frames: Mutex::new(HashMap::new()),
        }
    }
}
