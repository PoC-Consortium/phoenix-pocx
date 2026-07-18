use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;

// Logging module
mod logging;

// Aggregator module (part of the `mining` build flavor)
#[cfg(feature = "mining")]
pub mod aggregator;

// Mining module (gated by the `mining` build flavor)
#[cfg(feature = "mining")]
pub mod mining;

// Node management module
pub mod node;

// Nodeless BTCX wallet module (btcx crates over Electrum; `wallet` flavor)
#[cfg(feature = "wallet")]
pub mod btcx_wallet;

// Update checking module
pub mod update;

// Clock-drift / NTP module
pub mod time;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Include database migrations for the mining database
fn include_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_deadlines_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS deadlines (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chain_name TEXT NOT NULL,
                    account TEXT NOT NULL,
                    height INTEGER NOT NULL,
                    nonce INTEGER NOT NULL,
                    deadline INTEGER NOT NULL,
                    submitted INTEGER NOT NULL DEFAULT 0,
                    timestamp INTEGER NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_deadlines_chain ON deadlines(chain_name);
                CREATE INDEX IF NOT EXISTS idx_deadlines_height ON deadlines(height);
                CREATE INDEX IF NOT EXISTS idx_deadlines_timestamp ON deadlines(timestamp);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_mining_config_table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS mining_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    config_json TEXT NOT NULL,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
            "#,
            kind: MigrationKind::Up,
        },
    ]
}

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

/// Get the consolidated app data directory for all Phoenix data.
///
/// All configs, logs, node binary, and databases go here.
/// - Windows: `%LocalAppData%\Phoenix PoCX Data`
/// - Linux:   `~/.local/share/phoenix-pocx`
/// - macOS:   `~/Library/Application Support/Phoenix PoCX Data`
///
/// `PHOENIX_DATA_DIR` overrides the location — used by tests (temp dirs
/// instead of the real profile) and as an operational escape hatch.
pub fn app_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("PHOENIX_DATA_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }

    #[cfg(target_os = "windows")]
    {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Phoenix PoCX Data")
    }

    #[cfg(target_os = "linux")]
    {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("phoenix-pocx")
    }

    #[cfg(target_os = "macos")]
    {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Phoenix PoCX Data")
    }

    #[cfg(target_os = "android")]
    {
        // The installed applicationId varies per build flavor (hybrid
        // org.pocx.phoenix, wallet-only org.pocx.phoenix.wallet, mining-only
        // org.pocx.phoenix.miner). Android sandboxes each app to
        // /data/data/<applicationId>/files and blocks cross-app access, so the
        // data dir MUST track the real appId — a fixed org.pocx.phoenix path
        // would be unreadable from the .wallet / .miner flavors. CI injects the
        // appId as PHX_APP_ID (inherited by the cargo build); default = hybrid.
        let package = option_env!("PHX_APP_ID").unwrap_or("org.pocx.phoenix");
        PathBuf::from(format!("/data/data/{package}/files"))
    }

    #[cfg(target_os = "ios")]
    {
        // Sandbox container: <App>/Library/Application Support
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    }

    #[cfg(not(any(
        target_os = "windows",
        target_os = "linux",
        target_os = "macos",
        target_os = "android",
        target_os = "ios"
    )))]
    {
        PathBuf::from(".").join("phoenix-pocx")
    }
}

