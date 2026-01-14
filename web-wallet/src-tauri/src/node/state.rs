//! Shared state for node management
//!
//! Tracks the current status of the managed node at runtime.

use super::config::{NodeConfig, NodeMode, NodePaths};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// Current status of the node (sent to frontend)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatus {
    /// Connection mode (managed or external)
    pub mode: NodeMode,

    /// Whether the node is installed (bitcoind binary exists)
    pub installed: bool,

    /// Whether the node process is running
    pub running: bool,

    /// Node version (if known)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,

    /// Current block height
    pub blocks: u64,

    /// Current header height (for sync progress)
    pub headers: u64,

    /// Number of connected peers
    pub peers: u32,

    /// Whether the node is fully synced
    pub synced: bool,

    /// Sync progress (0.0 - 1.0)
    pub sync_progress: f32,

    /// Process ID of the managed node (if running)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,

    /// Uptime in seconds (if running)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime: Option<u64>,

    /// Last error message (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,

    /// Network name (mainnet, testnet, regtest)
    pub network: String,
}

/// Download progress information
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// Bytes downloaded so far
    pub downloaded: u64,
    /// Total bytes to download
    pub total: u64,
    /// Download speed in bytes per second
    pub speed: f64,
    /// Current stage of the download process
    pub stage: DownloadStage,
    /// File being downloaded
    pub file_name: String,
}

/// Stages of the download process
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStage {
    #[default]
    Idle,
    /// Fetching release information from GitHub
    FetchingRelease,
    /// Downloading the archive
    Downloading,
    /// Verifying SHA256 hash
    Verifying,
    /// Extracting bitcoind from archive
    Extracting,
    /// Download complete
    Complete,
    /// Download failed
    Failed,
}

/// Internal state for node management
#[derive(Debug)]
pub struct NodeState {
    /// Current node status
    pub status: Mutex<NodeStatus>,

    /// Node configuration
    pub config: Mutex<NodeConfig>,

    /// Process ID of the managed node (for internal tracking)
    pub managed_pid: Mutex<Option<u32>>,

    /// Start time of the managed node (for uptime calculation)
    pub start_time: Mutex<Option<std::time::Instant>>,

    /// Current download progress (if downloading)
    pub download_progress: Mutex<Option<DownloadProgress>>,
}

impl Default for NodeState {
    fn default() -> Self {
        let config = NodeConfig::load();
        let installed = NodeConfig::bitcoind_path().exists();

        let status = NodeStatus {
            mode: config.mode.clone(),
            installed,
            network: config.network.as_str().to_string(),
            version: config.installed_version.clone(),
            ..Default::default()
        };

        Self {
            status: Mutex::new(status),
            config: Mutex::new(config),
            managed_pid: Mutex::new(None),
            start_time: Mutex::new(None),
            download_progress: Mutex::new(None),
        }
    }
}

impl NodeState {
    /// Get the current node status
    pub fn get_status(&self) -> NodeStatus {
        let mut status = self.status.lock().unwrap().clone();

        // Calculate uptime if running
        if status.running {
            if let Some(start) = *self.start_time.lock().unwrap() {
                status.uptime = Some(start.elapsed().as_secs());
            }
        }

        // Update installed status
        status.installed = NodeConfig::bitcoind_path().exists();

        status
    }

    /// Update the node status
    pub fn set_status(&self, status: NodeStatus) {
        *self.status.lock().unwrap() = status;
    }

    /// Update specific fields of the status
    pub fn update_status<F>(&self, f: F)
    where
        F: FnOnce(&mut NodeStatus),
    {
        let mut status = self.status.lock().unwrap();
        f(&mut status);
    }

    /// Get the current configuration
    pub fn get_config(&self) -> NodeConfig {
        self.config.lock().unwrap().clone()
    }

    /// Update and save the configuration
    pub fn set_config(&self, config: NodeConfig) -> Result<(), String> {
        // Update status fields that depend on config
        self.update_status(|s| {
            s.mode = config.mode.clone();
            s.network = config.network.as_str().to_string();
        });

        // Save to disk
        config.save()?;

        // Update in-memory config
        *self.config.lock().unwrap() = config;

        Ok(())
    }

    /// Set the managed process ID
    pub fn set_managed_pid(&self, pid: Option<u32>) {
        *self.managed_pid.lock().unwrap() = pid;

        // Update status as well
        self.update_status(|s| {
            s.pid = pid;
            s.running = pid.is_some();
        });

        // Track start time
        if pid.is_some() {
            *self.start_time.lock().unwrap() = Some(std::time::Instant::now());
        } else {
            *self.start_time.lock().unwrap() = None;
        }
    }

    /// Get the managed process ID
    pub fn get_managed_pid(&self) -> Option<u32> {
        *self.managed_pid.lock().unwrap()
    }

    /// Check if a node is installed (bitcoind binary exists)
    pub fn is_installed(&self) -> bool {
        NodeConfig::bitcoind_path().exists()
    }

    /// Get the installed version (from config)
    pub fn get_installed_version(&self) -> Option<String> {
        self.config.lock().unwrap().installed_version.clone()
    }

    /// Set the installed version
    pub fn set_installed_version(&self, version: Option<String>) {
        let mut config = self.config.lock().unwrap();
        config.installed_version = version.clone();

        // Also update status
        self.update_status(|s| {
            s.version = version;
            s.installed = NodeConfig::bitcoind_path().exists();
        });

        // Save config
        if let Err(e) = config.save() {
            log::error!("Failed to save config after version update: {}", e);
        }
    }

    /// Get current download progress
    pub fn get_download_progress(&self) -> Option<DownloadProgress> {
        self.download_progress.lock().unwrap().clone()
    }

    /// Set download progress
    pub fn set_download_progress(&self, progress: Option<DownloadProgress>) {
        *self.download_progress.lock().unwrap() = progress;
    }

    /// Update download progress
    pub fn update_download_progress<F>(&self, f: F)
    where
        F: FnOnce(&mut DownloadProgress),
    {
        let mut guard = self.download_progress.lock().unwrap();
        if let Some(ref mut progress) = *guard {
            f(progress);
        }
    }

    /// Get all node-related paths
    pub fn get_paths(&self) -> NodePaths {
        let config = self.get_config();
        NodePaths::get(&config)
    }

    /// Reset configuration to defaults
    pub fn reset_to_defaults(&self) -> Result<(), String> {
        // Delete config file if it exists
        let config_path = NodeConfig::config_path();
        if config_path.exists() {
            std::fs::remove_file(&config_path)
                .map_err(|e| format!("Failed to delete config file: {}", e))?;
            log::info!("Deleted node config at {}", config_path.display());
        }

        // Create fresh default config
        let default_config = NodeConfig::default();

        // Update in-memory state
        *self.config.lock().unwrap() = default_config.clone();

        // Update status
        self.update_status(|s| {
            s.mode = default_config.mode.clone();
            s.network = default_config.network.as_str().to_string();
            s.version = None;
        });

        // Clear managed PID
        *self.managed_pid.lock().unwrap() = None;
        *self.start_time.lock().unwrap() = None;

        log::info!("Node config reset to defaults");
        Ok(())
    }
}

/// Type alias for shared node state
pub type SharedNodeState = Arc<NodeState>;

/// Create a new shared node state
pub fn create_node_state() -> SharedNodeState {
    Arc::new(NodeState::default())
}
