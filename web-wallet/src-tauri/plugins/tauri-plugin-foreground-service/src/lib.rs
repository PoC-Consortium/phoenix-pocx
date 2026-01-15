//! Tauri plugin for Android Foreground Service
//!
//! This plugin provides commands to start/stop a foreground service with
//! wake lock for mining and plotting operations on Android.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
mod mobile;

/// Start the foreground service with the specified mode
/// Mode can be "mining" or "plotting"
#[tauri::command]
async fn start_foreground_service<R: Runtime>(
    app: tauri::AppHandle<R>,
    mode: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        mobile::start_foreground_service(app, mode)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, mode);
        Ok(())
    }
}

/// Stop the foreground service and release wake lock
#[tauri::command]
async fn stop_foreground_service<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        mobile::stop_foreground_service(app)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Update the notification text (for progress updates)
#[tauri::command]
async fn update_service_notification<R: Runtime>(
    app: tauri::AppHandle<R>,
    text: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        mobile::update_service_notification(app, text)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, text);
        Ok(())
    }
}

/// Request battery optimization exemption by opening settings
#[tauri::command]
async fn request_battery_exemption<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        mobile::request_battery_exemption(app)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Check if the foreground service is currently running
#[tauri::command]
async fn is_service_running<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        mobile::is_service_running(app)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(false)
    }
}

/// Initialize the foreground service plugin
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("foreground-service")
        .invoke_handler(tauri::generate_handler![
            start_foreground_service,
            stop_foreground_service,
            update_service_notification,
            request_battery_exemption,
            is_service_running
        ])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(
                    "org.pocx.phoenix.foregroundservice",
                    "ForegroundServicePlugin",
                )?;
                // Wrap in unique type so we can retrieve the correct handle from app state
                app.manage(mobile::ForegroundServiceHandle(handle));
            }
            let _ = app;
            Ok(())
        })
        .build()
}
