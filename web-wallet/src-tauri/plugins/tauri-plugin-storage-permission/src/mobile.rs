//! Android-specific implementation using Tauri's mobile plugin system

use serde::Deserialize;
use tauri::{plugin::PluginHandle, Manager, Runtime, State};

/// Response from hasAllFilesAccess command
#[derive(Deserialize)]
struct HasAccessResponse {
    value: bool,
}

/// Check if the app has MANAGE_EXTERNAL_STORAGE permission
pub fn has_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let handle: State<'_, PluginHandle<R>> = app
        .try_state()
        .ok_or("Storage permission plugin not initialized")?;

    let response: HasAccessResponse = handle
        .run_mobile_plugin("hasAllFilesAccess", ())
        .map_err(|e| format!("Failed to check permission: {}", e))?;

    Ok(response.value)
}

/// Request MANAGE_EXTERNAL_STORAGE permission by opening settings
pub fn request_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let handle: State<'_, PluginHandle<R>> = app
        .try_state()
        .ok_or("Storage permission plugin not initialized")?;

    handle
        .run_mobile_plugin::<()>("requestAllFilesAccess", ())
        .map_err(|e| format!("Failed to request permission: {}", e))
}