/// Expand environment variables and ~ in paths
/// Windows: %VAR% style
/// Unix: ~ expands to HOME
pub fn expand_path(path: &str) -> String {
    let mut result = path.to_string();

    #[cfg(windows)]
    {
        // Expand %VAR% style environment variables on Windows
        while let Some(start) = result.find('%') {
            if let Some(end) = result[start + 1..].find('%') {
                let var_name = &result[start + 1..start + 1 + end];
                if let Ok(value) = std::env::var(var_name) {
                    result = format!(
                        "{}{}{}",
                        &result[..start],
                        value,
                        &result[start + 2 + end..]
                    );
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
pub(crate) fn build_cookie_path(data_directory: &str, network: &str) -> PathBuf {
    let expanded_dir = expand_path(data_directory);
    let base_path = PathBuf::from(&expanded_dir);

    if network == "mainnet" {
        return base_path.join(".cookie");
    }

    // testnet and regtest use their respective subdirectories
    base_path.join(network).join(".cookie")
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

/// Write UTF-8 text to a file path. Used by the frontend file-export flow
/// (CSV etc.): the webview can't trigger a real download, so the frontend
/// picks a destination via the save dialog and writes it here.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Failed to write {}: {}", path, e))
}

/// Write raw bytes to a file path — the binary counterpart of
/// `write_text_file` (e.g. a `.psbt` export). Same save-dialog flow.
#[tauri::command]
fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Failed to write {}: {}", path, e))
}

/// Get the current platform (win32, darwin, linux, android)
#[tauri::command]
fn get_platform() -> String {
    #[cfg(target_os = "windows")]
    return "win32".to_string();

    #[cfg(target_os = "macos")]
    return "darwin".to_string();

    #[cfg(target_os = "linux")]
    return "linux".to_string();

    #[cfg(target_os = "android")]
    return "android".to_string();

    #[cfg(target_os = "ios")]
    return "ios".to_string();

    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "linux",
        target_os = "android",
        target_os = "ios"
    )))]
    return "unknown".to_string();
}

/// Check if running in development mode
#[tauri::command]
fn is_dev() -> bool {
    cfg!(debug_assertions)
}

/// Get the launch mode (wallet, mining, mobile, or wallet-mobile)
/// Desktop: "mining" if --mining-only or -m is passed, "mobile" if
/// --mobile is passed (dev-testing the FULL Android flavor: mining + the
/// nodeless wallet), "wallet-mobile" if --wallet-only is passed (the
/// wallet-only Android flavor), otherwise "wallet"
/// Android: derived from the compiled build flavor (cargo features) —
///   both `mining` + `wallet` → "mobile"   (Hybrid app: mining + nodeless wallet)
///   only `wallet`           → "wallet-mobile" (Play Store wallet-only app)
///   only `mining`           → "mining"    (sideload pure-miner app, external payout)
/// iOS: always "wallet-mobile" (mining is banned on the App Store)
#[tauri::command]
fn get_launch_mode() -> String {
    // Android is always nodeless. Which surfaces exist is decided at compile
    // time: the wallet/mining code for the disabled feature isn't in the
    // binary, so the mode must match what was actually built.
    #[cfg(target_os = "android")]
    {
        #[cfg(all(feature = "mining", feature = "wallet"))]
        return "mobile".to_string();
        #[cfg(all(feature = "wallet", not(feature = "mining")))]
        return "wallet-mobile".to_string();
        #[cfg(all(feature = "mining", not(feature = "wallet")))]
        return "mining".to_string();
        #[cfg(not(any(feature = "mining", feature = "wallet")))]
        return "wallet".to_string();
    }

    // iOS is always the wallet-only flavor: no mining (Apple bans it) and
    // no local node — the nodeless BTCX wallet is the whole app.
    #[cfg(target_os = "ios")]
    return "wallet-mobile".to_string();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if std::env::args().any(|arg| arg == "--mining-only" || arg == "-m") {
            "mining".to_string()
        } else if std::env::args().any(|arg| arg == "--mobile") {
            // Dev-testing the full Android flavor on desktop: mining + the
            // nodeless BTCX wallet (the mobile layout + /miner routes).
            "mobile".to_string()
        } else if std::env::args().any(|arg| arg == "--wallet-only") {
            "wallet-mobile".to_string()
        } else {
            "wallet".to_string()
        }
    }
}

/// Debug paths for troubleshooting
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugPaths {
    pub app_data_dir: String,
    pub node_config: String,
    pub mining_config: String,
    pub aggregator_config: String,
    pub bitcoin_conf: String,
    pub logs_dir: String,
    pub bitcoin_debug_log: String,
}

