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

/// The wallet name every pre-multi-wallet install migrates onto, and the
/// name the mobile UI's name-less create/restore lands on.
pub const DEFAULT_WALLET: &str = "default";

/// Trash subdirectory of a network dir — deleted wallets are MOVED here,
/// never removed (`btcx_wallet_delete`).
pub const TRASH_SUBDIR: &str = ".trash";

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

/// Per-wallet metadata in the named-wallet registry.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WalletMeta {
    /// The descriptor branch this wallet was created/restored on — reopens
    /// the SAME branch on every later launch.
    pub policy: DescriptorPolicy,
    /// Unix seconds at create/restore/migration time (display only).
    #[serde(default)]
    pub created_at: Option<u64>,
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
    /// never wipes the other network's servers. Ordered: the FIRST entry is
    /// the wallet's home/primary server, the rest are failover views.
    /// Mainnet defaults to EMPTY until public BTCX Electrum servers exist.
    #[serde(default)]
    pub electrum_servers: BTreeMap<String, Vec<String>>,

    /// Whether the nodeless wallet feature is active (a seed was created or
    /// restored through it).
    #[serde(default)]
    pub active: bool,

    /// LEGACY (pre-multi-wallet): descriptor policy per network name.
    /// Only read by the layout migration, which moves each entry into
    /// `wallets[net][DEFAULT_WALLET].policy` and clears this map.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub descriptors: BTreeMap<String, DescriptorPolicy>,

    /// Named-wallet registry: network name → wallet name → metadata. The
    /// wallet's data lives at `btcx-wallet/<network>/<name>/`.
    #[serde(default)]
    pub wallets: BTreeMap<String, BTreeMap<String, WalletMeta>>,

    /// The selected wallet per network name (missing = `DEFAULT_WALLET`).
    #[serde(default)]
    pub active_wallet: BTreeMap<String, String>,
}

