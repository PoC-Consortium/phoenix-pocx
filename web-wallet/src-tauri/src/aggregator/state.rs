//! Aggregator state management
//!
//! Maintains the current state of the aggregator and persists configuration.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Aggregator configuration (persisted)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregatorConfig {
    pub enabled: bool,
    pub listen_address: String,
    pub upstream_name: String,
    pub upstream_rpc_host: String,
    pub upstream_rpc_port: u16,
    pub submission_mode: AggregatorSubmissionMode,
    pub block_time_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AggregatorSubmissionMode {
    #[default]
    Wallet,
    Pool,
}

impl Default for AggregatorConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen_address: "0.0.0.0:18333".to_string(),
            upstream_name: "local".to_string(),
            upstream_rpc_host: "127.0.0.1".to_string(),
            upstream_rpc_port: 18332,
            submission_mode: AggregatorSubmissionMode::Wallet,
            block_time_secs: 120,
        }
    }
}

/// Aggregator running status
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AggregatorStatus {
    #[default]
    Stopped,
    Starting,
    Running {
        #[serde(rename = "listenAddress")]
        listen_address: String,
    },
    Error {
        message: String,
    },
}

/// Inner aggregator state
#[derive(Debug)]
pub struct AggregatorInner {
    pub config: AggregatorConfig,
    pub status: AggregatorStatus,
    pub last_stats: Option<serde_json::Value>,
}

impl Default for AggregatorInner {
    fn default() -> Self {
        Self {
            config: AggregatorConfig::default(),
            status: AggregatorStatus::Stopped,
            last_stats: None,
        }
    }
}

/// Thread-safe aggregator state
pub type SharedAggregatorState = Arc<Mutex<AggregatorInner>>;

/// Get the path to the aggregator config file
pub fn get_config_file_path() -> Option<PathBuf> {
    #[cfg(target_os = "android")]
    {
        Some(PathBuf::from("/data/data/org.pocx.phoenix/files/aggregator-config.json"))
    }

    #[cfg(not(target_os = "android"))]
    {
        Some(crate::app_data_dir().join("aggregator-config.json"))
    }
}

/// Load aggregator config from file
pub fn load_config_from_file() -> Option<AggregatorConfig> {
    let path = get_config_file_path()?;
    if !path.exists() {
        log::info!("No aggregator config file found at {:?}", path);
        return None;
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(config) => {
                log::info!("Loaded aggregator config from {:?}", path);
                Some(config)
            }
            Err(e) => {
                log::error!("Failed to parse aggregator config file: {}", e);
                None
            }
        },
        Err(e) => {
            log::error!("Failed to read aggregator config file: {}", e);
            None
        }
    }
}

/// Save aggregator config to file
pub fn save_config(config: &AggregatorConfig) -> Result<(), String> {
    let path = get_config_file_path().ok_or("Could not determine config directory")?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("[AGGREGATOR CONFIG] saved");
    Ok(())
}

/// Create a new shared aggregator state, loading existing config if available
pub fn create_aggregator_state() -> SharedAggregatorState {
    let mut inner = AggregatorInner::default();

    if let Some(config) = load_config_from_file() {
        inner.config = config;
        log::info!("Restored aggregator configuration from file");
    }

    Arc::new(Mutex::new(inner))
}
