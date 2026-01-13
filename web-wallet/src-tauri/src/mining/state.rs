//! Mining state management
//!
//! Maintains the current state of mining and plotting operations.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Mining operation state
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MiningStatus {
    #[default]
    Stopped,
    Starting,
    Scanning {
        chain_name: String,
        height: u64,
        progress: f64,
    },
    Idle,
    Error(String),
}

/// Plotting operation state
///
/// Note: "Stopping" state is now derived from PlotterRuntime.stop_type
/// in the frontend. This enum only tracks the actual plotter state.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlottingStatus {
    #[default]
    Idle,
    Plotting {
        file_path: String,
        progress: f64,
        speed_mib_s: f64,
    },
    Error(String),
}

/// RPC transport protocol
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RpcTransport {
    #[default]
    Http,
    Https,
}

/// RPC authentication method
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RpcAuth {
    #[default]
    None,
    UserPass {
        username: String,
        password: String,
    },
    Cookie {
        #[serde(default)]
        cookie_path: Option<String>,
    },
}

/// Chain configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainConfig {
    pub id: String,
    pub name: String,
    pub rpc_transport: RpcTransport,
    pub rpc_host: String,
    pub rpc_port: u16,
    pub rpc_auth: RpcAuth,
    pub block_time_seconds: u64,
    pub mode: SubmissionMode,
    pub enabled: bool,
    pub priority: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SubmissionMode {
    #[default]
    Solo,
    Pool,
}

/// Drive configuration for plotting/mining
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveConfig {
    pub path: String,
    pub enabled: bool,
    pub allocated_gib: u64, // User-selected GiB to allocate for plotting
}

/// CPU configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuConfig {
    pub mining_threads: u32,
    pub plotting_threads: u32,
    pub max_threads: u32,
}

/// Plotter device configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotterDeviceConfig {
    pub device_id: String,
    pub enabled: bool,
    pub threads: u32,
}

// ============================================================================
// Plot Plan Types
// ============================================================================

/// Individual plot plan task
///
/// These items are used by PlotPlan (in plotter.rs) to define work to be done.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlotPlanItem {
    /// Resume an incomplete .tmp file
    Resume {
        path: String,
        #[serde(rename = "fileIndex")]
        file_index: u32,
        #[serde(rename = "sizeGib")]
        size_gib: u64,
    },
    /// Create new plot file (1024 warps = 1 TiB, or remainder)
    Plot {
        path: String,
        warps: u64,
        #[serde(rename = "batchId")]
        batch_id: u32,
    },
    /// Checkpoint to restart miner with newly ready drives
    AddToMiner,
}

// Note: PlotPlan and PlotPlanStatus have been moved to plotter.rs
// Plan is now runtime-only (not persisted) and managed by PlotterRuntime.

/// Recent deadline entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadlineEntry {
    pub id: i64,
    pub chain_name: String,
    pub account: String,        // bech32 format (converted in backend)
    pub height: u64,
    pub nonce: u64,
    pub deadline: u64,
    pub quality_raw: u64,       // Raw quality for effective capacity calculations
    pub base_target: u64,       // Block's base target for capacity calculations
    pub submitted: bool,
    pub timestamp: i64,
    #[serde(default)]
    pub gensig: String,         // Generation signature for fork detection
}

