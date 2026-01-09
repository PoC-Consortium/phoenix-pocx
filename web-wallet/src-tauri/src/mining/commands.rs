//! Tauri command handlers for mining operations
//!
//! These commands are exposed to the Angular frontend via Tauri's invoke system.

use super::callback::TauriPlotterCallback;
use super::devices::{detect_devices, DeviceInfo};
use super::drives::{get_drive_info, list_drives, DriveInfo};
use super::plotter::{self, PlotExecutionResult, PlotPlan, PlotterState, SharedPlotterRuntime, StopType};
use super::state::{
    get_config_file_path, save_config, ChainConfig, CpuConfig, DeadlineEntry, DriveConfig,
    MiningConfig, MiningState, MiningStatus, PlotPlanItem,
    PlotterDeviceConfig, PlottingStatus, SharedMiningState,
};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Build cookie file path from wallet settings
///
/// Constructs the full path to the Bitcoin Core cookie file based on
/// the wallet data directory and network settings. The miner will
/// read the cookie file itself.
fn build_cookie_path(data_directory: &str, network: &str) -> Option<String> {
    if data_directory.is_empty() {
        log::warn!("Wallet data directory not configured for solo mining");
        return None;
    }

    // Expand path (similar to lib.rs expand_path)
    let mut expanded = data_directory.to_string();
    #[cfg(windows)]
    {
        // Expand %VAR% style environment variables on Windows
        while let Some(start) = expanded.find('%') {
            if let Some(end) = expanded[start + 1..].find('%') {
                let var_name = &expanded[start + 1..start + 1 + end];
                if let Ok(value) = std::env::var(var_name) {
                    expanded = format!("{}{}{}", &expanded[..start], value, &expanded[start + 2 + end..]);
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
        if expanded.starts_with("~/") {
            if let Some(home) = dirs::home_dir() {
                expanded = format!("{}{}", home.display(), &expanded[1..]);
            }
        } else if expanded == "~" {
            if let Some(home) = dirs::home_dir() {
                expanded = home.to_string_lossy().to_string();
            }
        }
    }

    // Build cookie path
    let mut path = PathBuf::from(expanded);
    if network == "mainnet" {
        path.push(".cookie");
    } else {
        // testnet or regtest - cookie is in subdirectory
        path.push(network);
        path.push(".cookie");
    }

    Some(path.to_string_lossy().to_string())
}

/// Result wrapper for commands
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> CommandResult<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error.into()),
        }
    }
}

// ============================================================================
// Device Detection Commands
// ============================================================================

/// Detect all available devices (CPU, GPU, memory)
#[tauri::command]
pub fn detect_mining_devices() -> CommandResult<DeviceInfo> {
    CommandResult::ok(detect_devices())
}

// ============================================================================
// Drive Detection Commands
// ============================================================================

/// List all available drives for plotting
#[tauri::command]
pub fn list_plot_drives() -> CommandResult<Vec<DriveInfo>> {
    log::info!("Scanning drives...");
    CommandResult::ok(list_drives())
}

/// Get drive info for a specific path
#[tauri::command]
pub fn get_plot_drive_info(path: String) -> CommandResult<DriveInfo> {
    log::info!("Scanning drive: {}", path);
    match get_drive_info(&path) {
        Some(info) => CommandResult::ok(info),
        None => CommandResult::err(format!("Drive not found for path: {}", path)),
    }
}

// ============================================================================
// Mining State Commands
// ============================================================================

/// Get current mining state
///
/// Returns config and basic state. For plotter-specific state (plan, progress),
/// use get_plotter_state instead.
#[tauri::command]
pub fn get_mining_state(
    state: State<SharedMiningState>,
) -> CommandResult<MiningState> {
    log::debug!("[CMD] get_mining_state called");
    match state.lock() {
        Ok(state) => CommandResult::ok(state.clone()),
        Err(e) => CommandResult::err(format!("Failed to get mining state: {}", e)),
    }
}

/// Get plotter runtime state
///
/// Returns the current state of the plotter including:
/// - running: whether plotter is active
/// - stop_type: none | soft | hard
/// - plan: current plot plan (if any)
/// - current_index: which item we're on
/// - progress: current plotting progress
#[tauri::command]
pub fn get_plotter_state(
    plotter_runtime: State<SharedPlotterRuntime>,
) -> CommandResult<PlotterState> {
    let state = plotter_runtime.get_state();
    log::info!("[CMD] get_plotter_state: running={}, stop_type={:?}, plan_items={}, current_index={}",
        state.running,
        state.stop_type,
        state.plan.as_ref().map(|p| p.items.len()).unwrap_or(0),
        state.current_index);
    CommandResult::ok(state)
}

