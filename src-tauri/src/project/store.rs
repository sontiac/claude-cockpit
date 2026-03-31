use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    pub terminals: u32,
    pub command: Option<String>,
}

fn projects_file() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-cockpit");
    fs::create_dir_all(&dir).ok();
    dir.join("projects.json")
}

fn load_projects() -> Vec<Project> {
    let path = projects_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_projects(projects: &[Project]) -> Result<(), crate::error::CockpitError> {
    let path = projects_file();
    let data = serde_json::to_string_pretty(projects)?;
    fs::write(&path, data)?;
    Ok(())
}

pub fn get_projects() -> Vec<Project> {
    load_projects()
}

pub fn add_project(project: Project) -> Result<Vec<Project>, crate::error::CockpitError> {
    let mut projects = load_projects();
    projects.push(project);
    save_projects(&projects)?;
    Ok(projects)
}

pub fn update_project(project: Project) -> Result<Vec<Project>, crate::error::CockpitError> {
    let mut projects = load_projects();
    if let Some(existing) = projects.iter_mut().find(|p| p.id == project.id) {
        *existing = project;
    }
    save_projects(&projects)?;
    Ok(projects)
}

pub fn delete_project(id: &str) -> Result<Vec<Project>, crate::error::CockpitError> {
    let mut projects = load_projects();
    projects.retain(|p| p.id != id);
    save_projects(&projects)?;
    Ok(projects)
}