/// Full mining configuration
///
/// Note: plot_plan has been removed. Plan is now runtime-only and managed
/// by PlotterRuntime in plotter.rs. This keeps the config file clean and
/// avoids stale plan state issues.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiningConfig {
    pub chains: Vec<ChainConfig>,
    pub drives: Vec<DriveConfig>,
    pub cpu_config: CpuConfig,
    pub plotter_devices: Vec<PlotterDeviceConfig>,
    pub plotting_address: String,
    pub compression_level: u8,
    #[serde(default)]
    pub memory_limit_gib: u64, // 0 = auto
    #[serde(default = "default_escalation")]
    pub escalation: u64, // default 1
    #[serde(default)]
    pub zero_copy_buffers: bool, // for APU/integrated GPU
    pub direct_io: bool,
    #[serde(default)]
    pub low_priority: bool,
    #[serde(default = "default_parallel_drives")]
    pub parallel_drives: u32, // Number of drives to plot simultaneously (default 1)
    pub hdd_wakeup_seconds: i64,
    #[serde(default)]
    pub simulation_mode: bool, // Dev only: run plotter in benchmark mode (no disk writes)

    // Wallet RPC settings for solo mining
    // These mirror the wallet's connection settings for deadline submission
    #[serde(default = "default_wallet_rpc_host")]
    pub wallet_rpc_host: String,
    #[serde(default = "default_wallet_rpc_port")]
    pub wallet_rpc_port: u16,
    #[serde(default)]
    pub wallet_data_directory: String, // For cookie auth
    #[serde(default = "default_wallet_network")]
    pub wallet_network: String, // testnet/mainnet/regtest
}

fn default_wallet_rpc_host() -> String {
    "127.0.0.1".to_string()
}

fn default_wallet_rpc_port() -> u16 {
    18332 // Bitcoin testnet RPC port
}

fn default_wallet_network() -> String {
    "testnet".to_string()
}

fn default_escalation() -> u64 {
    1
}

fn default_parallel_drives() -> u32 {
    1
}

impl Default for MiningConfig {
    fn default() -> Self {
        Self {
            chains: Vec::new(),
            drives: Vec::new(),
            cpu_config: CpuConfig {
                mining_threads: num_cpus::get() as u32 / 2,
                plotting_threads: num_cpus::get() as u32,
                max_threads: num_cpus::get() as u32,
            },
            plotter_devices: Vec::new(),
            plotting_address: String::new(),
            compression_level: 0,
            memory_limit_gib: 0,
            escalation: 1,
            zero_copy_buffers: false,
            direct_io: true,
            low_priority: false,
            parallel_drives: 1,
            hdd_wakeup_seconds: 30,
            simulation_mode: false,
            wallet_rpc_host: default_wallet_rpc_host(),
            wallet_rpc_port: default_wallet_rpc_port(),
            wallet_data_directory: String::new(),
            wallet_network: default_wallet_network(),
        }
    }
}

/// Current mining state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiningState {
    pub mining_status: MiningStatus,
    pub plotting_status: PlottingStatus,
    pub current_block: HashMap<String, BlockInfo>,
    pub recent_deadlines: Vec<DeadlineEntry>,
    pub config: MiningConfig,
    pub is_configured: bool,
}

/// Block information for a chain
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockInfo {
    pub height: u64,
    pub base_target: u64,
    pub generation_signature: String,
    pub best_deadline: Option<u64>,
}

impl Default for MiningState {
    fn default() -> Self {
        Self {
            mining_status: MiningStatus::Stopped,
            plotting_status: PlottingStatus::Idle,
            current_block: HashMap::new(),
            recent_deadlines: Vec::new(),
            config: MiningConfig::default(),
            is_configured: false,
        }
    }
}

/// Thread-safe mining state holder
pub type SharedMiningState = Arc<Mutex<MiningState>>;

/// Get the path to the mining config file
pub fn get_config_file_path() -> Option<PathBuf> {
    dirs::config_dir().map(|mut path| {
        path.push("phoenix-pocx");
        path.push("mining-config.json");
        path
    })
}

/// Load mining config from file
pub fn load_config_from_file() -> Option<MiningConfig> {
    let path = get_config_file_path()?;
    if !path.exists() {
        log::info!("No config file found at {:?}", path);
        return None;
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(config) => {
                log::info!("Loaded mining config from {:?}", path);
                Some(config)
            }
            Err(e) => {
                log::error!("Failed to parse config file: {}", e);
                None
            }
        },
        Err(e) => {
            log::error!("Failed to read config file: {}", e);
            None
        }
    }
}

/// Save mining config to file with reason for logging
pub fn save_config(config: &MiningConfig, reason: &str) -> Result<(), String> {
    let path = get_config_file_path().ok_or("Could not determine config directory")?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let content =
        serde_json::to_string_pretty(config).map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("[CONFIG] {}", reason);
    Ok(())
}