/// Get mining configuration
#[tauri::command]
pub fn get_mining_config(state: State<SharedMiningState>) -> CommandResult<MiningConfig> {
    match state.lock() {
        Ok(state) => CommandResult::ok(state.config.clone()),
        Err(e) => CommandResult::err(format!("Failed to get mining config: {}", e)),
    }
}

/// Save mining configuration
#[tauri::command]
pub fn save_mining_config(
    config: MiningConfig,
    state: State<SharedMiningState>,
) -> CommandResult<()> {
    // Save to file first
    if let Err(e) = save_config(&config, "mining config saved") {
        return CommandResult::err(format!("Failed to save config to file: {}", e));
    }

    // Then update in-memory state
    match state.lock() {
        Ok(mut state) => {
            state.config = config;
            state.is_configured = true;
            CommandResult::ok(())
        }
        Err(e) => CommandResult::err(format!("Failed to save mining config: {}", e)),
    }
}

// ============================================================================
// Chain Configuration Commands
// ============================================================================

/// Add a chain configuration
#[tauri::command]
pub fn add_chain_config(
    chain: ChainConfig,
    state: State<SharedMiningState>,
) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            // Check for duplicate
            if state.config.chains.iter().any(|c| c.id == chain.id) {
                return CommandResult::err(format!("Chain with id {} already exists", chain.id));
            }
            state.config.chains.push(chain);
            CommandResult::ok(())
        }
        Err(e) => CommandResult::err(format!("Failed to add chain: {}", e)),
    }
}

/// Update a chain configuration
#[tauri::command]
pub fn update_chain_config(
    chain: ChainConfig,
    state: State<SharedMiningState>,
) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            if let Some(existing) = state.config.chains.iter_mut().find(|c| c.id == chain.id) {
                *existing = chain;
                CommandResult::ok(())
            } else {
                CommandResult::err(format!("Chain with id {} not found", chain.id))
            }
        }
        Err(e) => CommandResult::err(format!("Failed to update chain: {}", e)),
    }
}

/// Remove a chain configuration
#[tauri::command]
pub fn remove_chain_config(id: String, state: State<SharedMiningState>) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            let len_before = state.config.chains.len();
            state.config.chains.retain(|c| c.id != id);
            if state.config.chains.len() < len_before {
                CommandResult::ok(())
            } else {
                CommandResult::err(format!("Chain with id {} not found", id))
            }
        }
        Err(e) => CommandResult::err(format!("Failed to remove chain: {}", e)),
    }
}

/// Reorder chain priorities
#[tauri::command]
pub fn reorder_chain_priorities(
    chain_ids: Vec<String>,
    state: State<SharedMiningState>,
) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            for (priority, id) in chain_ids.iter().enumerate() {
                if let Some(chain) = state.config.chains.iter_mut().find(|c| c.id == *id) {
                    chain.priority = priority as u32;
                }
            }
            // Sort by priority
            state.config.chains.sort_by_key(|c| c.priority);
            CommandResult::ok(())
        }
        Err(e) => CommandResult::err(format!("Failed to reorder chains: {}", e)),
    }
}

// ============================================================================
// Drive Configuration Commands
// ============================================================================

/// Add a drive configuration
#[tauri::command]
pub fn add_drive_config(
    drive: DriveConfig,
    state: State<SharedMiningState>,
) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            // Check for duplicate
            if state.config.drives.iter().any(|d| d.path == drive.path) {
                return CommandResult::err(format!("Drive {} already configured", drive.path));
            }
            state.config.drives.push(drive);
            CommandResult::ok(())
        }
        Err(e) => CommandResult::err(format!("Failed to add drive: {}", e)),
    }
}

/// Update a drive configuration
#[tauri::command]
pub fn update_drive_config(
    drive: DriveConfig,
    state: State<SharedMiningState>,
) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            if let Some(existing) = state.config.drives.iter_mut().find(|d| d.path == drive.path) {
                *existing = drive;
                CommandResult::ok(())
            } else {
                CommandResult::err(format!("Drive {} not found", drive.path))
            }
        }
        Err(e) => CommandResult::err(format!("Failed to update drive: {}", e)),
    }
}

