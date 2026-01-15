//! Android-specific implementation using Tauri's mobile plugin system

use serde::{Deserialize, Serialize};
use tauri::{plugin::PluginHandle, Manager, Runtime};

/// Wrapper type for the foreground service plugin handle
/// This ensures we get the correct plugin handle from app state
pub struct ForegroundServiceHandle<R: Runtime>(pub PluginHandle<R>);

/// Empty response for commands that return JSObject() from Kotlin
#[derive(Deserialize)]
struct EmptyResponse {}

/// Response with boolean value
#[derive(Deserialize)]
struct BoolResponse {
    value: bool,
}

/// Arguments for start_foreground_service
#[derive(Serialize)]
struct StartServiceArgs {
    mode: String,
}

/// Arguments for update_service_notification
#[derive(Serialize)]
struct UpdateNotificationArgs {
    text: String,
}

/// Start the foreground service
pub fn start_foreground_service<R: Runtime>(
    app: tauri::AppHandle<R>,
    mode: String,
) -> Result<(), String> {
    let handle = app
        .try_state::<ForegroundServiceHandle<R>>()
        .ok_or("Foreground service plugin not initialized")?;

    let _: EmptyResponse = handle
        .0
        .run_mobile_plugin("startForegroundService", StartServiceArgs { mode })
        .map_err(|e| format!("Failed to start foreground service: {}", e))?;

    Ok(())
}

/// Stop the foreground service
pub fn stop_foreground_service<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let handle = app
        .try_state::<ForegroundServiceHandle<R>>()
        .ok_or("Foreground service plugin not initialized")?;

    let _: EmptyResponse = handle
        .0
        .run_mobile_plugin("stopForegroundService", ())
        .map_err(|e| format!("Failed to stop foreground service: {}", e))?;

    Ok(())
}

/// Update notification text
pub fn update_service_notification<R: Runtime>(
    app: tauri::AppHandle<R>,
    text: String,
) -> Result<(), String> {
    let handle = app
        .try_state::<ForegroundServiceHandle<R>>()
        .ok_or("Foreground service plugin not initialized")?;

    let _: EmptyResponse = handle
        .0
        .run_mobile_plugin("updateNotification", UpdateNotificationArgs { text })
        .map_err(|e| format!("Failed to update notification: {}", e))?;

    Ok(())
}

/// Request battery optimization exemption
pub fn request_battery_exemption<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let handle = app
        .try_state::<ForegroundServiceHandle<R>>()
        .ok_or("Foreground service plugin not initialized")?;

    let _: EmptyResponse = handle
        .0
        .run_mobile_plugin("requestBatteryExemption", ())
        .map_err(|e| format!("Failed to request battery exemption: {}", e))?;

    Ok(())
}

/// Check if service is running
pub fn is_service_running<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let handle = app
        .try_state::<ForegroundServiceHandle<R>>()
        .ok_or("Foreground service plugin not initialized")?;

    let response: BoolResponse = handle
        .0
        .run_mobile_plugin("isServiceRunning", ())
        .map_err(|e| format!("Failed to check service status: {}", e))?;

    Ok(response.value)
}
