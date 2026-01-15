//! Tauri plugin for Android MANAGE_EXTERNAL_STORAGE permission
//!
//! This plugin provides commands to check and request the "All files access"
//! permission on Android 11+, which is required for apps that need to access
//! files created by other apps (e.g., plot files for mining).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
mod mobile;

/// Check if the app has "All files access" permission (MANAGE_EXTERNAL_STORAGE)
/// Returns true on non-Android platforms (no permission needed)
#[tauri::command]
async fn has_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        mobile::has_all_files_access(app).map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(true)
    }
}

/// Request "All files access" permission by opening the system settings page
/// On non-Android platforms, this is a no-op that returns success
#[tauri::command]
async fn request_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        mobile::request_all_files_access(app).map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Initialize the storage permission plugin
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("storage-permission")
        .invoke_handler(tauri::generate_handler![
            has_all_files_access,
            request_all_files_access
        ])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("org.pocx.phoenix.storagepermission", "StoragePermissionPlugin")?;
                app.manage(handle);
            }
            let _ = app;
            Ok(())
        })
        .build()
}