/// Remove a drive configuration
#[tauri::command]
pub fn remove_drive_config(path: String, state: State<SharedMiningState>) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            let len_before = state.config.drives.len();
            state.config.drives.retain(|d| d.path != path);
            if state.config.drives.len() < len_before {
                CommandResult::ok(())
            } else {
                CommandResult::err(format!("Drive {} not found", path))
            }
        }
        Err(e) => CommandResult::err(format!("Failed to remove drive: {}", e)),
    }
}

// ============================================================================
// CPU Configuration Commands
// ============================================================================

/// Update CPU configuration
#[tauri::command]
pub fn update_cpu_config(
    config: CpuConfig,
    state: State<SharedMiningState>,
) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            state.config.cpu_config = config;
            CommandResult::ok(())
        }
        Err(e) => CommandResult::err(format!("Failed to update CPU config: {}", e)),
    }
}

// ============================================================================
// Plotter Device Configuration Commands
// ============================================================================

/// Update plotter device configuration
#[tauri::command]
pub fn update_plotter_device(
    device: PlotterDeviceConfig,
    state: State<SharedMiningState>,
) -> CommandResult<()> {
    match state.lock() {
        Ok(mut state) => {
            if let Some(existing) = state
                .config
                .plotter_devices
                .iter_mut()
                .find(|d| d.device_id == device.device_id)
            {
                *existing = device;
            } else {
                state.config.plotter_devices.push(device);
            }
            CommandResult::ok(())
        }
        Err(e) => CommandResult::err(format!("Failed to update plotter device: {}", e)),
    }
}

// ============================================================================
// Mining Control Commands
// ============================================================================

/// Start mining
#[tauri::command]
pub async fn start_mining(
    app_handle: AppHandle,
    state: State<'_, SharedMiningState>,
) -> Result<CommandResult<()>, ()> {
    // Clear any previous stop request
    pocx_miner::clear_stop_request();

    // Register miner callback to emit events to frontend (with state for deadline persistence)
    super::callback::TauriMinerCallback::register(app_handle, state.inner().clone());

    // Get config and validate
    let config = {
        let state_guard = match state.lock() {
            Ok(guard) => guard,
            Err(e) => return Ok(CommandResult::err(format!("Failed to lock state: {}", e))),
        };

        if state_guard.mining_status != MiningStatus::Stopped {
            return Ok(CommandResult::err("Mining is already running"));
        }

        if state_guard.config.chains.is_empty() {
            return Ok(CommandResult::err("No chains configured"));
        }

        if state_guard.config.drives.is_empty() {
            return Ok(CommandResult::err("No drives configured"));
        }

        state_guard.config.clone()
    };

    // Update state to starting
    if let Ok(mut state_guard) = state.lock() {
        state_guard.mining_status = MiningStatus::Starting;
    }

    // Build chains from config
    let mut chains = Vec::new();
    for chain_config in &config.chains {
        if !chain_config.enabled {
            continue;
        }

        // Map transport
        let rpc_transport = match chain_config.rpc_transport {
            super::state::RpcTransport::Http => pocx_miner::RpcTransport::Http,
            super::state::RpcTransport::Https => pocx_miner::RpcTransport::Https,
        };

        // Map auth - for cookie auth with no explicit path, use wallet settings to build path
        let rpc_auth = match &chain_config.rpc_auth {
            super::state::RpcAuth::None => pocx_miner::RpcAuth::None,
            super::state::RpcAuth::UserPass { username, password } => {
                pocx_miner::RpcAuth::UserPass {
                    username: username.clone(),
                    password: password.clone(),
                }
            }
            super::state::RpcAuth::Cookie { cookie_path } => {
                // Cookie auth: pass cookie path to miner (miner reads the cookie itself)
                let path = if cookie_path.is_some() {
                    // Explicit cookie path provided
                    cookie_path.clone()
                } else {
                    // No explicit path - build from wallet settings
                    build_cookie_path(&config.wallet_data_directory, &config.wallet_network)
                };

                if path.is_some() {
                    log::info!("Chain {}: using cookie path {:?}", chain_config.name, path);
                } else {
                    log::warn!(
                        "Chain {}: cookie auth requires wallet data directory to be configured",
                        chain_config.name
                    );
                }

                pocx_miner::RpcAuth::Cookie { cookie_path: path }
            }
        };

        let submission_mode = match chain_config.mode {
            super::state::SubmissionMode::Solo => pocx_miner::SubmissionMode::Wallet,
            super::state::SubmissionMode::Pool => pocx_miner::SubmissionMode::Pool,
        };

        log::info!(
            "Chain {}: {}://{}:{} auth={:?} mode={:?}",
            chain_config.name,
            match rpc_transport {
                pocx_miner::RpcTransport::Http => "http",
                pocx_miner::RpcTransport::Https => "https",
            },
            chain_config.rpc_host,
            chain_config.rpc_port,
            rpc_auth,
            submission_mode
        );

        let chain = pocx_miner::Chain {
            name: chain_config.name.clone(),
            rpc_transport,
            rpc_host: chain_config.rpc_host.clone(),
            rpc_port: chain_config.rpc_port,
            rpc_auth,
            block_time_seconds: chain_config.block_time_seconds,
            submission_mode,
            target_quality: None,
        };

        chains.push(chain);
    }

    // Build plot directories from enabled drives
    let plot_dirs: Vec<std::path::PathBuf> = config
        .drives
        .iter()
        .filter(|d| d.enabled)
        .map(|d| std::path::PathBuf::from(&d.path))
        .collect();

    // Build miner configuration
    let miner_cfg = pocx_miner::Cfg {
        chains,
        get_mining_info_interval: 1000,
        timeout: 5000,
        plot_dirs,
        hdd_use_direct_io: config.direct_io,
        hdd_wakeup_after: config.hdd_wakeup_seconds as i64,
        hdd_read_cache_in_warps: 16,
        cpu_threads: config.cpu_config.mining_threads as usize,
        cpu_thread_pinning: true,
        show_progress: false, // We use our own UI
        line_progress: false, // We use callbacks
        benchmark: None,
        console_log_level: "Warn".to_string(),
        logfile_log_level: "Info".to_string(),
        logfile_max_count: 5,
        logfile_max_size: 10,
        console_log_pattern: "{m}{n}".to_string(),
        logfile_log_pattern: "{d(%Y-%m-%d %H:%M:%S)} [{l}] {m}{n}".to_string(),
        enable_on_the_fly_compression: config.compression_level > 0,
    };

    // Clone state for the spawned task
    let state_clone = state.inner().clone();

    // Spawn miner in background task
    tokio::spawn(async move {
        log::info!("Miner task starting...");

        // Note: We don't call init_logger here because Tauri already has a logger set up.
        // Log forwarding to Recent Activity happens via structured callbacks (on_new_block, etc.)
        // which are registered via TauriMinerCallback.

        // Update state to idle (scanning will happen automatically)
        if let Ok(mut state_guard) = state_clone.lock() {
            state_guard.mining_status = MiningStatus::Idle;
        }

        let miner = pocx_miner::Miner::new(miner_cfg);
        miner.run().await;

        // When miner stops, update state
        if let Ok(mut state_guard) = state_clone.lock() {
            state_guard.mining_status = MiningStatus::Stopped;
        }

        log::info!("Miner task stopped");
    });

    Ok(CommandResult::ok(()))
}

