use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Manager;

// Logging module
mod logging;

// Mining module
pub mod mining;

// Node management module
pub mod node;

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
    let base_path = PathBuf::from(&expanded_dir);

    if network == "mainnet" {
        return base_path.join(".cookie");
    }

    // For testnet, Bitcoin Core uses "testnet3" folder (for testnet v3)
    // Try testnet3 first, then fall back to testnet
    if network == "testnet" {
        let testnet3_cookie = base_path.join("testnet3").join(".cookie");
        if testnet3_cookie.exists() {
            return testnet3_cookie;
        }
        // Fall back to testnet folder
        let testnet_cookie = base_path.join("testnet").join(".cookie");
        if testnet_cookie.exists() {
            return testnet_cookie;
        }
        // Default to testnet3 (most common)
        return testnet3_cookie;
    }

    // regtest uses regtest folder
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

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux", target_os = "android")))]
    return "unknown".to_string();
}

/// Check if running in development mode
#[tauri::command]
fn is_dev() -> bool {
    cfg!(debug_assertions)
}

/// Get the launch mode (wallet or mining-only)
/// Returns "mining" if --mining-only or -m flag is passed, otherwise "wallet"
/// On Android, always returns "mining" (no node support on mobile)
#[tauri::command]
fn get_launch_mode() -> String {
    // Android is always mining-only (no local node support)
    #[cfg(target_os = "android")]
    return "mining".to_string();

    #[cfg(not(target_os = "android"))]
    {
        if std::env::args().any(|arg| arg == "--mining-only" || arg == "-m") {
            "mining".to_string()
        } else {
            "wallet".to_string()
        }
    }
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

        // Convert paths to wide strings for Windows API
        let exe_wide: Vec<u16> = OsStr::new(exe_path.as_os_str())
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let verb_wide: Vec<u16> = OsStr::new("runas")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        // Use ShellExecuteW to restart with elevation
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                ptr::null_mut(),
                verb_wide.as_ptr(),
                exe_wide.as_ptr(),
                ptr::null(),
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
        .item(
            &MenuItemBuilder::with_id("documentation", "Bitcoin PoCX Documentation")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("report_suggestion", "Report A Suggestion")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("report_issue", "Report An Issue")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("check_update", "Check for Update")
                .build(app)?,
        )
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
    // Log files go to: {app_data}/com.pocx.phoenix/logs/phoenix.1.log
    let log_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.pocx.phoenix")
        .join("logs");

    if let Err(e) = logging::init_logger(log_dir.clone()) {
        eprintln!("Failed to initialize logger: {}. Log dir: {:?}", e, log_dir);
    }

    // Create shared mining state
    let mining_state = mining::state::create_mining_state();

    // Create shared plotter runtime (for task management)
    let plotter_runtime = mining::create_plotter_runtime();

    // Create shared node state and manager
    let node_state = node::create_node_state();
    let node_manager = node::NodeManager::new();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init());

    // Desktop-only plugins
    #[cfg(not(target_os = "android"))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    // Android-only plugins
    #[cfg(target_os = "android")]
    {
        builder = builder
            .plugin(tauri_plugin_android_fs::init())
            .plugin(tauri_plugin_storage_permission::init());
    }

    builder = builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mining.db", include_migrations())
                .build(),
        )
        .manage(mining_state)
        .manage(plotter_runtime)
        .manage(node_state)
        .manage(node_manager)
        .setup(|app| {
            // Set app handle for TauriEventAppender (log forwarding to frontend)
            logging::set_app_handle(app.handle().clone());

            // Create and set application menu (desktop only - no menu on mobile)
            #[cfg(not(target_os = "android"))]
            {
                let menu = create_menu(app)?;
                app.set_menu(menu)?;
            }

            // Register miner callback for mining events (with state for deadline persistence)
            let state = app.state::<mining::state::SharedMiningState>().inner().clone();
            mining::callback::TauriMinerCallback::register(app.handle().clone(), state);

            // Set window title based on launch mode (desktop only)
            #[cfg(not(target_os = "android"))]
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
    #[cfg(not(target_os = "android"))]
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
                        let _ = window.eval(&format!(r#"
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
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval(
                            r#"
                            (async () => {
                                try {
                                    const { check } = await import('@tauri-apps/plugin-updater');
                                    const update = await check();
                                    if (update) {
                                        if (confirm('A new version (' + update.version + ') is available!\n\nWould you like to download it now?')) {
                                            window.open('https://github.com/PoC-Consortium/phoenix-pocx/releases/latest', '_blank');
                                        }
                                    } else {
                                        alert('You are running the latest version.');
                                    }
                                } catch (e) {
                                    console.error('Update check failed:', e);
                                    alert('Could not check for updates.\n\nPlease visit https://github.com/PoC-Consortium/phoenix-pocx/releases to check manually.');
                                }
                            })();
                            "#,
                        );
                    }
                }
                "about" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval(
                            r#"
                            alert('Phoenix PoCX Wallet v2.0.0\n\nA secure and easy-to-use wallet for Bitcoin-PoCX.\n\nhttps://www.bitcoin-pocx.org\n\n© 2025 The Proof of Capacity Consortium');
                            "#,
                        );
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
            node::commands::get_installed_node_version,
            node::commands::start_managed_node,
            node::commands::stop_managed_node,
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
            // Mining device commands
            mining::commands::detect_mining_devices,
            // Mining drive commands
            mining::commands::list_plot_drives,
            mining::commands::get_plot_drive_info,
            // Mining state commands
            mining::commands::get_mining_state,
            mining::commands::get_mining_config,
            mining::commands::save_mining_config,
            // Chain configuration commands
            mining::commands::add_chain_config,
            mining::commands::update_chain_config,
            mining::commands::remove_chain_config,
            mining::commands::reorder_chain_priorities,
            // Drive configuration commands
            mining::commands::add_drive_config,
            mining::commands::update_drive_config,
            mining::commands::remove_drive_config,
            // CPU configuration commands
            mining::commands::update_cpu_config,
            // Plotter device commands
            mining::commands::update_plotter_device,
            // Mining control commands
            mining::commands::start_mining,
            mining::commands::stop_mining,
            // Benchmark commands
            mining::commands::run_device_benchmark,
            // Reset command
            mining::commands::reset_mining_config,
            // Deadline commands
            mining::commands::get_recent_deadlines,
            // Address validation commands
            mining::commands::validate_pocx_address,
            mining::commands::get_address_info,
            mining::commands::hex_to_bech32,
            // Plotter state commands
            mining::commands::get_plotter_state,
            mining::commands::is_plotter_running,
            mining::commands::get_stop_type,
            // Plot plan commands
            mining::commands::get_plot_plan,
            mining::commands::set_plot_plan,
            mining::commands::clear_plot_plan,
            mining::commands::start_plot_plan,
            mining::commands::soft_stop_plot_plan,
            mining::commands::hard_stop_plot_plan,
            mining::commands::advance_plot_plan,
            // Plotter execution commands
            mining::commands::execute_plot_item,
            mining::commands::execute_plot_batch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