/// Get all relevant debug/config paths for the Debug & Logs settings tab
#[tauri::command]
fn get_debug_paths() -> DebugPaths {
    let data_dir = app_data_dir();
    let node_config = node::config::NodeConfig::load();
    let bitcoin_data_dir = node_config.get_data_directory();

    let network_subdir = match node_config.network {
        node::config::Network::Mainnet => None,
        node::config::Network::Testnet => Some("testnet"),
        node::config::Network::Regtest => Some("regtest"),
    };

    let debug_log_path = match network_subdir {
        Some(sub) => bitcoin_data_dir.join(sub).join("debug.log"),
        None => bitcoin_data_dir.join("debug.log"),
    };

    DebugPaths {
        app_data_dir: data_dir.to_string_lossy().to_string(),
        node_config: node::config::NodeConfig::config_path()
            .to_string_lossy()
            .to_string(),
        mining_config: {
            #[cfg(feature = "mining")]
            {
                mining::state::get_config_file_path()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default()
            }
            #[cfg(not(feature = "mining"))]
            {
                String::new()
            }
        },
        aggregator_config: {
            #[cfg(feature = "mining")]
            {
                aggregator::state::get_config_file_path()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default()
            }
            #[cfg(not(feature = "mining"))]
            {
                String::new()
            }
        },
        bitcoin_conf: node_config
            .bitcoin_conf_path()
            .to_string_lossy()
            .to_string(),
        logs_dir: data_dir.join("logs").to_string_lossy().to_string(),
        bitcoin_debug_log: debug_log_path.to_string_lossy().to_string(),
    }
}

/// Open a folder in the system file manager
#[tauri::command]
#[cfg_attr(
    any(target_os = "android", target_os = "ios"),
    allow(unused_variables)
)]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

/// Force exit the application
/// Used when user confirms exit while mining/plotting is active
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    // On desktop, destroy the main window first to avoid Windows error message
    // "Failed to unregister class Chrome_WidgetWin_0. Error = 1412"
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        if let Err(err) = window.destroy() {
            log::warn!("Failed to destroy window before exit: {}", err);
        }
    }
    app.exit(0);
}

/// Check if the current process is running with elevated (admin) privileges
/// Only relevant on Windows for NTFS preallocation; Linux doesn't need elevation
#[tauri::command]
fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        ::is_elevated::is_elevated()
    }
    #[cfg(not(windows))]
    {
        // On Linux/macOS, elevation is not needed for plotting
        // Return true to skip elevation prompts
        true
    }
}

/// Restart the application with elevated (admin) privileges
/// On Windows, this uses ShellExecute with "runas" verb to trigger UAC prompt
/// Preserves original command line arguments (e.g., --mining-only)
/// Returns true if restart was initiated, false if failed or cancelled
#[tauri::command]
async fn restart_elevated(app: tauri::AppHandle) -> bool {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;

        // Get the current executable path
        let exe_path = match std::env::current_exe() {
            Ok(path) => path,
            Err(_) => return false,
        };

        // Collect original command line arguments (skip executable name)
        let args: Vec<String> = std::env::args().skip(1).collect();
        let args_str = args.join(" ");

        // Convert paths to wide strings for Windows API
        let exe_wide: Vec<u16> = OsStr::new(exe_path.as_os_str())
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let verb_wide: Vec<u16> = OsStr::new("runas")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let args_wide: Vec<u16> = OsStr::new(&args_str)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        // Use ShellExecuteW to restart with elevation, preserving arguments
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                ptr::null_mut(),
                verb_wide.as_ptr(),
                exe_wide.as_ptr(),
                if args_str.is_empty() {
                    ptr::null()
                } else {
                    args_wide.as_ptr()
                },
                ptr::null(),
                windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
            )
        };

        // ShellExecuteW returns > 32 on success
        if result as usize > 32 {
            // Destroy window first to avoid Windows error, then exit current instance
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.destroy();
            }
            app.exit(0);
            true
        } else {
            // User cancelled UAC or error occurred
            false
        }
    }

    #[cfg(not(windows))]
    {
        // On Unix, we can't easily elevate. User should run with sudo.
        let _ = &app; // Suppress unused variable warning
        log::warn!("Elevation not supported on this platform. Run with sudo for admin privileges.");
        false
    }
}