/// Stop mining
#[tauri::command]
pub async fn stop_mining(state: State<'_, SharedMiningState>) -> Result<CommandResult<()>, ()> {
    log::info!("Stopping miner...");

    // Request miner to stop
    pocx_miner::request_stop();

    // Update state immediately (miner will also update when it stops)
    if let Ok(mut state_guard) = state.lock() {
        state_guard.mining_status = MiningStatus::Stopped;
    }

    Ok(CommandResult::ok(()))
}

// ============================================================================
// Benchmark Commands
// ============================================================================

/// Benchmark result
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkResult {
    pub device_id: String,
    pub threads: u32,
    pub warps: u64,
    pub duration_ms: u64,
    pub mib_per_second: f64,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Run benchmark for a specific device
/// Emits progress events via Tauri event system:
/// - plotter:started - when benchmark starts
/// - plotter:hashing-progress - after each buffer hashed
/// - plotter:writing-progress - after each buffer written
/// - plotter:complete - when benchmark completes
/// - plotter:error - on any error
#[tauri::command]
pub async fn run_device_benchmark(
    app_handle: AppHandle,
    device_id: String,
    threads: u32,
    address: String,
    escalation: Option<u64>,
    zero_copy_buffers: Option<bool>,
) -> Result<CommandResult<BenchmarkResult>, ()> {
    let escalation = escalation.unwrap_or(1).max(1);
    let zcb = zero_copy_buffers.unwrap_or(false);
    // Register callback for progress events
    TauriPlotterCallback::register(app_handle);

    // Create temp directory for benchmark output
    let temp_dir = std::env::temp_dir().join("pocx_benchmark");
    if !temp_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&temp_dir) {
            return Ok(CommandResult::err(format!(
                "Failed to create temp dir: {}",
                e
            )));
        }
    }

    // Build benchmark task: scale warps based on thread count
    // Base rule: 1-8 threads → 1 warp, 9-16 → 2 warps, etc.
    // CPU and APU: use base rule
    // Discrete GPU: use 4x base rule
    let base_warps = ((threads as u64 + 7) / 8).max(1);
    let warps: u64 = if device_id == "cpu" {
        base_warps
    } else {
        // Check if GPU is an APU by looking up device info
        let gpus = super::devices::detect_gpus();
        let is_apu = gpus
            .iter()
            .find(|g| g.id == device_id || device_id.starts_with(&format!("{}:{}:", g.platform_index, g.device_index)))
            .map(|g| g.is_apu)
            .unwrap_or(false);

        if is_apu {
            base_warps // APU uses same rule as CPU
        } else {
            base_warps * 4 // Discrete GPU uses 4x
        }
    };

    let builder_result = if device_id == "cpu" {
        pocx_plotter::PlotterTaskBuilder::new()
            .address(&address)
            .map(|b| {
                b.add_output(temp_dir.to_string_lossy().to_string(), warps, 1)
                    .cpu_threads(threads as u8)
                    .compression(1)
                    .escalate(escalation)
                    .benchmark(true)
                    .quiet(true)
                    .line_progress(false) // Use callbacks instead
                    .direct_io(false)
            })
    } else {
        // GPU: device_id format is "platform:device:cores" e.g. "0:0:60"
        // Replace the cores part with user-specified thread count
        let parts: Vec<&str> = device_id.split(':').collect();
        let gpu_id_with_threads = if parts.len() >= 2 {
            format!("{}:{}:{}", parts[0], parts[1], threads)
        } else {
            device_id.clone()
        };

        pocx_plotter::PlotterTaskBuilder::new()
            .address(&address)
            .map(|b| {
                b.add_output(temp_dir.to_string_lossy().to_string(), warps, 1)
                    .cpu_threads(0) // Disable CPU
                    .gpus(vec![gpu_id_with_threads])
                    .compression(1)
                    .escalate(escalation)
                    .zcb(zcb) // Use setting (auto-set when APU selected)
                    .benchmark(true)
                    .quiet(true)
                    .line_progress(false) // Use callbacks instead
                    .direct_io(false)
            })
    };

    let task = match builder_result {
        Ok(builder) => match builder.build() {
            Ok(task) => task,
            Err(e) => {
                return Ok(CommandResult::err(format!(
                    "Failed to build benchmark task: {}",
                    e
                )));
            }
        },
        Err(e) => {
            return Ok(CommandResult::err(format!("Invalid address: {}", e)));
        }
    };

    // Run plotter in blocking task with panic safety
    let device_id_clone = device_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let start = std::time::Instant::now();
        let res = pocx_plotter::run_plotter_safe(task);
        let duration = start.elapsed();
        (res, duration)
    })
    .await;

    // Handle result
    match result {
        Ok((Ok(()), duration)) => {
            let duration_ms = duration.as_millis() as u64;
            // Calculate MiB/s: 1 warp = 1 GiB = 1024 MiB
            let mib_per_second = if duration_ms > 0 {
                warps as f64 * 1024.0 * 1000.0 / duration_ms as f64
            } else {
                0.0
            };

            Ok(CommandResult::ok(BenchmarkResult {
                device_id: device_id_clone,
                threads,
                warps,
                duration_ms,
                mib_per_second,
                success: true,
                error: None,
            }))
        }
        Ok((Err(e), _)) => Ok(CommandResult::err(format!("Benchmark failed: {}", e))),
        Err(e) => Ok(CommandResult::err(format!("Benchmark task panicked: {}", e)))
    }
}

