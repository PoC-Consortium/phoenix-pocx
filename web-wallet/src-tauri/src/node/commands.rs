//! Tauri commands for node management
//!
//! These commands are exposed to the frontend for controlling the managed node.

use super::config::{NodeConfig, NodeMode, NodePaths};
use tauri::Emitter;
use super::downloader::{
    self, check_for_update, fetch_all_releases, fetch_latest_release, fetch_sha256sums,
    find_hash_for_file, ReleaseInfo, UpdateInfo,
};
use super::extractor::{cleanup_archive, extract_bitcoind, get_download_dir};
use super::hasher::verify_file_hash;
use super::manager::NodeManager;
use super::state::{DownloadProgress, DownloadStage, NodeStatus, SharedNodeState};
use tauri::{AppHandle, State};

// ============================================================================
// Status & Configuration Commands
// ============================================================================

/// Get the current node mode (managed or external)
#[tauri::command]
pub fn get_node_mode(state: State<'_, SharedNodeState>) -> NodeMode {
    state.get_config().mode
}

/// Set the node mode (managed or external)
#[tauri::command]
pub fn set_node_mode(mode: NodeMode, state: State<'_, SharedNodeState>) -> Result<(), String> {
    let mut config = state.get_config();
    config.mode = mode;
    state.set_config(config)
}

/// Get the current node status
#[tauri::command]
pub fn get_node_status(state: State<'_, SharedNodeState>) -> NodeStatus {
    state.get_status()
}

/// Get the full node configuration
#[tauri::command]
pub fn get_node_config(state: State<'_, SharedNodeState>) -> NodeConfig {
    state.get_config()
}

/// Save the node configuration
#[tauri::command]
pub fn set_node_config(config: NodeConfig, state: State<'_, SharedNodeState>) -> Result<(), String> {
    state.set_config(config)
}

/// Get all node-related paths
#[tauri::command]
pub fn get_node_paths(state: State<'_, SharedNodeState>) -> NodePaths {
    state.get_paths()
}

/// Preview bitcoin.conf content without saving
#[tauri::command]
pub fn preview_bitcoin_conf(state: State<'_, SharedNodeState>) -> String {
    state.get_config().generate_bitcoin_conf()
}

/// Get download progress
#[tauri::command]
pub fn get_download_progress(state: State<'_, SharedNodeState>) -> Option<DownloadProgress> {
    state.get_download_progress()
}

// ============================================================================
// Process Management Commands
// ============================================================================

/// Check if a bitcoind process is currently running
#[tauri::command]
pub fn is_node_running() -> bool {
    NodeManager::is_node_running()
}

/// Check if bitcoind binary is installed
#[tauri::command]
pub fn is_node_installed(state: State<'_, SharedNodeState>) -> bool {
    state.is_installed()
}

/// Get the installed node version
#[tauri::command]
pub fn get_installed_node_version(state: State<'_, SharedNodeState>) -> Option<String> {
    state.get_installed_version()
}

/// Start the managed node
#[tauri::command]
pub fn start_managed_node(
    state: State<'_, SharedNodeState>,
    manager: State<'_, NodeManager>,
    app: AppHandle,
) -> Result<u32, String> {
    manager.start(&state, &app)
}

/// Stop the managed node
#[tauri::command]
pub fn stop_managed_node(
    state: State<'_, SharedNodeState>,
    manager: State<'_, NodeManager>,
    app: AppHandle,
) -> Result<(), String> {
    manager.stop(&state, &app)
}

/// Restart the managed node
#[tauri::command]
pub fn restart_managed_node(
    state: State<'_, SharedNodeState>,
    manager: State<'_, NodeManager>,
    app: AppHandle,
) -> Result<u32, String> {
    manager.restart(&state, &app)
}

/// Detect if a node is already running (for crash recovery)
#[tauri::command]
pub fn detect_existing_node(state: State<'_, SharedNodeState>) -> Option<u32> {
    NodeManager::detect_existing_node(&state)
}

/// Refresh node status (check process, will be extended for RPC later)
#[tauri::command]
pub fn refresh_node_status(
    state: State<'_, SharedNodeState>,
    _manager: State<'_, NodeManager>,
    app: AppHandle,
) -> NodeStatus {
    NodeManager::refresh_status(&state, &app)
}