/// Validate a wallet name: it becomes a directory name, so it is restricted
/// to `[A-Za-z0-9_-]`, 1..=32 chars, and must not collide with reserved
/// names (Windows device names, the legacy `wallet` store dir, the trash
/// dir). Case is PRESERVED (Bitcoin Core parity: names are saved exactly
/// as stated); uniqueness is enforced case-insensitively at creation
/// because the directories live on case-insensitive filesystems.
pub fn validate_wallet_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 32 {
        return Err("Wallet name must be 1-32 characters".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Wallet name may only contain letters, digits, '-' and '_'".into());
    }
    // `wallet` is the legacy (pre-multi-wallet) store dir a not-yet-migrated
    // layout may still have next to named wallets; `.trash` can't occur (no
    // dots) but is listed for clarity with TRASH_SUBDIR. Compared on the
    // lowercased name — Windows device names are case-insensitive too.
    const RESERVED: &[&str] = &[
        "wallet", ".trash", "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5",
        "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7",
        "lpt8", "lpt9",
    ];
    if RESERVED.contains(&name.to_ascii_lowercase().as_str()) {
        return Err(format!("'{name}' is a reserved name"));
    }
    Ok(())
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

    /// Name of the selected wallet of the ACTIVE network.
    pub fn active_wallet_name(&self) -> String {
        self.active_wallet
            .get(self.network.as_str())
            .cloned()
            .unwrap_or_else(|| DEFAULT_WALLET.to_string())
    }

    /// Select `name` as the active wallet of `network`.
    pub fn set_active_wallet(&mut self, network: WalletNetwork, name: &str) {
        self.active_wallet
            .insert(network.as_str().to_string(), name.to_string());
    }

    /// The registered wallet names of `network`, sorted (BTreeMap order).
    pub fn wallet_names(&self, network: WalletNetwork) -> Vec<String> {
        self.wallets
            .get(network.as_str())
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Metadata of one registered wallet.
    pub fn wallet_meta(&self, network: WalletNetwork, name: &str) -> Option<WalletMeta> {
        self.wallets
            .get(network.as_str())
            .and_then(|m| m.get(name))
            .copied()
    }

    /// Register (or update) one wallet's metadata.
    pub fn set_wallet_meta(&mut self, network: WalletNetwork, name: &str, meta: WalletMeta) {
        self.wallets
            .entry(network.as_str().to_string())
            .or_default()
            .insert(name.to_string(), meta);
    }

    /// Drop one wallet from the registry (and its active-wallet selection,
    /// falling back to `DEFAULT_WALLET`).
    pub fn remove_wallet_meta(&mut self, network: WalletNetwork, name: &str) {
        if let Some(m) = self.wallets.get_mut(network.as_str()) {
            m.remove(name);
        }
        if self.active_wallet.get(network.as_str()).map(String::as_str) == Some(name) {
            self.active_wallet.remove(network.as_str());
        }
    }

    /// Descriptor policy of the ACTIVE wallet of the ACTIVE network
    /// (fresh-wallet default when never registered).
    pub fn policy(&self) -> DescriptorPolicy {
        self.wallet_meta(self.network, &self.active_wallet_name())
            .map(|m| m.policy)
            .unwrap_or_default()
    }

    /// Record the descriptor policy of `network`'s ACTIVE wallet
    /// (create/restore/reprobe time), registering it if needed.
    pub fn set_policy(&mut self, network: WalletNetwork, policy: DescriptorPolicy) {
        let name = self
            .active_wallet
            .get(network.as_str())
            .cloned()
            .unwrap_or_else(|| DEFAULT_WALLET.to_string());
        let meta = WalletMeta {
            policy,
            created_at: self
                .wallet_meta(network, &name)
                .and_then(|m| m.created_at)
                .or_else(now_unix),
        };
        self.set_wallet_meta(network, &name, meta);
    }

    /// Root of the wallet stores: `<app data dir>/btcx-wallet`.
    pub fn wallet_dir() -> PathBuf {
        crate::app_data_dir().join(WALLET_SUBDIR)
    }

    /// One named wallet's data dir:
    /// `<app data dir>/btcx-wallet/<network>/<name>` — holds that wallet's
    /// `seed.mnemonic` plus its bdk store under `wallet/btcx.sqlite`.
    pub fn wallet_root(network: WalletNetwork, name: &str) -> PathBuf {
        Self::wallet_dir().join(network.as_str()).join(name)
    }

    /// One named wallet's bdk sqlite store path.
    pub fn wallet_db_path_for(network: WalletNetwork, name: &str) -> PathBuf {
        Self::wallet_root(network, name)
            .join("wallet")
            .join("btcx.sqlite")
    }

    /// Data dir of the ACTIVE wallet (network + selection from this config).
    pub fn active_wallet_root(&self) -> PathBuf {
        Self::wallet_root(self.network, &self.active_wallet_name())
    }

    /// bdk sqlite store path of the ACTIVE wallet.
    pub fn wallet_db_path(&self) -> PathBuf {
        Self::wallet_db_path_for(self.network, &self.active_wallet_name())
    }

    /// Migrate the legacy single-wallet layout (one root seed at
    /// `btcx-wallet/seed.mnemonic`, per-network stores at
    /// `btcx-wallet/<net>/wallet/`) into the named-wallet layout, each
    /// network's store becoming its `DEFAULT_WALLET`. Returns whether the
    /// config changed (caller saves). See [`migrate_legacy_layout_at`].
    pub fn migrate_legacy_layout(&mut self) -> Result<bool, String> {
        migrate_legacy_layout_at(self, &Self::wallet_dir())
    }
}

/// The migration core, rooted at `root` (the `btcx-wallet` dir) so it is
/// unit-testable against a temp dir.
///
/// Idempotent and abort-safe: the root seed file is the migration marker —
/// it is deleted LAST, only after every migrated wallet verifiably has its
/// own seed copy, so a crash mid-way simply re-runs the remaining steps on
/// the next launch. The seed file wraps survive a same-machine copy (the
/// keyring wrap stores its key id inside the line — see seedstore).
pub fn migrate_legacy_layout_at(
    config: &mut BtcxWalletConfig,
    root: &std::path::Path,
) -> Result<bool, String> {
    let root_seed = root.join(seedstore::SEED_FILE);
    if !root_seed.exists() {
        return Ok(false);
    }
    log::info!(
        "btcx wallet: migrating legacy single-wallet layout under {}",
        root.display()
    );

    let networks = [
        WalletNetwork::Mainnet,
        WalletNetwork::Testnet,
        WalletNetwork::Regtest,
    ];
    let wallet_root = |net: WalletNetwork| root.join(net.as_str()).join(DEFAULT_WALLET);

    let mut adopted = Vec::new();
    for net in networks {
        let legacy_store = root.join(net.as_str()).join("wallet");
        let default_store = wallet_root(net).join("wallet");
        if legacy_store.join("btcx.sqlite").exists() && !default_store.exists() {
            fs::create_dir_all(wallet_root(net))
                .map_err(|e| format!("creating {}: {e}", wallet_root(net).display()))?;
            fs::rename(&legacy_store, &default_store).map_err(|e| {
                format!(
                    "moving {} to {}: {e}",
                    legacy_store.display(),
                    default_store.display()
                )
            })?;
        }
        if default_store.join("btcx.sqlite").exists() {
            adopted.push(net);
        }
    }
    // A seed that never synced anywhere still belongs to a wallet: adopt it
    // as the active network's default.
    if adopted.is_empty() {
        adopted.push(config.network);
    }

    for &net in &adopted {
        fs::create_dir_all(wallet_root(net))
            .map_err(|e| format!("creating {}: {e}", wallet_root(net).display()))?;
        let dest_seed = wallet_root(net).join(seedstore::SEED_FILE);
        if !dest_seed.exists() {
            fs::copy(&root_seed, &dest_seed)
                .map_err(|e| format!("copying seed to {}: {e}", dest_seed.display()))?;
        }
        if config.wallet_meta(net, DEFAULT_WALLET).is_none() {
            let policy = config
                .descriptors
                .get(net.as_str())
                .copied()
                .unwrap_or_default();
            config.set_wallet_meta(
                net,
                DEFAULT_WALLET,
                WalletMeta {
                    policy,
                    created_at: now_unix(),
                },
            );
        }
        if !config.active_wallet.contains_key(net.as_str()) {
            config.set_active_wallet(net, DEFAULT_WALLET);
        }
    }

    // Only after EVERY adopted wallet verifiably holds its seed copy does
    // the root seed (the migration marker) go away.
    for &net in &adopted {
        let dest_seed = wallet_root(net).join(seedstore::SEED_FILE);
        if !dest_seed.exists() {
            return Err(format!(
                "seed copy missing at {} — keeping the legacy layout",
                dest_seed.display()
            ));
        }
    }
    fs::remove_file(&root_seed)
        .map_err(|e| format!("removing migrated seed {}: {e}", root_seed.display()))?;
    config.descriptors.clear();
    log::info!(
        "btcx wallet: migrated to named wallets ({})",
        adopted
            .iter()
            .map(|n| format!("{}/{}", n.as_str(), DEFAULT_WALLET))
            .collect::<Vec<_>>()
            .join(", ")
    );
    Ok(true)
}

/// Current unix time in seconds (display metadata, not consensus).
fn now_unix() -> Option<u64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
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
        // Both live under the shared btcx-wallet root.
        assert!(mainnet
            .wallet_db_path()
            .starts_with(BtcxWalletConfig::wallet_dir()));
        assert!(regtest
            .wallet_db_path()
            .starts_with(BtcxWalletConfig::wallet_dir()));
        // Named wallets of one network are disjoint too.
        assert_ne!(
            BtcxWalletConfig::wallet_db_path_for(WalletNetwork::Mainnet, "a"),
            BtcxWalletConfig::wallet_db_path_for(WalletNetwork::Mainnet, "b"),
        );
    }

    #[test]
    fn wallet_name_validation() {
        // Mixed case is VALID (Core parity: saved as stated); uniqueness is
        // handled case-insensitively at creation instead.
        for good in [
            "default",
            "a",
            "my-wallet_2",
            "Johnny",
            "UPPER",
            &"x".repeat(32),
        ] {
            assert!(validate_wallet_name(good).is_ok(), "{good}");
        }
        for bad in [
            "",
            "has space",
            "dot.dot",
            "..",
            "a/b",
            "a\\b",
            "wallet",
            "Wallet", // reserved names are case-insensitive
            "con",
            "CON",
            "lpt9",
            &"x".repeat(33),
        ] {
            assert!(validate_wallet_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn active_wallet_defaults_and_registry_round_trip() {
        let mut config = BtcxWalletConfig::default();
        assert_eq!(config.active_wallet_name(), DEFAULT_WALLET);
        assert!(config.wallet_names(WalletNetwork::Mainnet).is_empty());

        let meta = WalletMeta {
            policy: DescriptorPolicy::default(),
            created_at: Some(1),
        };
        config.set_wallet_meta(WalletNetwork::Mainnet, "savings", meta);
        config.set_active_wallet(WalletNetwork::Mainnet, "savings");
        assert_eq!(config.active_wallet_name(), "savings");
        assert_eq!(config.wallet_names(WalletNetwork::Mainnet), vec!["savings"]);
        assert_eq!(
            config.wallet_meta(WalletNetwork::Mainnet, "savings"),
            Some(meta)
        );
        assert!(config.wallet_db_path().ends_with(
            PathBuf::from("mainnet")
                .join("savings")
                .join("wallet")
                .join("btcx.sqlite")
        ));

        // JSON round trip keeps the registry.
        let json = serde_json::to_string(&config).unwrap();
        let parsed: BtcxWalletConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.active_wallet_name(), "savings");
        assert_eq!(
            parsed.wallet_meta(WalletNetwork::Mainnet, "savings"),
            Some(meta)
        );

        // Removing the wallet also clears the selection back to default.
        config.remove_wallet_meta(WalletNetwork::Mainnet, "savings");
        assert!(config.wallet_names(WalletNetwork::Mainnet).is_empty());
        assert_eq!(config.active_wallet_name(), DEFAULT_WALLET);
    }

    /// Some seed-file bytes; the migration never parses them, it only
    /// copies the file (any wrap survives a same-machine copy).
    const SEED_BYTES: &[u8] = b"PACTSEEDv2-obfs:aaaa:bbbb\n";

    #[test]
    fn legacy_layout_migration_moves_stores_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join(seedstore::SEED_FILE), SEED_BYTES).unwrap();
        std::fs::create_dir_all(root.join("regtest").join("wallet")).unwrap();
        std::fs::write(
            root.join("regtest").join("wallet").join("btcx.sqlite"),
            b"db",
        )
        .unwrap();

        let mut config = BtcxWalletConfig {
            network: WalletNetwork::Regtest,
            ..Default::default()
        };
        let legacy_policy = DescriptorPolicy {
            kind: DescriptorKindCfg::Bip84,
            coin_type: 0,
        };
        config
            .descriptors
            .insert("regtest".to_string(), legacy_policy);

        assert!(migrate_legacy_layout_at(&mut config, root).unwrap());

        let default_root = root.join("regtest").join(DEFAULT_WALLET);
        assert!(default_root.join("wallet").join("btcx.sqlite").exists());
        assert!(default_root.join(seedstore::SEED_FILE).exists());
        assert!(
            !root.join(seedstore::SEED_FILE).exists(),
            "root seed removed after verified copies"
        );
        assert!(
            !root.join("regtest").join("wallet").exists(),
            "legacy store moved, not copied"
        );
        assert_eq!(
            config
                .wallet_meta(WalletNetwork::Regtest, DEFAULT_WALLET)
                .unwrap()
                .policy,
            legacy_policy,
            "legacy per-network policy carried into the default wallet"
        );
        assert_eq!(config.active_wallet_name(), DEFAULT_WALLET);
        assert!(config.descriptors.is_empty());

        // Second run: marker gone, nothing to do.
        assert!(!migrate_legacy_layout_at(&mut config, root).unwrap());
    }

    #[test]
    fn migration_resumes_after_partial_run() {
        // Crash simulation: the store was already moved and the seed copied,
        // but the root seed (the marker) still exists and the config was
        // never updated. A re-run must finish the registry + marker steps.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join(seedstore::SEED_FILE), SEED_BYTES).unwrap();
        let default_root = root.join("testnet").join(DEFAULT_WALLET);
        std::fs::create_dir_all(default_root.join("wallet")).unwrap();
        std::fs::write(default_root.join("wallet").join("btcx.sqlite"), b"db").unwrap();
        std::fs::write(default_root.join(seedstore::SEED_FILE), SEED_BYTES).unwrap();

        let mut config = BtcxWalletConfig {
            network: WalletNetwork::Testnet,
            ..Default::default()
        };
        assert!(migrate_legacy_layout_at(&mut config, root).unwrap());
        assert!(!root.join(seedstore::SEED_FILE).exists());
        assert!(config
            .wallet_meta(WalletNetwork::Testnet, DEFAULT_WALLET)
            .is_some());
    }

    #[test]
    fn migration_adopts_never_synced_seed_on_active_network() {
        // A seed created before any Electrum server was configured has no
        // store on any network — it still becomes the active network's
        // default wallet.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join(seedstore::SEED_FILE), SEED_BYTES).unwrap();

        let mut config = BtcxWalletConfig::default(); // mainnet
        assert!(migrate_legacy_layout_at(&mut config, root).unwrap());
        assert!(root
            .join("mainnet")
            .join(DEFAULT_WALLET)
            .join(seedstore::SEED_FILE)
            .exists());
        assert!(config
            .wallet_meta(WalletNetwork::Mainnet, DEFAULT_WALLET)
            .is_some());
        assert!(!root.join(seedstore::SEED_FILE).exists());
    }
}