// ============================================================================
// Reset and Delete Commands
// ============================================================================

/// Reset mining configuration to defaults
#[tauri::command]
pub fn reset_mining_config(state: State<SharedMiningState>) -> CommandResult<()> {
    // Check if plotting is active before allowing reset
    match state.lock() {
        Ok(state_guard) => {
            if let PlottingStatus::Plotting { .. } = &state_guard.plotting_status {
                return CommandResult::err(
                    "Cannot reset while plotting is active. Please stop plotting first."
                        .to_string(),
                );
            }
        }
        Err(e) => {
            return CommandResult::err(format!("Failed to lock state: {}", e));
        }
    }

    // Delete config file if it exists
    if let Some(path) = get_config_file_path() {
        if path.exists() {
            if let Err(e) = std::fs::remove_file(&path) {
                log::warn!("Failed to delete config file: {}", e);
            } else {
                log::info!("Deleted config file: {:?}", path);
            }
        }
    }

    // Reset in-memory state
    match state.lock() {
        Ok(mut state_guard) => {
            state_guard.config = MiningConfig::default();
            state_guard.is_configured = false;
            CommandResult::ok(())
        }
        Err(e) => CommandResult::err(format!("Failed to reset config: {}", e)),
    }
}

// ============================================================================
// Deadline Commands
// ============================================================================

