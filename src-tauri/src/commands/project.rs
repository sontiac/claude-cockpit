use crate::error::CockpitError;
use crate::project::store::{self, Project};

#[tauri::command]
pub fn get_projects() -> Result<Vec<Project>, CockpitError> {
    Ok(store::get_projects())
}

#[tauri::command]
pub fn add_project(
    id: String,
    name: String,
    path: String,
    color: String,
    terminals: u32,
    command: Option<String>,
) -> Result<Vec<Project>, CockpitError> {
    store::add_project(Project {
        id,
        name,
        path,
        color,
        terminals,
        command,
    })
}

#[tauri::command]
pub fn update_project(
    id: String,
    name: String,
    path: String,
    color: String,
    terminals: u32,
    command: Option<String>,
) -> Result<Vec<Project>, CockpitError> {
    store::update_project(Project {
        id,
        name,
        path,
        color,
        terminals,
        command,
    })
}

#[tauri::command]
pub fn delete_project(id: String) -> Result<Vec<Project>, CockpitError> {
    store::delete_project(&id)
}
