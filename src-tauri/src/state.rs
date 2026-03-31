use std::collections::HashMap;
use std::sync::Mutex;

use crate::pty::manager::PtyHandle;

pub struct AppState {
    pub terminals: Mutex<HashMap<String, PtyHandle>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
        }
    }
}