/// Get recent deadlines
#[tauri::command]
pub fn get_recent_deadlines(
    limit: Option<u32>,
    state: State<SharedMiningState>,
) -> CommandResult<Vec<DeadlineEntry>> {
    match state.lock() {
        Ok(state) => {
            let limit = limit.unwrap_or(50) as usize;
            let deadlines: Vec<_> = state.recent_deadlines.iter().take(limit).cloned().collect();
            CommandResult::ok(deadlines)
        }
        Err(e) => CommandResult::err(format!("Failed to get deadlines: {}", e)),
    }
}

// ============================================================================
// Address Validation Commands
// ============================================================================

/// Validate a PoCX address
#[tauri::command]
pub fn validate_pocx_address(address: String) -> CommandResult<bool> {
    match pocx_address::decode_address(&address) {
        Ok(_) => CommandResult::ok(true),
        Err(_) => CommandResult::ok(false),
    }
}

/// Get address info
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressInfo {
    pub valid: bool,
    pub address: String,
    pub payload_hex: String,
    pub network: String,
}

#[tauri::command]
pub fn get_address_info(address: String) -> CommandResult<AddressInfo> {
    match pocx_address::decode_address(&address) {
        Ok((payload, network_id)) => {
            let network = match network_id {
                pocx_address::NetworkId::Base58(version) => format!("Base58 (0x{:02X})", version),
                pocx_address::NetworkId::Bech32(ref hrp) => format!("Bech32 ({})", hrp),
            };

            CommandResult::ok(AddressInfo {
                valid: true,
                address,
                payload_hex: hex::encode(payload),
                network,
            })
        }
        Err(e) => CommandResult::err(format!("Invalid address: {:?}", e)),
    }
}

/// Convert hex payload to bech32 address
/// network: "mainnet", "testnet", or "regtest"
#[tauri::command]
pub fn hex_to_bech32(payload_hex: String, network: String) -> CommandResult<String> {
    // Parse hex payload
    let payload = match hex::decode(&payload_hex) {
        Ok(p) => p,
        Err(e) => return CommandResult::err(format!("Invalid hex: {}", e)),
    };

    // Determine HRP from network
    let hrp = match network.to_lowercase().as_str() {
        "mainnet" => "pocx",
        "testnet" => "tpocx",
        "regtest" => "rpocx",
        _ => return CommandResult::err(format!("Unknown network: {}", network)),
    };

    // Encode to bech32
    let network_id = pocx_address::NetworkId::Bech32(hrp.to_string());
    match pocx_address::encode_address(&payload, network_id) {
        Ok(address) => CommandResult::ok(address),
        Err(e) => CommandResult::err(format!("Failed to encode: {:?}", e)),
    }
}

// ============================================================================
// Plot Plan Commands
// ============================================================================

/// Get the current plot plan from runtime
#[tauri::command]
pub fn get_plot_plan(
    plotter_runtime: State<SharedPlotterRuntime>,
) -> CommandResult<Option<PlotPlan>> {
    log::debug!("[CMD] get_plot_plan called");
    CommandResult::ok(plotter_runtime.get_plan())
}

/// Set a plot plan in runtime (used by frontend after generation)
#[tauri::command]
pub fn set_plot_plan(
    plan: PlotPlan,
    plotter_runtime: State<SharedPlotterRuntime>,
) -> CommandResult<()> {
    log::info!("[CMD] set_plot_plan: {} items, hash={}", plan.items.len(), plan.config_hash);
    for (i, item) in plan.items.iter().enumerate() {
        log::info!("[CMD]   item[{}]: {:?}", i, item);
    }
    plotter_runtime.set_plan(plan);
    CommandResult::ok(())
}

