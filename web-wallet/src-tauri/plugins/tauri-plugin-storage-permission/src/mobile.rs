//! Android-specific implementation using Tauri's mobile plugin system

use tauri::{plugin::PluginHandle, Runtime};

/// Check if the app has MANAGE_EXTERNAL_STORAGE permission
pub fn has_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let handle: &PluginHandle<R> = app
        .try_state()
        .ok_or("Storage permission plugin not initialized")?;

    handle
        .run_mobile_plugin::<bool>("hasAllFilesAccess", ())
        .map_err(|e| format!("Failed to check permission: {}", e))
}

/// Request MANAGE_EXTERNAL_STORAGE permission by opening settings
pub fn request_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let handle: &PluginHandle<R> = app
        .try_state()
        .ok_or("Storage permission plugin not initialized")?;

    handle
        .run_mobile_plugin::<()>("requestAllFilesAccess", ())
        .map_err(|e| format!("Failed to request permission: {}", e))
}
