//! Provider profiles: named environment presets that point a terminal's
//! Claude Code CLI at a specific API backend (Anthropic by default, or any
//! Anthropic-compatible endpoint such as Moonshot's Kimi).
//!
//! Profiles are owned by the backend. The frontend only ever sees
//! `ProviderSummary` (id, label, context window) — env values may contain
//! secrets and never cross the IPC boundary. `${NAME}` references inside env
//! values resolve at spawn time from the process environment first, then the
//! machine-wide secrets file `~/.config/sontiac/.env`.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::CockpitError;

/// The Kimi model id every model slot of the built-in `kimi` profile points
/// at. K3 (released 2026-07-16) is Moonshot's 1M-context flagship; if the
/// Anthropic-compatible endpoint turns out not to serve it yet, downgrade
/// this single constant to "kimi-k2.7-code".
pub const KIMI_MODEL: &str = "kimi-k3";

/// A named environment preset for spawning terminals. `env` values may embed
/// `${SECRET_NAME}` references, resolved at spawn — profiles themselves never
/// store secret values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub label: String,
    /// Ordered env pairs; serialized as a JSON object.
    #[serde(with = "env_pairs", default)]
    pub env: Vec<(String, String)>,
    /// Context window in tokens, for scaling the context-usage badge.
    #[serde(default)]
    pub context_window: Option<u64>,
}

/// Serialize `Vec<(String, String)>` as a JSON object, preserving insertion
/// order on read (a plain `HashMap` field would scramble it).
mod env_pairs {
    use serde::de::{MapAccess, Visitor};
    use serde::ser::SerializeMap;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(
        pairs: &[(String, String)],
        s: S,
    ) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(pairs.len()))?;
        for (k, v) in pairs {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Vec<(String, String)>, D::Error> {
        struct PairsVisitor;
        impl<'de> Visitor<'de> for PairsVisitor {
            type Value = Vec<(String, String)>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a map of env var names to values")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Self::Value, A::Error> {
                let mut pairs = Vec::new();
                while let Some((k, v)) = m.next_entry::<String, String>()? {
                    pairs.push((k, v));
                }
                Ok(pairs)
            }
        }
        d.deserialize_map(PairsVisitor)
    }
}

/// The id/label/window subset of a profile that is safe to hand the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    pub id: String,
    pub label: String,
    pub context_window: Option<u64>,
}

impl From<&Provider> for ProviderSummary {
    fn from(p: &Provider) -> Self {
        Self {
            id: p.id.clone(),
            label: p.label.clone(),
            context_window: p.context_window,
        }
    }
}

/// The profiles cockpit ships with. `claude` (first, the default) is the
/// plain Anthropic setup — no env overrides, exactly the pre-profiles
/// behavior. `kimi` drives Claude Code against Moonshot's
/// Anthropic-compatible endpoint, pinning every model slot to [`KIMI_MODEL`]
/// so background/subagent tasks don't request real Claude models from
/// Moonshot.
pub fn built_ins() -> Vec<Provider> {
    let kimi_env = [
        ("ANTHROPIC_BASE_URL", "https://api.moonshot.ai/anthropic"),
        ("ANTHROPIC_AUTH_TOKEN", "${MOONSHOT_API_KEY}"),
        ("ANTHROPIC_MODEL", KIMI_MODEL),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", KIMI_MODEL),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", KIMI_MODEL),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", KIMI_MODEL),
        ("CLAUDE_CODE_SUBAGENT_MODEL", KIMI_MODEL),
    ];
    vec![
        Provider {
            id: "claude".to_string(),
            label: "Claude".to_string(),
            env: Vec::new(),
            context_window: Some(1_048_576),
        },
        Provider {
            id: "kimi".to_string(),
            label: "Kimi".to_string(),
            env: kimi_env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            context_window: Some(1_048_576),
        },
    ]
}

/// Overlay `user` profiles onto `built`: a user profile with a known id
/// replaces the built-in wholesale (position preserved); unknown ids append
/// in their file order.
pub fn merge(built: Vec<Provider>, user: Vec<Provider>) -> Vec<Provider> {
    let mut merged = built;
    for u in user {
        match merged.iter_mut().find(|b| b.id == u.id) {
            Some(slot) => *slot = u,
            None => merged.push(u),
        }
    }
    merged
}

/// All available profiles: built-ins overlaid with the user's
/// `~/.claude-cockpit/providers.json`, when present and valid. A malformed
/// file is reported and ignored — spawning must keep working.
pub fn load() -> Vec<Provider> {
    let built = built_ins();
    let Some(path) = user_file_path() else {
        return built;
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return built; // No user file — the common case.
    };
    match serde_json::from_str::<Vec<Provider>>(&content) {
        Ok(user) => merge(built, user),
        Err(e) => {
            eprintln!("[cockpit] ignoring malformed {}: {e}", path.display());
            built
        }
    }
}

fn user_file_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude-cockpit").join("providers.json"))
}