/// Create the application menu (desktop only)
#[cfg(desktop)]
fn create_menu(app: &tauri::App) -> Result<Menu<tauri::Wry>, tauri::Error> {
    // File menu
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("settings", "Settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("exit", "Exit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    // Edit menu
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, Some("Undo"))?)
        .item(&PredefinedMenuItem::redo(app, Some("Redo"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cut"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Paste"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
        .build()?;

    // View menu
    #[cfg(debug_assertions)]
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("devtools", "Toggle Developer Tools")
                .accelerator("CmdOrCtrl+Shift+I")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("zoom_reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+Plus")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("fullscreen", "Toggle Fullscreen")
                .accelerator("F11")
                .build(app)?,
        )
        .build()?;

    #[cfg(not(debug_assertions))]
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("fullscreen", "Toggle Fullscreen")
                .accelerator("F11")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("zoom_reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+Plus")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .build()?;

    // Window menu
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, Some("Minimize"))?)
        .item(&PredefinedMenuItem::close_window(app, Some("Close"))?)
        .build()?;

    // Help menu
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("documentation", "Bitcoin PoCX Documentation").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("report_suggestion", "Report A Suggestion").build(app)?)
        .item(&MenuItemBuilder::with_id("report_issue", "Report An Issue").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("check_update", "Check for Update").build(app)?)
        .item(&MenuItemBuilder::with_id("about", "About").build(app)?)
        .build()?;

    // Build main menu
    let menu = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize log4rs with console, file, and Tauri event appenders
    let log_dir = app_data_dir().join("logs");

    if let Err(e) = logging::init_logger(log_dir.clone()) {
        eprintln!("Failed to initialize logger: {}. Log dir: {:?}", e, log_dir);
    }

    // Create shared mining + aggregator state (mining build flavor only)
    #[cfg(feature = "mining")]
    let mining_state = mining::state::create_mining_state();
    #[cfg(feature = "mining")]
    let plotter_runtime = mining::create_plotter_runtime();
    #[cfg(feature = "mining")]
    let aggregator_state = aggregator::state::create_aggregator_state();

    // Create shared node state and manager
    let node_state = node::create_node_state();
    let node_manager = node::NodeManager::new();

    // Create shared nodeless BTCX wallet state (wallet build flavor only)
    #[cfg(feature = "wallet")]
    let btcx_wallet_state = btcx_wallet::create_btcx_wallet_state();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init());

    // Android-only plugins
    #[cfg(target_os = "android")]
    {
        builder = builder
            .plugin(tauri_plugin_android_fs::init())
            .plugin(tauri_plugin_storage_permission::init())
            .plugin(tauri_plugin_foreground_service::init());
    }

    builder = builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mining.db", include_migrations())
                .build(),
        )
        .manage(node_state)
        .manage(node_manager);

    // Mining + aggregator state (mining build flavor only)
    #[cfg(feature = "mining")]
    {
        builder = builder
            .manage(mining_state)
            .manage(plotter_runtime)
            .manage(aggregator_state);
    }

    // Nodeless BTCX wallet state (wallet build flavor only)
    #[cfg(feature = "wallet")]
    {
        builder = builder.manage(btcx_wallet_state);
    }

    builder = builder.setup(|app| {
        // Set app handle for TauriEventAppender (log forwarding to frontend)
        logging::set_app_handle(app.handle().clone());

        // Create and set application menu (desktop only - no menu on mobile)
        #[cfg(desktop)]
        {
            let menu = create_menu(app)?;
            app.set_menu(menu)?;
        }

        // Register miner + aggregator callbacks (mining build flavor only)
        #[cfg(feature = "mining")]
        {
            // Register miner callback for mining events (with state for deadline persistence)
            let state = app
                .state::<mining::state::SharedMiningState>()
                .inner()
                .clone();
            mining::callback::TauriMinerCallback::register(app.handle().clone(), state);

            // Register aggregator callback (OnceLock - must be done once at startup)
            let agg_state = app
                .state::<aggregator::state::SharedAggregatorState>()
                .inner()
                .clone();
            aggregator::callback::TauriAggregatorCallback::register(
                app.handle().clone(),
                agg_state,
            );
        }

        // Resume the nodeless BTCX wallet if it was set up (off the main
        // thread — opening dials nothing, but sqlite + seed I/O should
        // never delay startup; failures only log). Wallet flavor only.
        #[cfg(feature = "wallet")]
        {
            let state = app
                .state::<btcx_wallet::SharedBtcxWalletState>()
                .inner()
                .clone();
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if state.get_config().active {
                    if let Err(e) = state.open_runtime(Some(handle)) {
                        log::warn!("btcx wallet: resume failed: {}", e);
                    }
                    // Fill in compartments a pre-redesign group is
                    // still missing (silent for locked seeds).
                    if let Err(e) =
                        btcx_wallet::commands::materialize_group_compartments(&state, &[])
                    {
                        log::warn!("btcx wallet: compartment materialization failed: {e}");
                    }
                }
            });
        }

        // Set window title based on launch mode (desktop only)
        #[cfg(desktop)]
        {
            if std::env::args().any(|arg| arg == "--mining-only" || arg == "-m") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title("Phoenix PoCX Miner");
                }
            }
        }

        Ok(())
    });

    // Menu events (desktop only - no menu on mobile)
    #[cfg(desktop)]
    {
        builder = builder.on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "exit" => {
                    // Request window close - triggers frontend's onCloseRequested handler
                    // which shows confirmation dialog if mining/plotting is active
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.close();
                    }
                }
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        // In mining-only mode, navigate to mining setup instead of global settings
                        let is_mining_only = std::env::args().any(|arg| arg == "--mining-only" || arg == "-m");
                        let route = if is_mining_only { "/miner/setup" } else { "/settings" };

                        // Use history.pushState for Angular's HTML5 routing
                        let _ = window.eval(format!(r#"
                            history.pushState({{}}, '', '{}');
                            window.dispatchEvent(new PopStateEvent('popstate'));
                        "#, route));
                    }
                }
                #[cfg(debug_assertions)]
                "devtools" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_devtools_open() {
                            window.close_devtools();
                        } else {
                            window.open_devtools();
                        }
                    }
                }
                "zoom_reset" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("document.body.style.zoom = '100%';");
                    }
                }
                "zoom_in" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval(
                            r#"
                            const currentZoom = parseFloat(document.body.style.zoom || '100') / 100;
                            document.body.style.zoom = (currentZoom + 0.1) * 100 + '%';
                            "#,
                        );
                    }
                }
                "zoom_out" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval(
                            r#"
                            const currentZoom = parseFloat(document.body.style.zoom || '100') / 100;
                            document.body.style.zoom = Math.max(0.5, currentZoom - 0.1) * 100 + '%';
                            "#,
                        );
                    }
                }
                "fullscreen" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Ok(is_fullscreen) = window.is_fullscreen() {
                            let _ = window.set_fullscreen(!is_fullscreen);
                        }
                    }
                }
                "documentation" => {
                    let _ = tauri_plugin_opener::open_url(
                        "https://github.com/PoC-Consortium/bitcoin-pocx/blob/master/docs/index.md",
                        None::<&str>,
                    );
                }
                "report_suggestion" => {
                    let _ = tauri_plugin_opener::open_url(
                        "https://github.com/PoC-Consortium/phoenix-pocx/issues/new?assignees=&labels=enhancement&template=feature_request.md&title=",
                        None::<&str>,
                    );
                }
                "report_issue" => {
                    let _ = tauri_plugin_opener::open_url(
                        "https://github.com/PoC-Consortium/phoenix-pocx/issues/new?assignees=&labels=bug&template=bug_report.md&title=",
                        None::<&str>,
                    );
                }
                "check_update" => {
                    // Emit event to frontend to trigger update check and show dialog
                    let _ = app.emit("menu:check-update", ());
                }
                "about" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let version = env!("CARGO_PKG_VERSION");
                        let _ = window.eval(format!(
                            r#"
                            alert('Phoenix Wallet v{}\n\nA secure and easy-to-use wallet for Bitcoin-PoCX.\n\nhttps://www.bitcoin-pocx.org\n\n© 2025 The Proof of Capacity Consortium');
                            "#,
                            version
                        ));
                    }
                }
                _ => {}
            }
        });
    }

    // Window close handling is done in the frontend (AppComponent.initCloseHandler)
    // to support i18n for the confirmation dialog
    builder
        .invoke_handler(tauri::generate_handler![
            // Cookie/wallet commands
            read_cookie_file,
            get_cookie_path,
            get_platform,
            is_dev,
            get_launch_mode,
            exit_app,
            // Debug commands
            get_debug_paths,
            open_folder,
            // Elevation commands
            is_elevated,
            restart_elevated,
            // Node management commands - Status & Config
            node::commands::get_node_mode,
            node::commands::set_node_mode,
            node::commands::get_node_status,
            node::commands::get_node_config,
            node::commands::set_node_config,
            node::commands::get_node_paths,
            node::commands::preview_bitcoin_conf,
            node::commands::get_download_progress,
            // Node management commands - Process
            node::commands::is_node_running,
            node::commands::is_node_installed,
            node::commands::is_first_launch_complete,
            node::commands::get_installed_node_version,
            node::commands::start_managed_node,
            node::commands::stop_managed_node,
            node::commands::wait_for_node_exit,
            node::commands::restart_managed_node,
            node::commands::detect_existing_node,
            node::commands::refresh_node_status,
            // Node management commands - Download & Update
            node::commands::fetch_latest_node_release,
            node::commands::fetch_all_node_releases,
            node::commands::fetch_asset_sha256,
            node::commands::get_platform_arch,
            node::commands::check_node_update,
            node::commands::download_and_install_from_asset,
            node::commands::cancel_node_download,
            // Node management commands - Network & Reset
            node::commands::set_node_network,
            node::commands::get_node_network,
            node::commands::reset_node_config,
            node::commands::uninstall_node,
            // Node management commands - RPC & Lifecycle
            node::commands::wait_for_node_ready,
            node::commands::is_node_ready,
            node::commands::stop_node_gracefully,
            // ===== Mining + aggregator commands (mining build flavor only) =====
            // Each entry is `#[cfg(feature = "mining")]`-gated so the pure
            // wallet-only flavor does not register (or reference) any mining
            // command — the mining/aggregator modules aren't compiled there.
            // Mining device commands
            #[cfg(feature = "mining")]
            mining::commands::detect_mining_devices,
            // Mining drive commands
            #[cfg(feature = "mining")]
            mining::commands::list_plot_drives,
            #[cfg(feature = "mining")]
            mining::commands::get_plot_drive_info,
            #[cfg(feature = "mining")]
            mining::commands::delete_orphan_file,
            // Mining state commands
            #[cfg(feature = "mining")]
            mining::commands::get_mining_state,
            #[cfg(feature = "mining")]
            mining::commands::get_mining_config,
            #[cfg(feature = "mining")]
            mining::commands::save_mining_config,
            // Chain configuration commands
            #[cfg(feature = "mining")]
            mining::commands::add_chain_config,
            #[cfg(feature = "mining")]
            mining::commands::update_chain_config,
            #[cfg(feature = "mining")]
            mining::commands::remove_chain_config,
            #[cfg(feature = "mining")]
            mining::commands::reorder_chain_priorities,
            // Drive configuration commands
            #[cfg(feature = "mining")]
            mining::commands::add_drive_config,
            #[cfg(feature = "mining")]
            mining::commands::update_drive_config,
            #[cfg(feature = "mining")]
            mining::commands::remove_drive_config,
            // CPU configuration commands
            #[cfg(feature = "mining")]
            mining::commands::update_cpu_config,
            // Plotter device commands
            #[cfg(feature = "mining")]
            mining::commands::update_plotter_device,
            // Mining control commands
            #[cfg(feature = "mining")]
            mining::commands::start_mining,
            #[cfg(feature = "mining")]
            mining::commands::stop_mining,
            // Benchmark commands
            #[cfg(feature = "mining")]
            mining::commands::run_device_benchmark,
            // Reset command
            #[cfg(feature = "mining")]
            mining::commands::reset_mining_config,
            // Deadline commands
            #[cfg(feature = "mining")]
            mining::commands::get_recent_deadlines,
            // Address validation commands
            #[cfg(feature = "mining")]
            mining::commands::validate_pocx_address,
            #[cfg(feature = "mining")]
            mining::commands::get_address_info,
            #[cfg(feature = "mining")]
            mining::commands::hex_to_bech32,
            // Plotter state commands
            #[cfg(feature = "mining")]
            mining::commands::get_plotter_state,
            #[cfg(feature = "mining")]
            mining::commands::is_plotter_running,
            #[cfg(feature = "mining")]
            mining::commands::get_stop_type,
            // Plot plan commands
            #[cfg(feature = "mining")]
            mining::commands::get_plot_plan,
            #[cfg(feature = "mining")]
            mining::commands::set_plot_plan,
            #[cfg(feature = "mining")]
            mining::commands::clear_plot_plan,
            #[cfg(feature = "mining")]
            mining::commands::start_plot_plan,
            #[cfg(feature = "mining")]
            mining::commands::soft_stop_plot_plan,
            #[cfg(feature = "mining")]
            mining::commands::hard_stop_plot_plan,
            #[cfg(feature = "mining")]
            mining::commands::advance_plot_plan,
            // Plotter execution commands
            #[cfg(feature = "mining")]
            mining::commands::execute_plot_item,
            #[cfg(feature = "mining")]
            mining::commands::execute_plot_batch,
            // Aggregator commands
            #[cfg(feature = "mining")]
            aggregator::commands::get_aggregator_config,
            #[cfg(feature = "mining")]
            aggregator::commands::save_aggregator_config,
            #[cfg(feature = "mining")]
            aggregator::commands::start_aggregator,
            #[cfg(feature = "mining")]
            aggregator::commands::stop_aggregator,
            #[cfg(feature = "mining")]
            aggregator::commands::is_aggregator_running,
            #[cfg(feature = "mining")]
            aggregator::commands::get_aggregator_status,
            #[cfg(feature = "mining")]
            aggregator::commands::get_aggregator_stats,
            // ===== Nodeless BTCX wallet commands (wallet build flavor only) =====
            // Each entry is `#[cfg(feature = "wallet")]`-gated so the pure
            // mining-only flavor does not register any wallet command — the
            // btcx_wallet backend isn't compiled there.
            // Status & Seed
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_status,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_generate_mnemonic,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_create,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_restore,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_reprobe,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_rescan_legacy,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_import_descriptor,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_validate_import,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_unlock,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_lock,
            // Named-wallet registry
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_list,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_list_grouped,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_group_sync,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_select,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_close,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_delete,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_delete_group,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_rename,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_rename_group,
            // Operations
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_new_address,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_current_address,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_balance,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_transactions,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_tx_probe,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_tx_detail,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_send,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_bumpfee,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_fee_estimates,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_broadcast_tx,
            // Config & Sync
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_get_config,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_set_config,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_sync_now,
            // Forging assignments
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_create_assignment,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_revoke_assignment,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_get_assignment,
            // PSBT operations
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_psbt_decode,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_psbt_analyze,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_psbt_wallet_process,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_psbt_finalize,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_psbt_combine,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_create_funded_psbt,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_wallet_utxos,
            // Electrum health & chain info
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_electrum_health,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_electrum_probe,
            #[cfg(feature = "wallet")]
            btcx_wallet::commands::btcx_chain_info,
            write_text_file,
            write_binary_file,
            // Update commands
            update::get_app_version,
            update::check_wallet_update,
            // Clock-drift command
            time::commands::check_clock_drift,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
