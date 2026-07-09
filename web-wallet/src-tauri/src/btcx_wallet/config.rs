//! Nodeless BTCX wallet configuration and persistence
//!
//! Persisted to `btcx_wallet_config.json` in the app data dir, mirroring
//! the node module's `NodeConfig` conventions.

use params_btcx::params::{ChainParams, BTCX_MAINNET, BTCX_REGTEST, BTCX_TESTNET};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

/// Registry coin id of Bitcoin PoCX in the btcx crates.
pub const COIN_ID: &str = "btcx";

/// Config file name in the app data dir.
pub const CONFIG_FILE: &str = "btcx_wallet_config.json";

/// Subdirectory of the app data dir holding the seed + wallet stores.
pub const WALLET_SUBDIR: &str = "btcx-wallet";

/// Network the nodeless wallet runs on. Maps 1:1 onto the static
/// `params_btcx` BTCX chain parameters.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum WalletNetwork {
    #[default]
    Mainnet,
    Testnet,
    Regtest,
}

impl WalletNetwork {
    /// Network name as a string (config keys, event payloads).
    pub fn as_str(&self) -> &'static str {
        match self {
            WalletNetwork::Mainnet => "mainnet",
            WalletNetwork::Testnet => "testnet",
            WalletNetwork::Regtest => "regtest",
        }
    }

    /// The static BTCX chain parameters for this network.
    pub fn params(&self) -> &'static ChainParams {
        match self {
            WalletNetwork::Mainnet => &BTCX_MAINNET,
            WalletNetwork::Testnet => &BTCX_TESTNET,
            WalletNetwork::Regtest => &BTCX_REGTEST,
        }
    }
}

/// Which standard single-key descriptor family a wallet derives —
/// serde-friendly mirror of `keys_btcx::DescriptorKind`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DescriptorKindCfg {
    /// BIP-84 `wpkh` — segwit v0, the Phoenix / BTCX standard.
    Bip84,
    /// BIP-86 `tr` — taproot key-spend.
    Bip86,
}

impl DescriptorKindCfg {
    pub fn kind(self) -> keys_btcx::DescriptorKind {
        match self {
            DescriptorKindCfg::Bip84 => keys_btcx::DescriptorKind::Bip84,
            DescriptorKindCfg::Bip86 => keys_btcx::DescriptorKind::Bip86,
        }
    }
}

/// The descriptor branch a wallet was opened with: purpose family + BIP32
/// coin type. Persisted per network so a restore that landed on a legacy
/// branch (coin type 0', see the restore probing in `manager`) reopens the
/// SAME branch on every later launch.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorPolicy {
    pub kind: DescriptorKindCfg,
    pub coin_type: u32,
}

impl Default for DescriptorPolicy {
    /// New wallets: BIP-84 at the BTCX coin type (`0x504F4358`, "POCX").
    fn default() -> Self {
        Self {
            kind: DescriptorKindCfg::Bip84,
            coin_type: keys_btcx::COIN_BTCX,
        }
    }
}

/// Nodeless wallet configuration stored in `btcx_wallet_config.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BtcxWalletConfig {
    /// Active network (mainnet, testnet, regtest).
    #[serde(default)]
    pub network: WalletNetwork,

    /// User-editable Electrum server URLs (`tcp://host:port` /
    /// `ssl://host:port`), keyed by network name so switching networks
    /// never wipes the other network's servers. Mainnet defaults to EMPTY
    /// until public BTCX Electrum servers exist.
    #[serde(default)]
    pub electrum_servers: BTreeMap<String, Vec<String>>,

    /// Whether the nodeless wallet feature is active (a seed was created or
    /// restored through it).
    #[serde(default)]
    pub active: bool,

    /// Descriptor policy per network name, recorded at create/restore.
    /// Missing entry = the fresh-wallet default (BIP-84 / BTCX coin type).
    #[serde(default)]
    pub descriptors: BTreeMap<String, DescriptorPolicy>,
}

impl BtcxWalletConfig {
    /// Path to the config file in the app data dir.
    pub fn config_path() -> PathBuf {
        let config_dir = crate::app_data_dir();
        let _ = fs::create_dir_all(&config_dir);
        config_dir.join(CONFIG_FILE)
    }

