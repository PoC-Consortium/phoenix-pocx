//! Android-specific implementation using Tauri's mobile plugin system

use serde::Deserialize;
use tauri::{plugin::PluginHandle, Manager, Runtime};

/// Wrapper type for the storage permission plugin handle
/// This ensures we get the correct plugin handle from app state
pub struct StoragePermissionHandle<R: Runtime>(pub PluginHandle<R>);

/// Response from hasAllFilesAccess command
#[derive(Deserialize)]
struct HasAccessResponse {
    value: bool,
}

/// Empty response for commands that return JSObject() from Kotlin
#[derive(Deserialize)]
struct EmptyResponse {}

/// Check if the app has MANAGE_EXTERNAL_STORAGE permission
pub fn has_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let handle = app
        .try_state::<StoragePermissionHandle<R>>()
        .ok_or("Storage permission plugin not initialized")?;

    let response: HasAccessResponse = handle
        .0
        .run_mobile_plugin("hasAllFilesAccess", ())
        .map_err(|e| format!("Failed to check permission: {}", e))?;

    Ok(response.value)
}

/// Request MANAGE_EXTERNAL_STORAGE permission by opening settings
pub fn request_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let handle = app
        .try_state::<StoragePermissionHandle<R>>()
        .ok_or("Storage permission plugin not initialized")?;

    // Kotlin returns JSObject() which is an empty {}, so we deserialize to EmptyResponse
    let _: EmptyResponse = handle
        .0
        .run_mobile_plugin("requestAllFilesAccess", ())
        .map_err(|e| format!("Failed to request permission: {}", e))?;

    Ok(())
}