// ============================================================================
// Download & Update Commands
// ============================================================================

/// Fetch the latest release from GitHub
#[tauri::command]
pub async fn fetch_latest_node_release() -> Result<ReleaseInfo, String> {
    fetch_latest_release().await
}

/// Fetch all releases from GitHub
#[tauri::command]
pub async fn fetch_all_node_releases() -> Result<Vec<ReleaseInfo>, String> {
    fetch_all_releases().await
}

/// Fetch SHA256 hash for a specific release asset
#[tauri::command]
pub async fn fetch_asset_sha256(tag: String, asset_name: String) -> Result<String, String> {
    // Fetch the release by tag
    let releases = fetch_all_releases().await?;
    let release = releases
        .into_iter()
        .find(|r| r.tag == tag)
        .ok_or_else(|| format!("Release {} not found", tag))?;

    // Fetch SHA256SUMS
    let sha256sums = fetch_sha256sums(&release).await?;

    // Find hash for the asset
    find_hash_for_file(&sha256sums, &asset_name)
        .ok_or_else(|| format!("Hash not found for {}", asset_name))
}

/// Get the platform architecture string
#[tauri::command]
pub fn get_platform_arch() -> String {
    #[cfg(target_arch = "x86_64")]
    { "x86_64".to_string() }

    #[cfg(target_arch = "aarch64")]
    { "aarch64 (ARM64)".to_string() }

    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    { "unknown".to_string() }
}

/// Check for node updates
#[tauri::command]
pub async fn check_node_update(state: State<'_, SharedNodeState>) -> Result<UpdateInfo, String> {
    check_for_update(&state).await
}

/// Download and install the node from a specific asset
/// Frontend passes the asset info directly - no need to re-fetch release
#[tauri::command]
pub async fn download_and_install_from_asset(
    version: String,
    download_url: String,
    file_name: String,
    expected_hash: Option<String>,
    state: State<'_, SharedNodeState>,
    app: AppHandle,
) -> Result<String, String> {
    log::info!("Installing node version {} from {}", version, file_name);

    // Download the archive
    let download_dir = get_download_dir();
    let archive_path = download_dir.join(&file_name);

    downloader::download_file(&download_url, archive_path.clone(), &state, &app).await?;

    // Verify hash if provided
    if let Some(ref hash) = expected_hash {
        state.update_download_progress(|p| p.stage = DownloadStage::Verifying);
        let _ = app.emit("node:download-progress", state.get_download_progress());

        let hash_result = verify_file_hash(&archive_path, hash)?;
        if !hash_result.matches {
            // Clean up and fail
            let _ = cleanup_archive(&archive_path);
            state.set_download_progress(Some(DownloadProgress {
                stage: DownloadStage::Failed,
                ..Default::default()
            }));
            let _ = app.emit(
                "node:error",
                serde_json::json!({
                    "message": "Hash verification failed",
                    "expected": hash,
                    "computed": hash_result.computed
                }),
            );
            return Err(format!(
                "Hash verification failed. Expected: {}, Got: {}",
                hash, hash_result.computed
            ));
        }
        log::info!("Hash verification passed");
    } else {
        log::warn!("No hash provided, skipping verification");
    }

    // Extract bitcoind
    extract_bitcoind(&archive_path, &state, &app)?;

    // Clean up archive
    let _ = cleanup_archive(&archive_path);

    // Update installed version
    state.set_installed_version(Some(version.clone()));

    // Clear download progress
    state.set_download_progress(None);

    // Emit completion event
    let _ = app.emit(
        "node:installed",
        serde_json::json!({ "version": version }),
    );

    log::info!("Node {} installed successfully", version);

    Ok(version)
}

