use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub first_message: f64,
    pub last_message: f64,
    pub message_count: u32,
    pub cwd: String,
    pub summary: Option<String>,
}
