//! Node configuration types and persistence
//!
//! Handles loading and saving node configuration from disk.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;

/// GitHub repository for Bitcoin-PoCX releases
pub const GITHUB_REPO_OWNER: &str = "PoC-Consortium";
pub const GITHUB_REPO_NAME: &str = "bitcoin";

/// How the wallet connects to the Bitcoin-PoCX network
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum NodeMode {
    /// Wallet manages the node (download, start, stop)
    #[default]
    Managed,
    /// User runs their own external node
    External,
}

/// Network type for Bitcoin-PoCX
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    /// Main network
    Mainnet,
    /// Test network
    #[default]
    Testnet,
    /// Local regression test network
    Regtest,
}

impl Network {
    /// Get the network name as a string
    pub fn as_str(&self) -> &'static str {
        match self {
            Network::Mainnet => "mainnet",
            Network::Testnet => "testnet",
            Network::Regtest => "regtest",
        }
    }

    /// Get the default RPC port for this network
    pub fn default_rpc_port(&self) -> u16 {
        match self {
            Network::Mainnet => 8332,
            Network::Testnet => 18332,
            Network::Regtest => 18443,
        }
    }

}

impl FromStr for Network {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "mainnet" => Ok(Network::Mainnet),
            "testnet" => Ok(Network::Testnet),
            "regtest" => Ok(Network::Regtest),
            _ => Ok(Network::Testnet), // Default to testnet
        }
    }
}

/// Node configuration stored in node_config.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeConfig {
    /// Connection mode (managed or external)
    #[serde(default)]
    pub mode: NodeMode,

    /// Network (mainnet, testnet, regtest)
    #[serde(default)]
    pub network: Network,

    /// Version of bitcoind currently installed (managed mode)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,

    /// Enable transaction index (txindex=1)
    #[serde(default)]
    pub txindex: bool,

    /// Enable mining server (-miningserver)
    #[serde(default)]
    pub mining_server: bool,

    /// Custom command-line arguments
    #[serde(default)]
    pub custom_args: String,

    /// External mode: data directory path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_directory: Option<String>,

    /// External mode: RPC host
    #[serde(default = "default_rpc_host")]
    pub rpc_host: String,

    /// External mode: RPC port (0 means use network default)
    #[serde(default)]
    pub rpc_port: u16,

    /// External mode: Authentication method
    #[serde(default)]
    pub auth_method: AuthMethod,

    /// External mode: RPC username (if using userpass auth)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_user: Option<String>,

    /// External mode: RPC password (if using userpass auth)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_password: Option<String>,
}

/// Authentication method for RPC
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    /// Cookie-based authentication (auto-detect from data directory)
    #[default]
    Cookie,
    /// Username/password authentication
    Userpass,
}

fn default_rpc_host() -> String {
    "127.0.0.1".to_string()
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            mode: NodeMode::default(),
            network: Network::default(),
            installed_version: None,
            txindex: false,
            mining_server: false,
            custom_args: String::new(),
            data_directory: None,
            rpc_host: default_rpc_host(),
            rpc_port: 0, // Use network default
            auth_method: AuthMethod::default(),
            rpc_user: None,
            rpc_password: None,
        }
    }
}

impl NodeConfig {
    /// Get the path to the node config file
    pub fn config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Phoenix-PoCX");

        // Ensure directory exists
        let _ = fs::create_dir_all(&config_dir);