/// Clear the plot plan from runtime
/// Also clears any pending stop request
#[tauri::command]
pub fn clear_plot_plan(
    plotter_runtime: State<SharedPlotterRuntime>,
) -> CommandResult<()> {
    log::info!("[CMD] clear_plot_plan called");
    plotter_runtime.clear_plan();
    plotter_runtime.clear_stop();
    CommandResult::ok(())
}

/// Start executing the plot plan
///
/// This command:
/// 1. Validates a plan exists in runtime
/// 2. Clears any previous stop request
/// 3. Returns the current item to execute
#[tauri::command]
pub async fn start_plot_plan(
    plotter_runtime: State<'_, SharedPlotterRuntime>,
) -> Result<CommandResult<PlotPlanItem>, ()> {
    log::info!("[CMD] start_plot_plan called");

    // Clear any previous stop request
    plotter_runtime.clear_stop();

    // Get plan from runtime
    let plan = match plotter_runtime.get_plan() {
        Some(p) => p,
        None => return Ok(CommandResult::err("No plot plan exists. Generate a plan first.")),
    };

    // Check if already running
    if plotter_runtime.is_running() {
        return Ok(CommandResult::err("Plotter is already running"));
    }

    // Check if there are items to execute
    let current_index = plotter_runtime.get_current_index();
    if current_index >= plan.items.len() {
        return Ok(CommandResult::err("No more items to execute"));
    }

    // Get current item
    let item = plan.items[current_index].clone();
    log::debug!("[CMD] start_plot_plan: starting at index {}, item: {:?}", current_index, item);

    Ok(CommandResult::ok(item))
}

/// Soft stop plotting - finish current batch, keep plan
#[tauri::command]
pub async fn soft_stop_plot_plan(
    plotter_runtime: State<'_, SharedPlotterRuntime>,
) -> Result<CommandResult<()>, ()> {
    log::info!("[CMD] soft_stop_plot_plan called");
    plotter_runtime.request_soft_stop();
    Ok(CommandResult::ok(()))
}

/// Hard stop plotting - finish current item, clear plan
#[tauri::command]
pub async fn hard_stop_plot_plan(
    plotter_runtime: State<'_, SharedPlotterRuntime>,
) -> Result<CommandResult<()>, ()> {
    log::info!("[CMD] hard_stop_plot_plan called");

    // Signal plotter to stop immediately
    pocx_plotter::request_stop();
    plotter_runtime.request_hard_stop();

    Ok(CommandResult::ok(()))
}

/// Advance to next plan item and return it
///
/// Called after an item completes. Handles stop logic:
/// - Soft stop: returns None at batch boundary (plan kept)
/// - Hard stop: clears plan, returns None
/// - Normal: returns next item
#[tauri::command]
pub async fn advance_plot_plan(
    plotter_runtime: State<'_, SharedPlotterRuntime>,
) -> Result<CommandResult<Option<PlotPlanItem>>, ()> {
    log::info!("[CMD] advance_plot_plan called");

    let plan = match plotter_runtime.get_plan() {
        Some(p) => p,
        None => {
            log::info!("[CMD] advance_plot_plan: no plan exists - returning None");
            return Ok(CommandResult::ok(None));
        }
    };

    let stop_type = plotter_runtime.get_stop_type();
    let current_index = plotter_runtime.advance_index();
    let total = plan.items.len();

    log::info!("[CMD] advance_plot_plan: index {} → {}, total {}, stop_type {:?}",
        current_index.saturating_sub(1), current_index, total, stop_type);

    // Check if plan is complete
    if current_index >= total {
        log::info!("[EXEC] all items complete, clearing plan");
        plotter_runtime.clear_plan();
        plotter_runtime.clear_stop();
        return Ok(CommandResult::ok(None));
    }

    // Handle stop logic
    match stop_type {
        StopType::Hard => {
            // Hard stop: clear plan immediately
            log::info!("[EXEC] hard stop: clearing plan");
            plotter_runtime.clear_plan();
            plotter_runtime.clear_stop();
            return Ok(CommandResult::ok(None));
        }
        StopType::Soft => {
            // Soft stop: check if at batch boundary
            let prev_item = &plan.items[current_index - 1];
            let next_item = &plan.items[current_index];

            // Get batch IDs
            let prev_batch = match prev_item {
                PlotPlanItem::Plot { batch_id, .. } => Some(*batch_id),
                _ => None,
            };
            let next_batch = match next_item {
                PlotPlanItem::Plot { batch_id, .. } => Some(*batch_id),
                PlotPlanItem::AddToMiner { .. } => {
                    // Always execute AddToMiner even when stopping
                    log::debug!("[EXEC] soft stop: executing AddToMiner before stopping");
                    return Ok(CommandResult::ok(Some(next_item.clone())));
                }
                PlotPlanItem::Resume { .. } => {
                    // Stop before resume items
                    log::info!("[EXEC] soft stop: at resume boundary, stopping");
                    plotter_runtime.clear_stop();
                    return Ok(CommandResult::ok(None));
                }
            };

            // Check if same batch or different
            if prev_batch != next_batch {
                log::info!("[EXEC] soft stop: at batch boundary, stopping");
                plotter_runtime.clear_stop();
                return Ok(CommandResult::ok(None));
            }

            // Still in same batch but soft stop requested - continue
            log::debug!("[EXEC] soft stop: still in batch {}, continuing", prev_batch.unwrap_or(0));
        }
        StopType::None => {
            // Normal execution
        }
    }

    // Return next item
    let next_item = plan.items[current_index].clone();
    log::debug!("[CMD] advance_plot_plan: returning item {:?}", next_item);
    Ok(CommandResult::ok(Some(next_item)))
}