/// Cancel ongoing download
#[tauri::command]
pub fn cancel_node_download(state: State<'_, SharedNodeState>) {
    // Mark as cancelled
    state.set_download_progress(Some(DownloadProgress {
        stage: DownloadStage::Failed,
        ..Default::default()
    }));

    // Clean up any partial downloads
    let download_dir = get_download_dir();
    if let Ok(entries) = std::fs::read_dir(&download_dir) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

// ============================================================================
// Network Commands
// ============================================================================

/// Set the network (mainnet, testnet, regtest)
#[tauri::command]
pub fn set_node_network(
    network: String,
    state: State<'_, SharedNodeState>,
) -> Result<(), String> {
    let mut config = state.get_config();
    config.network = network.parse().unwrap_or_default();
    state.set_config(config)
}

/// Get the current network
#[tauri::command]
pub fn get_node_network(state: State<'_, SharedNodeState>) -> String {
    state.get_config().network.as_str().to_string()
}

/// Reset node configuration to defaults
#[tauri::command]
pub fn reset_node_config(state: State<'_, SharedNodeState>) -> Result<(), String> {
    state.reset_to_defaults()
}

/// Wait for the node to be ready (RPC responding)
/// Returns Ok(()) when ready, or error if timeout
#[tauri::command]
pub async fn wait_for_node_ready(
    timeout_secs: Option<u64>,
    state: State<'_, SharedNodeState>,
) -> Result<(), String> {
    let config = state.get_config();
    let timeout = timeout_secs.unwrap_or(60); // Default 60 second timeout
    super::rpc::wait_for_node_ready(&config, timeout).await
}

/// Check if the node RPC is responding
#[tauri::command]
pub async fn is_node_ready(state: State<'_, SharedNodeState>) -> Result<bool, String> {
    let config = state.get_config();
    let client = super::rpc::NodeRpcClient::from_config(&config);
    Ok(client.is_ready().await)
}

/// Stop the node gracefully via RPC
#[tauri::command]
pub async fn stop_node_gracefully(
    state: State<'_, SharedNodeState>,
    app: AppHandle,
) -> Result<(), String> {
    let config = state.get_config();

    // Emit stopping event
    let _ = app.emit("node:stopping", ());

    // Send RPC stop command
    super::rpc::stop_node_gracefully(&config).await?;

    // Wait a bit for the process to exit
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    // Update state
    state.set_managed_pid(None);
    state.update_status(|s| {
        s.running = false;
        s.pid = None;
        s.peers = 0;
    });

    // Emit stopped event
    let _ = app.emit("node:stopped", ());

    Ok(())
}

/// Uninstall the managed node (stop node, delete binary, and reset config)
#[tauri::command]
pub async fn uninstall_node(state: State<'_, SharedNodeState>) -> Result<(), String> {
    let config = state.get_config();

    // Only stop the node if we're in managed mode - never stop external nodes!
    if config.mode == NodeMode::Managed && NodeManager::is_node_running() {
        log::info!("Managed node is running, stopping before uninstall...");

        // Send RPC stop command
        if let Err(e) = super::rpc::stop_node_gracefully(&config).await {
            log::warn!("RPC stop failed (node may not be responding): {}", e);
        }

        // Wait for the node to actually stop (poll every 500ms, max 30 seconds)
        let max_attempts = 60;
        let mut attempts = 0;
        while attempts < max_attempts && NodeManager::is_node_running() {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            attempts += 1;
        }

        if NodeManager::is_node_running() {
            log::warn!("Node did not stop within timeout, proceeding with uninstall anyway");
        } else {
            log::info!("Node stopped after {} attempts", attempts);
        }
    }

    // Delete the bitcoind binary if it exists
    let bitcoind_path = NodeConfig::bitcoind_path();
    if bitcoind_path.exists() {
        std::fs::remove_file(&bitcoind_path)
            .map_err(|e| format!("Failed to delete bitcoind: {}", e))?;
        log::info!("Deleted bitcoind at {}", bitcoind_path.display());
    }

    // Also clean up the managed node directory
    let node_dir = NodeConfig::managed_node_dir();
    if node_dir.exists() {
        // Only remove files, keep the directory structure
        if let Ok(entries) = std::fs::read_dir(&node_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }

    // Reset config to defaults
    state.reset_to_defaults()?;

    // Update status to reflect uninstalled state
    state.update_status(|s| {
        s.installed = false;
        s.version = None;
    });

    log::info!("Node uninstalled successfully");
    Ok(())
}
