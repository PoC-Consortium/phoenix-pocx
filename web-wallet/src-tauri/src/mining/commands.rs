//! Tauri command handlers for mining operations
//!
//! These commands are exposed to the Angular frontend via Tauri's invoke system.

use super::callback::TauriPlotterCallback;
use super::devices::{detect_devices, DeviceInfo};
use super::drives::{get_drive_info, list_drives, DriveInfo};
use super::state::{
    get_config_file_path, save_config_to_file, ChainConfig, CpuConfig, DeadlineEntry, DriveConfig,
    MiningConfig, MiningState, MiningStatus, PlotterDeviceConfig, PlottingStatus, SharedMiningState,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

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
    CommandResult::ok(list_drives())
}

/// Get drive info for a specific path
#[tauri::command]
pub fn get_plot_drive_info(path: String) -> CommandResult<DriveInfo> {
    match get_drive_info(&path) {
        Some(info) => CommandResult::ok(info),
        None => CommandResult::err(format!("Drive not found for path: {}", path)),
    }
}

// ============================================================================
// Mining State Commands
// ============================================================================

/// Get current mining state
#[tauri::command]
pub fn get_mining_state(state: State<SharedMiningState>) -> CommandResult<MiningState> {
    match state.lock() {
        Ok(state) => CommandResult::ok(state.clone()),
        Err(e) => CommandResult::err(format!("Failed to get mining state: {}", e)),
    }
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
    if let Err(e) = save_config_to_file(&config) {
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
pub async fn start_mining(state: State<'_, SharedMiningState>) -> Result<CommandResult<()>, ()> {
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

        // Parse URL
        let base_url = match url::Url::parse(&chain_config.url) {
            Ok(url) => url,
            Err(e) => {
                log::error!("Failed to parse URL for chain {}: {}", chain_config.name, e);
                continue;
            }
        };

        let submission_mode = match chain_config.mode {
            super::state::SubmissionMode::Solo => pocx_miner::SubmissionMode::Wallet,
            super::state::SubmissionMode::Pool => pocx_miner::SubmissionMode::Pool,
        };

        let chain = pocx_miner::Chain {
            name: chain_config.name.clone(),
            base_url,
            api_path: chain_config.api_path.clone(),
            block_time_seconds: chain_config.block_time_seconds,
            auth_token: chain_config.auth_token.clone(),
            target_quality: None,
            headers: std::collections::HashMap::new(),
            accounts: Vec::new(),
            submission_mode,
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
    // TODO: Actually stop the miner

    if let Ok(mut state_guard) = state.lock() {
        state_guard.mining_status = MiningStatus::Stopped;
    }

    Ok(CommandResult::ok(()))
}

// ============================================================================
// Plotting Control Commands
// ============================================================================

/// Start plotting input parameters
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPlottingParams {
    pub address: String,
    pub drive_path: String,
    pub target_files: u32,
    pub file_size_gib: u64,
    pub compression_level: u8,
}

/// Start plotting
#[tauri::command]
pub async fn start_plotting(
    params: StartPlottingParams,
    state: State<'_, SharedMiningState>,
) -> Result<CommandResult<()>, ()> {
    // Update state
    if let Ok(mut state_guard) = state.lock() {
        if state_guard.plotting_status != PlottingStatus::Idle {
            return Ok(CommandResult::err("Plotting is already in progress"));
        }
        state_guard.plotting_status = PlottingStatus::Plotting {
            file_path: params.drive_path.clone(),
            progress: 0.0,
            speed_mib_s: 0.0,
        };
    }

    // TODO: Actually start the plotter using pocx_plotter
    // This would spawn a background task that runs the plotter
    // and updates state via callbacks

    Ok(CommandResult::ok(()))
}

/// Stop plotting
#[tauri::command]
pub async fn stop_plotting(state: State<'_, SharedMiningState>) -> Result<CommandResult<()>, ()> {
    // TODO: Actually stop the plotter

    if let Ok(mut state_guard) = state.lock() {
        state_guard.plotting_status = PlottingStatus::Idle;
    }

    Ok(CommandResult::ok(()))
}

/// Pause plotting
#[tauri::command]
pub async fn pause_plotting(state: State<'_, SharedMiningState>) -> Result<CommandResult<()>, ()> {
    // TODO: Actually pause the plotter

    if let Ok(mut state_guard) = state.lock() {
        state_guard.plotting_status = PlottingStatus::Paused;
    }

    Ok(CommandResult::ok(()))
}

/// Resume plotting
#[tauri::command]
pub async fn resume_plotting(
    state: State<'_, SharedMiningState>,
) -> Result<CommandResult<()>, ()> {
    // TODO: Actually resume the plotter

    if let Ok(mut state_guard) = state.lock() {
        if let PlottingStatus::Paused = state_guard.plotting_status {
            state_guard.plotting_status = PlottingStatus::Plotting {
                file_path: String::new(),
                progress: 0.0,
                speed_mib_s: 0.0,
            };
        }
    }

    Ok(CommandResult::ok(()))
}

/// Cancel plotting
#[tauri::command]
pub async fn cancel_plotting(
    state: State<'_, SharedMiningState>,
) -> Result<CommandResult<()>, ()> {
    // TODO: Actually cancel the plotter (with cleanup)

    if let Ok(mut state_guard) = state.lock() {
        state_guard.plotting_status = PlottingStatus::Idle;
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

/// Delete all plot files from all configured drives
#[tauri::command]
pub async fn delete_all_plots(
    state: State<'_, SharedMiningState>,
) -> Result<CommandResult<()>, ()> {
    let drives: Vec<DriveConfig> = {
        match state.lock() {
            Ok(state_guard) => state_guard.config.drives.clone(),
            Err(e) => return Ok(CommandResult::err(format!("Failed to get drives: {}", e))),
        }
    };

    for drive in drives {
        // TODO: Delete plot files from drive.path
        // For now, just log it
        log::info!("Would delete plots from: {}", drive.path);
    }

    // Note: Plot file counts are now obtained via real-time scanning in DriveInfo,
    // no longer stored in DriveConfig

    Ok(CommandResult::ok(()))
}

/// Delete plot files from a specific drive
#[tauri::command]
pub async fn delete_drive_plots(
    path: String,
    _state: State<'_, SharedMiningState>,
) -> Result<CommandResult<()>, ()> {
    // TODO: Delete plot files from the specified path
    log::info!("Would delete plots from: {}", path);

    // Note: Plot file counts are obtained via real-time scanning in DriveInfo

    Ok(CommandResult::ok(()))
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