// ============================================================================
// Plotter Execution Commands
// ============================================================================

/// Execute a single plot plan item
/// This is the main entry point for actual plotting.
/// Spawns the plotter task and returns immediately.
/// The plotter runs async and emits events: plotter:item-complete when done.
#[tauri::command]
pub async fn execute_plot_item(
    app_handle: AppHandle,
    item: PlotPlanItem,
    state: State<'_, SharedMiningState>,
    plotter_runtime: State<'_, SharedPlotterRuntime>,
) -> Result<CommandResult<PlotExecutionResult>, ()> {
    log::info!("[CMD] execute_plot_item: {:?}", item);

    // Get config from state
    let config = match state.lock() {
        Ok(state_guard) => state_guard.config.clone(),
        Err(e) => {
            log::error!("[CMD] execute_plot_item: failed to lock state: {}", e);
            return Ok(CommandResult::err(format!("Failed to lock state: {}", e)));
        }
    };

    log::info!("[CMD] execute_plot_item: calling plotter::execute_plot_item...");

    // Execute the item (spawns async task, returns immediately)
    match plotter::execute_plot_item(
        app_handle,
        item,
        &config,
        (*state).clone(),
        (*plotter_runtime).clone(),
    )
    .await
    {
        Ok(result) => {
            log::info!("[CMD] execute_plot_item: plotter::execute_plot_item returned success={}, is_running={}",
                result.success, plotter_runtime.is_running());
            Ok(CommandResult::ok(result))
        }
        Err(e) => {
            log::error!("[CMD] execute_plot_item: plotter::execute_plot_item returned error: {}", e);
            Ok(CommandResult::err(e))
        }
    }
}

/// Execute a batch of plot plan items (multiple outputs in single plotter run)
/// Items with the same batchId should be executed together for parallel disk writes.
/// This passes multiple -p paths to the plotter for parallel plotting.
#[tauri::command]
pub async fn execute_plot_batch(
    app_handle: AppHandle,
    items: Vec<PlotPlanItem>,
    state: State<'_, SharedMiningState>,
    plotter_runtime: State<'_, SharedPlotterRuntime>,
) -> Result<CommandResult<PlotExecutionResult>, ()> {
    // Get config from state
    let config = match state.lock() {
        Ok(state_guard) => state_guard.config.clone(),
        Err(e) => return Ok(CommandResult::err(format!("Failed to lock state: {}", e))),
    };

    // Execute the batch
    match plotter::execute_plot_batch(
        app_handle,
        items,
        &config,
        (*state).clone(),
        (*plotter_runtime).clone(),
    )
    .await
    {
        Ok(result) => {
            if !result.success {
                log::error!("Plot batch failed: {:?}", result.error);
            }
            Ok(CommandResult::ok(result))
        }
        Err(e) => {
            log::error!("Failed to execute plot batch: {}", e);
            Ok(CommandResult::err(e))
        }
    }
}

/// Check if plotter is currently running
#[tauri::command]
pub fn is_plotter_running(
    plotter_runtime: State<'_, SharedPlotterRuntime>,
) -> CommandResult<bool> {
    CommandResult::ok(plotter_runtime.is_running())
}

/// Get the current stop type
#[tauri::command]
pub fn get_stop_type(
    plotter_runtime: State<'_, SharedPlotterRuntime>,
) -> CommandResult<StopType> {
    CommandResult::ok(plotter_runtime.get_stop_type())
}

