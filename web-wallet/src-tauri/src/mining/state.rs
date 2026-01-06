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
    Paused,
    Error(String),
}

/// Chain configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub api_path: String,
    pub block_time_seconds: u64,
    pub mode: SubmissionMode,
    pub enabled: bool,
    pub priority: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
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

/// Plot plan execution status
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PlotPlanStatus {
    #[default]
    Pending,
    Running,
    Stopping,  // Soft stop requested, finishing current batch
    Paused,
    Completed,
    Invalid,
}

/// Individual plot plan task
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
    /// Add completed drive to miner config
    AddToMiner {
        path: String,
    },
}

/// Full plot execution plan
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotPlan {
    pub version: u32,
    pub generated_at: u64,
    pub config_hash: String,
    pub finished_drives: Vec<String>,
    pub items: Vec<PlotPlanItem>,
    pub current_index: usize,
    pub status: PlotPlanStatus,
}

impl Default for PlotPlan {
    fn default() -> Self {
        Self {
            version: 1,
            generated_at: 0,
            config_hash: String::new(),
            finished_drives: Vec::new(),
            items: Vec::new(),
            current_index: 0,
            status: PlotPlanStatus::Pending,
        }
    }
}

/// Recent deadline entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadlineEntry {
    pub id: i64,
    pub chain_name: String,
    pub account: String,
    pub height: u64,
    pub nonce: u64,
    pub deadline: u64,
    pub submitted: bool,
    pub timestamp: i64,
}

/// Full mining configuration
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plot_plan: Option<PlotPlan>, // Current plot execution plan
    #[serde(default)]
    pub simulation_mode: bool, // Dev only: run plotter in benchmark mode (no disk writes)
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
            plot_plan: None,
            simulation_mode: false,
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

/// Update plotting status
pub fn update_plotting_status(state: &SharedMiningState, status: PlottingStatus) {
    if let Ok(mut state) = state.lock() {
        state.plotting_status = status;
    }
}

/// Add a deadline entry
pub fn add_deadline(state: &SharedMiningState, deadline: DeadlineEntry) {
    if let Ok(mut state) = state.lock() {
        state.recent_deadlines.insert(0, deadline);
        // Keep only last 100 deadlines in memory
        state.recent_deadlines.truncate(100);
    }
}

/// Update block info for a chain
pub fn update_block_info(state: &SharedMiningState, chain_name: String, info: BlockInfo) {
    if let Ok(mut state) = state.lock() {
        state.current_block.insert(chain_name, info);
    }
}