        config_dir.join("node_config.json")
    }

    /// Load config from disk, or return default if not found
    pub fn load() -> Self {
        let path = Self::config_path();
        match fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Save config to disk
    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
        }

        let contents = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        fs::write(&path, contents).map_err(|e| format!("Failed to write config: {}", e))?;

        log::info!("Node config saved to {}", path.display());
        Ok(())
    }

    /// Get the effective RPC port (using network default if not specified)
    pub fn effective_rpc_port(&self) -> u16 {
        if self.rpc_port > 0 {
            self.rpc_port
        } else {
            self.network.default_rpc_port()
        }
    }

    /// Get the path where the managed node binary is stored
    pub fn managed_node_dir() -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Phoenix-PoCX")
                .join("node")
        }

        #[cfg(target_os = "macos")]
        {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Phoenix-PoCX")
                .join("node")
        }

        #[cfg(target_os = "linux")]
        {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".phoenix-pocx")
                .join("node")
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            PathBuf::from(".").join("node")
        }
    }

    /// Get the path to the bitcoind binary
    pub fn bitcoind_path() -> PathBuf {
        let node_dir = Self::managed_node_dir();

        #[cfg(target_os = "windows")]
        {
            node_dir.join("bitcoind.exe")
        }

        #[cfg(not(target_os = "windows"))]
        {
            node_dir.join("bitcoind")
        }
    }

    /// Get the default Bitcoin-PoCX data directory
    pub fn default_bitcoin_data_dir() -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Bitcoin-PoCX")
        }

        #[cfg(target_os = "macos")]
        {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Bitcoin-PoCX")
        }

        #[cfg(target_os = "linux")]
        {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".bitcoin-pocx")
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            PathBuf::from(".").join("bitcoin-pocx")
        }
    }

    /// Get the data directory for this config (external or default)
    pub fn get_data_directory(&self) -> PathBuf {
        match &self.data_directory {
            Some(dir) if !dir.is_empty() => {
                // Expand environment variables
                let expanded = crate::expand_path(dir);
                PathBuf::from(expanded)
            }
            _ => Self::default_bitcoin_data_dir(),
        }
    }

    /// Generate bitcoin.conf content for managed mode
    /// Uses section-based config for Bitcoin Core 0.17+ compatibility
    pub fn generate_bitcoin_conf(&self) -> String {
        let mut lines = vec![
            "# Generated by Phoenix PoCX Wallet".to_string(),
            "# Do not edit manually - changes may be overwritten".to_string(),
            "".to_string(),
            "# Global settings".to_string(),
            "server=1".to_string(),
        ];

        // Add global optional settings
        if self.txindex {
            lines.push("txindex=1".to_string());
        }

        if self.mining_server {
            lines.push("miningserver=1".to_string());
        }

        lines.push("".to_string());

        // Network-specific RPC settings in sections
        // Network selection is done via CLI flag (-testnet, -regtest), not in conf
        let section = match self.network {
            Network::Mainnet => "[main]",
            Network::Testnet => "[test]",
            Network::Regtest => "[regtest]",
        };

        lines.push(format!("# RPC settings for {} (localhost only for security)", self.network.as_str()));
        lines.push(section.to_string());
        lines.push("rpcbind=127.0.0.1".to_string());
        lines.push("rpcallowip=127.0.0.1".to_string());

        lines.join("\n")
    }

    /// Get the path to bitcoin.conf
    pub fn bitcoin_conf_path(&self) -> PathBuf {
        self.get_data_directory().join("bitcoin.conf")
    }

    /// Write bitcoin.conf to disk
    pub fn write_bitcoin_conf(&self) -> Result<(), String> {
        let conf_path = self.bitcoin_conf_path();

        // Ensure parent directory exists
        if let Some(parent) = conf_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create data directory: {}", e))?;
        }

        let content = self.generate_bitcoin_conf();
        fs::write(&conf_path, content)
            .map_err(|e| format!("Failed to write bitcoin.conf: {}", e))?;

        log::info!("bitcoin.conf written to {}", conf_path.display());
        Ok(())
    }
}

/// Paths used by the managed node (for frontend display)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePaths {
    /// Path to bitcoind binary
    pub bitcoind: String,
    /// Path to Bitcoin-PoCX data directory
    pub data_dir: String,
    /// Path to node_config.json
    pub config: String,
    /// Path to bitcoin.conf
    pub bitcoin_conf: String,
}

impl NodePaths {
    /// Get all node-related paths
    pub fn get(config: &NodeConfig) -> Self {
        Self {
            bitcoind: NodeConfig::bitcoind_path().to_string_lossy().to_string(),
            data_dir: config.get_data_directory().to_string_lossy().to_string(),
            config: NodeConfig::config_path().to_string_lossy().to_string(),
            bitcoin_conf: config.bitcoin_conf_path().to_string_lossy().to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = NodeConfig::default();
        assert_eq!(config.mode, NodeMode::Managed);
        assert_eq!(config.network, Network::Testnet);
        assert!(!config.txindex);
    }

    #[test]
    fn test_network_rpc_ports() {
        assert_eq!(Network::Mainnet.default_rpc_port(), 8332);
        assert_eq!(Network::Testnet.default_rpc_port(), 18332);
        assert_eq!(Network::Regtest.default_rpc_port(), 18443);
    }

    #[test]
    fn test_serialization() {
        let config = NodeConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: NodeConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config.mode, parsed.mode);
        assert_eq!(config.network, parsed.network);
    }

    #[test]
    fn test_bitcoin_conf_generation() {
        let mut config = NodeConfig::default();
        config.network = Network::Testnet;
        config.txindex = true;

        let conf = config.generate_bitcoin_conf();
        assert!(conf.contains("server=1"));
        assert!(conf.contains("[test]"));
        assert!(conf.contains("txindex=1"));
        assert!(conf.contains("rpcbind=127.0.0.1"));
    }
}