    /// Load config from disk, or default if not found/unreadable.
    pub fn load() -> Self {
        match fs::read_to_string(Self::config_path()) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Save config to disk.
    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
        }
        let contents = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {e}"))?;
        fs::write(&path, contents).map_err(|e| format!("Failed to write config: {e}"))?;
        log::info!("BTCX wallet config saved to {}", path.display());
        Ok(())
    }

    /// The Electrum servers configured for the ACTIVE network.
    pub fn servers(&self) -> Vec<String> {
        self.servers_for(self.network)
    }

    /// The Electrum servers configured for `network` (not necessarily the
    /// active one — e.g. chain-only broadcasts from the desktop wallet).
    pub fn servers_for(&self, network: WalletNetwork) -> Vec<String> {
        self.electrum_servers
            .get(network.as_str())
            .cloned()
            .unwrap_or_default()
    }

    /// Replace the server list of one network.
    pub fn set_servers(&mut self, network: WalletNetwork, servers: Vec<String>) {
        self.electrum_servers
            .insert(network.as_str().to_string(), servers);
    }

    /// Descriptor policy of the ACTIVE network (default when never set).
    pub fn policy(&self) -> DescriptorPolicy {
        self.descriptors
            .get(self.network.as_str())
            .copied()
            .unwrap_or_default()
    }

    /// Record the descriptor policy of one network (create/restore time).
    pub fn set_policy(&mut self, network: WalletNetwork, policy: DescriptorPolicy) {
        self.descriptors
            .insert(network.as_str().to_string(), policy);
    }

    /// Root of the seed + wallet stores: `<app data dir>/btcx-wallet`.
    /// The seed file lives directly here (one seed, every network).
    pub fn wallet_dir() -> PathBuf {
        crate::app_data_dir().join(WALLET_SUBDIR)
    }

    /// Per-network wallet data dir: `<app data dir>/btcx-wallet/<network>`.
    /// The bdk sqlite store lives at `<network dir>/wallet/btcx.sqlite`.
    pub fn network_dir(&self) -> PathBuf {
        Self::wallet_dir().join(self.network.as_str())
    }

    /// Path of the ACTIVE network's bdk sqlite wallet store.
    pub fn wallet_db_path(&self) -> PathBuf {
        self.network_dir().join("wallet").join("btcx.sqlite")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_mainnet_inactive_with_no_servers() {
        let config = BtcxWalletConfig::default();
        assert_eq!(config.network, WalletNetwork::Mainnet);
        assert!(!config.active);
        assert!(
            config.servers().is_empty(),
            "mainnet must default to an empty server list until public servers exist"
        );
        assert_eq!(config.policy(), DescriptorPolicy::default());
        assert_eq!(config.policy().coin_type, keys_btcx::COIN_BTCX);
        assert_eq!(config.policy().kind, DescriptorKindCfg::Bip84);
    }

    #[test]
    fn network_params_mapping() {
        // Each network maps onto the matching static BTCX params — checked
        // by identity-defining fields, not just the pointer.
        let cases = [
            (WalletNetwork::Mainnet, "pocx", &BTCX_MAINNET),
            (WalletNetwork::Testnet, "tpocx", &BTCX_TESTNET),
            (WalletNetwork::Regtest, "rpocx", &BTCX_REGTEST),
        ];
        for (network, hrp, expected) in cases {
            let params = network.params();
            assert_eq!(params, expected);
            assert_eq!(params.bech32_hrp, hrp);
            assert_eq!(params.coin_id, COIN_ID);
        }
    }

    #[test]
    fn config_json_round_trip() {
        let mut config = BtcxWalletConfig {
            network: WalletNetwork::Regtest,
            active: true,
            ..Default::default()
        };
        config.set_servers(
            WalletNetwork::Regtest,
            vec!["tcp://127.0.0.1:60401".to_string()],
        );
        config.set_servers(
            WalletNetwork::Mainnet,
            vec!["ssl://electrum.example.org:50002".to_string()],
        );
        config.set_policy(
            WalletNetwork::Regtest,
            DescriptorPolicy {
                kind: DescriptorKindCfg::Bip84,
                coin_type: 0,
            },
        );

        let json = serde_json::to_string_pretty(&config).unwrap();
        let parsed: BtcxWalletConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.network, WalletNetwork::Regtest);
        assert!(parsed.active);
        assert_eq!(parsed.servers(), vec!["tcp://127.0.0.1:60401".to_string()]);
        assert_eq!(parsed.policy().coin_type, 0);
        // The inactive network's servers survived the trip too.
        assert_eq!(
            parsed.electrum_servers.get("mainnet").unwrap(),
            &vec!["ssl://electrum.example.org:50002".to_string()]
        );
        // Networks not touched fall back to defaults.
        assert!(!parsed.descriptors.contains_key("mainnet"));
    }

    #[test]
    fn config_tolerates_older_json_shapes() {
        // Fields added later must default instead of failing the parse.
        let parsed: BtcxWalletConfig = serde_json::from_str(r#"{"network":"testnet"}"#).unwrap();
        assert_eq!(parsed.network, WalletNetwork::Testnet);
        assert!(!parsed.active);
        assert!(parsed.servers().is_empty());
    }

    #[test]
    fn per_network_paths_are_disjoint() {
        let mainnet = BtcxWalletConfig::default();
        let regtest = BtcxWalletConfig {
            network: WalletNetwork::Regtest,
            ..Default::default()
        };
        assert_ne!(mainnet.wallet_db_path(), regtest.wallet_db_path());
        // Both live under the shared btcx-wallet root (one seed dir).
        assert!(mainnet
            .wallet_db_path()
            .starts_with(BtcxWalletConfig::wallet_dir()));
        assert!(regtest
            .wallet_db_path()
            .starts_with(BtcxWalletConfig::wallet_dir()));
    }
}