/// Replace every `${NAME}` reference in `env` values via `lookup`. Any
/// unresolvable name fails the whole resolution, naming the variable — a
/// terminal silently spawned without its key would bill the wrong provider.
pub fn resolve_env(
    env: &[(String, String)],
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<Vec<(String, String)>, CockpitError> {
    env.iter()
        .map(|(k, v)| Ok((k.clone(), substitute(v, &lookup)?)))
        .collect()
}

fn substitute(
    value: &str,
    lookup: &impl Fn(&str) -> Option<String>,
) -> Result<String, CockpitError> {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        let after = &rest[start + 2..];
        let Some(end) = after.find('}') else {
            // Unterminated "${" — treat literally rather than guessing.
            out.push_str(rest);
            return Ok(out);
        };
        let name = &after[..end];
        let resolved = lookup(name).ok_or_else(|| {
            CockpitError::InvalidInput(format!(
                "secret {name} is not set (checked process env and ~/.config/sontiac/.env)"
            ))
        })?;
        out.push_str(&rest[..start]);
        out.push_str(&resolved);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Look up a secret by name: process environment first, then the machine-wide
/// secrets file `~/.config/sontiac/.env`.
pub fn secret_lookup(name: &str) -> Option<String> {
    if let Ok(v) = std::env::var(name) {
        if !v.is_empty() {
            return Some(v);
        }
    }
    let path = dirs::home_dir()?.join(".config").join("sontiac").join(".env");
    let content = std::fs::read_to_string(path).ok()?;
    parse_secrets(&content).remove(name)
}

/// Parse simple `KEY=value` lines (the format of `~/.config/sontiac/.env`):
/// `#` comments and blank lines skipped, an optional `export ` prefix and
/// surrounding single/double quotes stripped. Lines that aren't assignments
/// are ignored.
fn parse_secrets(content: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() || key.contains(char::is_whitespace) {
            continue;
        }
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        out.insert(key.to_string(), value.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(id: &str, label: &str, env: &[(&str, &str)]) -> Provider {
        Provider {
            id: id.to_string(),
            label: label.to_string(),
            env: env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            context_window: None,
        }
    }

    #[test]
    fn built_ins_contain_claude_default_and_kimi() {
        let ps = built_ins();
        assert_eq!(ps[0].id, "claude");
        assert!(ps[0].env.is_empty());
        let kimi = ps.iter().find(|p| p.id == "kimi").unwrap();
        assert!(kimi
            .env
            .iter()
            .any(|(k, v)| k == "ANTHROPIC_BASE_URL" && v == "https://api.moonshot.ai/anthropic"));
        assert!(kimi
            .env
            .iter()
            .any(|(k, v)| k == "ANTHROPIC_AUTH_TOKEN" && v == "${MOONSHOT_API_KEY}"));
        assert_eq!(kimi.context_window, Some(1_048_576));
    }

    #[test]
    fn kimi_built_in_pins_every_model_slot() {
        let ps = built_ins();
        let kimi = ps.iter().find(|p| p.id == "kimi").unwrap();
        for slot in [
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "CLAUDE_CODE_SUBAGENT_MODEL",
        ] {
            assert!(
                kimi.env.iter().any(|(k, v)| k == slot && v == KIMI_MODEL),
                "missing model slot {slot}"
            );
        }
    }

    #[test]
    fn merge_replaces_same_id_and_appends_new() {
        let built = vec![p("claude", "Claude", &[]), p("kimi", "Kimi", &[("A", "1")])];
        let user = vec![p("kimi", "K custom", &[("B", "2")]), p("glm", "GLM", &[])];
        let merged = merge(built, user);
        let ids: Vec<&str> = merged.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["claude", "kimi", "glm"]);
        let kimi = &merged[1];
        assert_eq!(kimi.label, "K custom");
        assert_eq!(kimi.env, vec![("B".to_string(), "2".to_string())]);
    }

    #[test]
    fn resolve_env_substitutes_secret_refs() {
        let env = vec![
            ("A".to_string(), "${X}".to_string()),
            ("B".to_string(), "plain".to_string()),
            ("C".to_string(), "pre-${X}-post".to_string()),
        ];
        let resolved = resolve_env(&env, |name| {
            (name == "X").then(|| "v".to_string())
        })
        .unwrap();
        assert_eq!(
            resolved,
            vec![
                ("A".to_string(), "v".to_string()),
                ("B".to_string(), "plain".to_string()),
                ("C".to_string(), "pre-v-post".to_string()),
            ]
        );
    }

    #[test]
    fn resolve_env_missing_secret_names_variable() {
        let env = vec![("A".to_string(), "${MOONSHOT_API_KEY}".to_string())];
        let err = resolve_env(&env, |_| None).unwrap_err();
        assert!(err.to_string().contains("MOONSHOT_API_KEY"));
    }

    #[test]
    fn parse_secrets_file_handles_comments_export_and_quotes() {
        let content = "# a comment\nexport K=v\nQ=\"quoted\"\nS='single'\n\nBAD LINE\n";
        let parsed = parse_secrets(content);
        assert_eq!(parsed.get("K").map(String::as_str), Some("v"));
        assert_eq!(parsed.get("Q").map(String::as_str), Some("quoted"));
        assert_eq!(parsed.get("S").map(String::as_str), Some("single"));
        assert!(!parsed.contains_key("BAD"));
    }

    #[test]
    fn provider_summary_serializes_camel_case_without_env() {
        let json = serde_json::to_string(&ProviderSummary::from(&built_ins()[0])).unwrap();
        assert!(json.contains("\"contextWindow\":1048576"));
        assert!(!json.contains("env"));
    }

    #[test]
    fn merge_user_file_json_shape_round_trips() {
        let json = r#"[{"id":"glm","label":"GLM","env":{"ANTHROPIC_BASE_URL":"https://example.com"},"contextWindow":131072}]"#;
        let user: Vec<Provider> = serde_json::from_str(json).unwrap();
        assert_eq!(user[0].id, "glm");
        assert_eq!(user[0].context_window, Some(131_072));
        assert_eq!(
            user[0].env,
            vec![(
                "ANTHROPIC_BASE_URL".to_string(),
                "https://example.com".to_string()
            )]
        );
    }
}