/// Save mining config to file (legacy wrapper)
pub fn save_config_to_file(config: &MiningConfig) -> Result<(), String> {
    save_config(config, "config updated")
}

/// Create a new shared mining state, loading existing config if available
pub fn create_mining_state() -> SharedMiningState {
    let mut state = MiningState::default();

    // Try to load existing config
    if let Some(config) = load_config_from_file() {
        state.config = config;
        state.is_configured = true;
        log::info!("Restored mining configuration from file");
    }

    Arc::new(Mutex::new(state))
}

/// Update mining status
pub fn update_mining_status(state: &SharedMiningState, status: MiningStatus) {
    if let Ok(mut state) = state.lock() {
        state.mining_status = status;
    }
}

/// Maximum deadlines to keep per chain (720 blocks ≈ 1 day at 2min block time)
const MAX_DEADLINES_PER_CHAIN: usize = 720;

/// Result of adding a deadline - indicates what changed
#[derive(Debug, Clone, PartialEq)]
pub enum DeadlineUpdateResult {
    /// No update - existing deadline was better
    NotImproved,
    /// New best deadline for this block (new height or better deadline)
    NewBestForBlock,
    /// Fork detected - gensig changed, deadline replaced
    ForkDetected,
}

/// Add or update a deadline entry with fork detection
/// - Only one entry per chain+height (best deadline wins)
/// - Lower deadline value (poc_time) is better
/// - Detects forks by gensig change for same height
///
/// Returns what kind of update occurred (for frontend notification)
pub fn add_deadline(state: &SharedMiningState, deadline: DeadlineEntry) -> DeadlineUpdateResult {
    if let Ok(mut state) = state.lock() {
        let chain_name = deadline.chain_name.clone();
        let height = deadline.height;
        let gensig = deadline.gensig.clone();

        // Check if we already have an entry for this chain+height
        if let Some(existing) = state.recent_deadlines.iter_mut().find(|d| {
            d.chain_name == chain_name && d.height == height
        }) {
            // Fork detection: if gensig changed, this is a new block at same height
            if !existing.gensig.is_empty() && existing.gensig != gensig {
                // Fork detected - replace entry entirely
                existing.account = deadline.account;
                existing.nonce = deadline.nonce;
                existing.deadline = deadline.deadline;
                existing.quality_raw = deadline.quality_raw;
                existing.base_target = deadline.base_target;
                existing.timestamp = deadline.timestamp;
                existing.gensig = gensig;
                return DeadlineUpdateResult::ForkDetected;
            }

            // Same block - only update if new deadline is better (lower)
            if deadline.deadline < existing.deadline {
                existing.account = deadline.account;
                existing.nonce = deadline.nonce;
                existing.deadline = deadline.deadline;
                existing.quality_raw = deadline.quality_raw;
                existing.base_target = deadline.base_target;
                existing.timestamp = deadline.timestamp;
                existing.gensig = gensig;
                return DeadlineUpdateResult::NewBestForBlock;
            }
            return DeadlineUpdateResult::NotImproved;
        }

        // New entry - add to front
        state.recent_deadlines.insert(0, deadline);

        // Enforce per-chain limit (remove oldest entries for this chain)
        let mut chain_count = 0;
        let mut remove_idx = None;
        for (idx, d) in state.recent_deadlines.iter().enumerate() {
            if d.chain_name == chain_name {
                chain_count += 1;
                if chain_count > MAX_DEADLINES_PER_CHAIN {
                    remove_idx = Some(idx);
                    break;
                }
            }
        }

        if let Some(idx) = remove_idx {
            state.recent_deadlines.remove(idx);
        }

        DeadlineUpdateResult::NewBestForBlock
    } else {
        DeadlineUpdateResult::NotImproved
    }
}

/// Update block info for a chain
pub fn update_block_info(state: &SharedMiningState, chain_name: String, info: BlockInfo) {
    if let Ok(mut state) = state.lock() {
        state.current_block.insert(chain_name, info);
    }
}
