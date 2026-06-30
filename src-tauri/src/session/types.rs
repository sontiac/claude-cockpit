use serde::Serialize;

/// A snapshot of how much of the context window a live session is currently
/// using, derived from the most recent (non-sidechain) assistant turn's `usage`
/// in the session transcript. `tokens` is the full prompt that turn carried plus
/// its output — i.e. everything resident in the context window — which is what
/// `/context` reports.
#[derive(Debug, Clone, Serialize)]
pub struct SessionContext {
    pub tokens: u64,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub slug: Option<String>,
    pub first_message: f64,
    pub last_message: f64,
    pub message_count: u32,
    pub tool_call_count: u32,
    pub cwd: String,
    pub summary: Option<String>,
    pub model: Option<String>,
    pub git_branch: Option<String>,
    pub custom_title: Option<String>,
    pub first_user_message: Option<String>,
}
