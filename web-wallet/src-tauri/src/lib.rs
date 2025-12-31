use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Options for reading cookie file
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieReadOptions {
    pub data_directory: String,
    pub network: String,
}

/// Result from reading cookie file
#[derive(Debug, Serialize)]
pub struct CookieReadResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Expand environment variables and ~ in paths
/// Windows: %VAR% style
/// Unix: ~ expands to HOME
fn expand_path(path: &str) -> String {
    let mut result = path.to_string();

    #[cfg(windows)]
    {
        // Expand %VAR% style environment variables on Windows
        while let Some(start) = result.find('%') {
            if let Some(end) = result[start + 1..].find('%') {
                let var_name = &result[start + 1..start + 1 + end];
                if let Ok(value) = std::env::var(var_name) {
                    result = format!("{}{}{}", &result[..start], value, &result[start + 2 + end..]);
                } else {
                    break;
                }
            } else {
                break;
            }
        }
    }

    #[cfg(not(windows))]
    {
        // Expand ~ to HOME directory on Unix
        if result.starts_with("~/") {
            if let Some(home) = dirs::home_dir() {
                result = format!("{}{}", home.display(), &result[1..]);
            }
        } else if result == "~" {
            if let Some(home) = dirs::home_dir() {
                result = home.to_string_lossy().to_string();
            }
        }
    }

    result
}

/// Build cookie file path from dataDirectory and network
fn build_cookie_path(data_directory: &str, network: &str) -> PathBuf {
    let expanded_dir = expand_path(data_directory);
    let mut path = PathBuf::from(expanded_dir);

    if network == "mainnet" {
        path.push(".cookie");
    } else {
        // testnet or regtest - cookie is in subdirectory
        path.push(network);
        path.push(".cookie");
    }

    path
}

/// Read the Bitcoin Core cookie file for RPC authentication
#[tauri::command]
fn read_cookie_file(options: CookieReadOptions) -> CookieReadResult {
    let cookie_path = build_cookie_path(&options.data_directory, &options.network);
    let path_str = cookie_path.to_string_lossy().to_string();

    match fs::read_to_string(&cookie_path) {
        Ok(content) => CookieReadResult {
            success: true,
            content: Some(content.trim().to_string()),
            error: None,
            path: Some(path_str),
        },
        Err(e) => CookieReadResult {
            success: false,
            content: None,
            error: Some(format!("Cookie file not found at {}: {}", path_str, e)),
            path: Some(path_str),
        },
    }
}

/// Get the path to the Bitcoin Core cookie file
#[tauri::command]
fn get_cookie_path(options: CookieReadOptions) -> Option<String> {
    let path = build_cookie_path(&options.data_directory, &options.network);
    Some(path.to_string_lossy().to_string())
}

/// Get the current platform (win32, darwin, linux)
#[tauri::command]
fn get_platform() -> String {
    #[cfg(target_os = "windows")]
    return "win32".to_string();

    #[cfg(target_os = "macos")]
    return "darwin".to_string();

    #[cfg(target_os = "linux")]
    return "linux".to_string();

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return "unknown".to_string();
}

/// Check if running in development mode
#[tauri::command]
fn is_dev() -> bool {
    cfg!(debug_assertions)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_cookie_file,
            get_cookie_path,
            get_platform,
            is_dev,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
