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

/// Baked-in default mainnet Electrum server (`ssl://host:port`, the same
/// URL convention `electrum-btcx` dials) so a fresh install works out of
/// the box. Seeded whenever the mainnet list is empty — see
/// [`BtcxWalletConfig::seed_default_servers`].
pub const DEFAULT_MAINNET_ELECTRUM: &str = "ssl://electrs.bitcoin-po.cx:50002";

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

    /// BIP-32 coin type for NEW wallets on this network. Delegates to the
    /// shared single source of truth (`params_btcx::registry::btcx_coin_type`)
    /// so Phoenix and Satchel can never drift: mainnet uses the registered
    /// per-asset BTCX coin type (`0x504F4358`, spec §4.1); testnet and regtest
    /// use the shared SLIP-44 testnet coin type (1').
    pub fn asset_coin_type(&self) -> u32 {
        params_btcx::registry::btcx_coin_type(self.params().network)
    }

    /// The legacy (pre-v31) coin type probed for drainable history on this
    /// network. Only mainnet has a distinct legacy branch: v30 wallets sat
    /// at coin type 0'. Testnet/regtest only ever used 1' — which is also
    /// the current coin type — so there is no separate legacy branch and
    /// nothing to migrate there.
    pub fn legacy_coin_type(&self) -> u32 {
        match self {
            WalletNetwork::Mainnet => 0,
            WalletNetwork::Testnet | WalletNetwork::Regtest => 1,
        }
    }
}

/// Which standard single-key descriptor family a wallet derives —
/// serde-friendly mirror of `keys_btcx::DescriptorKind`, plus the `Legacy`
/// script class only descriptor-IMPORTED wallets can carry.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DescriptorKindCfg {
    /// BIP-84 `wpkh` — segwit v0, the Phoenix / BTCX standard.
    Bip84,
    /// BIP-86 `tr` — taproot key-spend.
    Bip86,
    /// Pre-segwit `pkh` / `sh(wpkh)` — accepted on descriptor import for
    /// fund visibility and spending, but gated from mining/assignments
    /// like taproot (a plot account_id is a segwit-v0 witness program).
    /// Never derived from a seed: `kind()` has no mapping for it.
    Legacy,
}

impl DescriptorKindCfg {
    /// The seed-derivation family, `None` for [`Self::Legacy`] — legacy
    /// wallets only exist as imported descriptors, never as a seed branch.
    pub fn kind(self) -> Option<keys_btcx::DescriptorKind> {
        match self {
            DescriptorKindCfg::Bip84 => Some(keys_btcx::DescriptorKind::Bip84),
            DescriptorKindCfg::Bip86 => Some(keys_btcx::DescriptorKind::Bip86),
            DescriptorKindCfg::Legacy => None,
        }
    }
}

/// Where a wallet's key material comes from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum WalletSourceCfg {
    /// BIP39 mnemonic in `seed.mnemonic` (seedstore) — create/restore.
    #[default]
    Seed,
    /// Imported private descriptor pair in `descriptor.secret`
    /// (descstore) — the wallet has NO mnemonic.
    Descriptor,
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

/// Point-in-time balance snapshot of one wallet — written by the sync
/// emitter (live wallet), the runtime close, and `btcx_wallet_group_sync`.
/// DISPLAY ONLY: it paints the wallet selector's compartment strip; spends
/// always operate on a live, freshly-synced runtime.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSnapshot {
    /// Total balance in sats (bdk `balance().total()`).
    pub sat: u64,
    /// Wallet-cache chain height (bdk checkpoint tip) at snapshot time.
    pub height: u32,
    /// Unix seconds when the snapshot was taken — the UI's staleness marker.
    pub at: u64,
}

/// Per-wallet metadata in the named-wallet registry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WalletMeta {
    /// The descriptor branch this wallet was created/restored on — reopens
    /// the SAME branch on every later launch. For descriptor-imported
    /// wallets `kind` is the script class of the imported descriptors and
    /// `coin_type` is informational (parsed from the derivation path).
    pub policy: DescriptorPolicy,
    /// Unix seconds at create/restore/migration time (display only).
    #[serde(default)]
    pub created_at: Option<u64>,
    /// Key-material source: seed (default, pre-existing configs) or
    /// imported descriptors.
    #[serde(default)]
    pub source: WalletSourceCfg,
    /// Single-address (`wpkh(WIF)`) wallet: one keychain, change returns
    /// to the same address. Only ever true for descriptor-source wallets;
    /// drives the UI badge and the receive page's hidden "new address".
    #[serde(default)]
    pub single_address: bool,
    /// Whether this wallet's group has been through the compartment
    /// materialization (or never needed it). Kept for config compatibility
    /// with the retired one-time v30→v31 upgrade pass, whose siblings the
    /// group migration recognizes; set by `materialize_group_compartments`.
    #[serde(default)]
    pub v30_migrated: bool,
    /// Wallet-selector group (one group = one seed's compartments). The
    /// AUTHORITATIVE link between same-seed sibling wallets — never derived
    /// from names after [`BtcxWalletConfig::migrate_groups`] assigned it.
    /// Empty = not yet migrated; treated as a singleton (the wallet's own
    /// name) by [`BtcxWalletConfig::group_of`].
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub group: String,
    /// Last known balance, selector display only (see [`BalanceSnapshot`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance_snapshot: Option<BalanceSnapshot>,
}

/// The `electrum_servers` map of a FRESH config: mainnet starts with the
/// baked-in public server, the other networks stay empty (regtest/testnet
/// servers are inherently local/user-specific).
fn default_electrum_servers() -> BTreeMap<String, Vec<String>> {
    let mut map = BTreeMap::new();
    map.insert(
        WalletNetwork::Mainnet.as_str().to_string(),
        vec![DEFAULT_MAINNET_ELECTRUM.to_string()],
    );
    map
}

/// Nodeless wallet configuration stored in `btcx_wallet_config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxWalletConfig {
    /// Active network (mainnet, testnet, regtest).
    #[serde(default)]
    pub network: WalletNetwork,

    /// User-editable Electrum server URLs (`tcp://host:port` /
    /// `ssl://host:port`), keyed by network name so switching networks
    /// never wipes the other network's servers. Ordered: the FIRST entry is
    /// the wallet's home/primary server, the rest are failover views.
    /// Mainnet starts with [`DEFAULT_MAINNET_ELECTRUM`]; a saved config's
    /// lists are never overridden (an EMPTY mainnet list is re-seeded on
    /// load, see [`Self::seed_default_servers`]).
    #[serde(default = "default_electrum_servers")]
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

impl Default for BtcxWalletConfig {
    /// Fresh config: mainnet, inactive, with the baked-in default mainnet
    /// Electrum server (matches the serde field defaults).
    fn default() -> Self {
        Self {
            network: WalletNetwork::default(),
            electrum_servers: default_electrum_servers(),
            active: false,
            descriptors: BTreeMap::new(),
            wallets: BTreeMap::new(),
            active_wallet: BTreeMap::new(),
        }
    }
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

    /// Load config from disk, or default if not found/unreadable. The
    /// default mainnet server is (re-)seeded if the mainnet list is empty.
    pub fn load() -> Self {
        let mut config: Self = match fs::read_to_string(Self::config_path()) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        };
        config.seed_default_servers();
        config
    }

    /// Ensure mainnet has at least the baked-in default server. Runs on
    /// every load: existing non-empty lists are NEVER touched (custom
    /// ordering and extra servers survive), but an empty mainnet list —
    /// whether never configured or deliberately cleared — is re-seeded so
    /// the app works out of the box. Clearing the list therefore only
    /// lasts for the running session, a deliberate trade-off.
    pub fn seed_default_servers(&mut self) {
        let mainnet = self
            .electrum_servers
            .entry(WalletNetwork::Mainnet.as_str().to_string())
            .or_default();
        if mainnet.is_empty() {
            mainnet.push(DEFAULT_MAINNET_ELECTRUM.to_string());
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
            .cloned()
    }

    /// The wallet-selector group of one wallet: its `group` field, or its
    /// own name (a singleton) while unassigned/unregistered.
    pub fn group_of(&self, network: WalletNetwork, name: &str) -> String {
        self.wallet_meta(network, name)
            .map(|m| m.group)
            .filter(|g| !g.is_empty())
            .unwrap_or_else(|| name.to_string())
    }

    /// The member wallet names of one group on `network`, registry (name)
    /// order.
    pub fn group_members(&self, network: WalletNetwork, group: &str) -> Vec<String> {
        self.wallet_names(network)
            .into_iter()
            .filter(|name| self.group_of(network, name) == group)
            .collect()
    }

    /// Record one wallet's balance snapshot (selector display), stamping
    /// the current time. No-op if the wallet is not registered.
    pub fn set_balance_snapshot(&mut self, network: WalletNetwork, name: &str, sat: u64, height: u32) {
        if let Some(mut meta) = self.wallet_meta(network, name) {
            meta.balance_snapshot = Some(BalanceSnapshot {
                sat,
                height,
                at: now_unix().unwrap_or(0),
            });
            self.set_wallet_meta(network, name, meta);
        }
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
    /// (create/restore/reprobe time), registering it if needed. The
    /// wallet's source and creation time survive a policy update.
    pub fn set_policy(&mut self, network: WalletNetwork, policy: DescriptorPolicy) {
        let name = self
            .active_wallet
            .get(network.as_str())
            .cloned()
            .unwrap_or_else(|| DEFAULT_WALLET.to_string());
        let existing = self.wallet_meta(network, &name);
        let meta = WalletMeta {
            policy,
            created_at: existing
                .as_ref()
                .and_then(|m| m.created_at)
                .or_else(now_unix),
            source: existing.as_ref().map(|m| m.source).unwrap_or_default(),
            single_address: existing.as_ref().map(|m| m.single_address).unwrap_or(false),
            // The migration flag is orthogonal to the descriptor policy and
            // must survive a policy update (a reprobe/branch switch).
            v30_migrated: existing.as_ref().map(|m| m.v30_migrated).unwrap_or(false),
            // Group and snapshot survive too; a fresh registration is a
            // singleton group under its own name.
            group: existing
                .as_ref()
                .map(|m| m.group.clone())
                .filter(|g| !g.is_empty())
                .unwrap_or_else(|| name.clone()),
            balance_snapshot: existing.as_ref().and_then(|m| m.balance_snapshot),
        };
        self.set_wallet_meta(network, &name, meta);
    }

    /// Whether the v30→v31 auto-migration has run for the named wallet on
    /// `network` (unregistered wallets report false).
    pub fn v30_migrated(&self, network: WalletNetwork, name: &str) -> bool {
        self.wallet_meta(network, name)
            .map(|m| m.v30_migrated)
            .unwrap_or(false)
    }

    /// Set the v30-migration flag of the named wallet on `network`,
    /// preserving the rest of its metadata. No-op if the wallet is not
    /// registered.
    pub fn set_v30_migrated(&mut self, network: WalletNetwork, name: &str, value: bool) {
        if let Some(mut meta) = self.wallet_meta(network, name) {
            meta.v30_migrated = value;
            self.set_wallet_meta(network, name, meta);
        }
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
                    source: WalletSourceCfg::Seed,
                    single_address: false,
                    v30_migrated: false,
                    group: DEFAULT_WALLET.to_string(),
                    balance_snapshot: None,
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

/// Parse a MACHINE-GENERATED sibling-wallet name: `<base>-v31` /
/// `<base>-v30`, optionally with the `-2`..`-99` collision tail
/// `resolve_counterpart_name` appends (`<base>-v31-2`). Returns the base
/// and the tag. User-chosen names that merely LOOK like this are filtered
/// out later by the coin-type conditions in [`BtcxWalletConfig::migrate_groups`].
pub fn machine_suffix_base(name: &str) -> Option<(&str, &'static str)> {
    for tag in ["-v31", "-v30"] {
        if let Some(base) = name.strip_suffix(tag) {
            if !base.is_empty() {
                return Some((base, tag));
            }
        }
        if let Some(pos) = name.rfind(tag) {
            let (base, tail) = (&name[..pos], &name[pos + tag.len()..]);
            let numeric_tail = tail
                .strip_prefix('-')
                .and_then(|d| d.parse::<u32>().ok())
                .is_some_and(|n| (2..=99).contains(&n));
            if !base.is_empty() && numeric_tail {
                return Some((base, tag));
            }
        }
    }
    None
}

impl BtcxWalletConfig {
    /// Assign the wallet-selector `group` of every registered wallet that
    /// has none yet. In practice almost every wallet is a SINGLETON group
    /// (its own name) — users hold one wallet per mnemonic. The only
    /// folding is the machine-generated migrate/rescan suffix pairs, and
    /// only when the coin types prove the machine origin:
    ///
    /// - `<base>-v31` (asset coin type, seed) folds onto `<base>` (legacy
    ///   coin type, seed) — a `migrate_v30` pair;
    /// - `<base>-v30` (legacy coin type, seed) folds onto `<base>` (asset
    ///   coin type, seed) — a `rescan_legacy` pair.
    ///
    /// Anything ambiguous stays a singleton — mis-grouping two unrelated
    /// seeds under one summed balance is the one failure this must never
    /// produce. Names are processed shortest-first so a folded wallet
    /// inherits its base's already-assigned group (`x` → `x-v31` →
    /// `x-v31-v30` chains collapse into one group). Idempotent: wallets
    /// with a group are never touched. Returns whether anything changed
    /// (caller backs up + saves).
    pub fn migrate_groups(&mut self) -> bool {
        let mut changed = false;
        for net in [
            WalletNetwork::Mainnet,
            WalletNetwork::Testnet,
            WalletNetwork::Regtest,
        ] {
            // Only mainnet has a distinct legacy branch, so only mainnet can
            // hold machine-generated pairs; elsewhere everything is singleton.
            let fold_allowed = net.legacy_coin_type() != net.asset_coin_type();
            let mut names = self.wallet_names(net);
            names.sort_by(|a, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)));
            for name in names {
                let Some(mut meta) = self.wallet_meta(net, &name) else {
                    continue;
                };
                if !meta.group.is_empty() {
                    continue;
                }
                meta.group = self
                    .machine_pair_group(net, &name, &meta, fold_allowed)
                    .unwrap_or_else(|| name.clone());
                self.set_wallet_meta(net, &name, meta);
                changed = true;
            }
        }
        changed
    }

    /// The group a machine-generated sibling folds into, or `None` when the
    /// name/coin-type evidence doesn't prove machine origin (→ singleton).
    fn machine_pair_group(
        &self,
        network: WalletNetwork,
        name: &str,
        meta: &WalletMeta,
        fold_allowed: bool,
    ) -> Option<String> {
        if !fold_allowed || meta.source != WalletSourceCfg::Seed {
            return None;
        }
        let (base, tag) = machine_suffix_base(name)?;
        let base_meta = self.wallet_meta(network, base)?;
        if base_meta.source != WalletSourceCfg::Seed {
            return None;
        }
        let asset = network.asset_coin_type();
        let legacy = network.legacy_coin_type();
        let coin_types_match = match tag {
            // migrate_v30: `<base>` is the v30 original, the sibling is v31.
            "-v31" => meta.policy.coin_type == asset && base_meta.policy.coin_type == legacy,
            // rescan_legacy: `<base>` is the v31 wallet, the sibling is v30.
            "-v30" => meta.policy.coin_type == legacy && base_meta.policy.coin_type == asset,
            _ => false,
        };
        if !coin_types_match {
            return None;
        }
        // The base's group was assigned first (shortest-first order); its
        // own fallback covers a base processed in an older app version.
        Some(self.group_of(network, base))
    }

    /// Back up the config file next to itself (one-time, before a
    /// migration rewrite): `btcx_wallet_config.json.<tag>.bak`. An existing
    /// backup is never overwritten — the FIRST pre-migration state wins.
    pub fn backup_config_file(tag: &str) {
        let path = Self::config_path();
        if !path.exists() {
            return;
        }
        let backup = path.with_extension(format!("json.{tag}.bak"));
        if backup.exists() {
            return;
        }
        if let Err(e) = fs::copy(&path, &backup) {
            log::warn!("btcx wallet: config backup to {} failed: {e}", backup.display());
        } else {
            log::info!("btcx wallet: config backed up to {}", backup.display());
        }
    }
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
    fn default_config_is_mainnet_inactive_with_default_server() {
        let config = BtcxWalletConfig::default();
        assert_eq!(config.network, WalletNetwork::Mainnet);
        assert!(!config.active);
        assert_eq!(
            config.servers(),
            vec![DEFAULT_MAINNET_ELECTRUM.to_string()],
            "a fresh config must work out of the box on mainnet"
        );
        assert!(config.servers_for(WalletNetwork::Testnet).is_empty());
        assert!(config.servers_for(WalletNetwork::Regtest).is_empty());
        assert_eq!(config.policy(), DescriptorPolicy::default());
        assert_eq!(config.policy().coin_type, keys_btcx::COIN_BTCX);
        assert_eq!(config.policy().kind, DescriptorKindCfg::Bip84);
    }

    #[test]
    fn seed_default_servers_fills_empty_mainnet_only() {
        // Missing mainnet key (e.g. older saved config): seeded.
        let mut config = BtcxWalletConfig::default();
        config.electrum_servers.clear();
        config.seed_default_servers();
        assert_eq!(config.servers(), vec![DEFAULT_MAINNET_ELECTRUM.to_string()]);

        // Present-but-empty mainnet list (deliberately cleared): re-seeded
        // on load by design — the app should work out of the box.
        config.set_servers(WalletNetwork::Mainnet, vec![]);
        config.seed_default_servers();
        assert_eq!(config.servers(), vec![DEFAULT_MAINNET_ELECTRUM.to_string()]);

        // A custom list is NEVER touched (order and entries survive).
        let custom = vec![
            "ssl://my.own.server:50002".to_string(),
            DEFAULT_MAINNET_ELECTRUM.to_string(),
        ];
        config.set_servers(WalletNetwork::Mainnet, custom.clone());
        config.seed_default_servers();
        assert_eq!(config.servers(), custom);

        // Other networks are left alone.
        assert!(config.servers_for(WalletNetwork::Testnet).is_empty());
        assert!(config.servers_for(WalletNetwork::Regtest).is_empty());
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
        // Active network is testnet — no baked-in server there...
        assert!(parsed.servers().is_empty());
        // ...but the missing electrumServers key defaulted to the seeded
        // mainnet list.
        assert_eq!(
            parsed.servers_for(WalletNetwork::Mainnet),
            vec![DEFAULT_MAINNET_ELECTRUM.to_string()]
        );
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
            source: WalletSourceCfg::Seed,
            single_address: false,
            v30_migrated: false,
            group: "savings".to_string(),
            balance_snapshot: None,
        };
        config.set_wallet_meta(WalletNetwork::Mainnet, "savings", meta.clone());
        config.set_active_wallet(WalletNetwork::Mainnet, "savings");
        assert_eq!(config.active_wallet_name(), "savings");
        assert_eq!(config.wallet_names(WalletNetwork::Mainnet), vec!["savings"]);
        assert_eq!(
            config.wallet_meta(WalletNetwork::Mainnet, "savings"),
            Some(meta.clone())
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

    #[test]
    fn wallet_source_defaults_to_seed_and_round_trips() {
        // Older configs have no `source` field — they must parse as Seed.
        let old: WalletMeta =
            serde_json::from_str(r#"{"policy":{"kind":"bip84","coinType":0},"createdAt":1}"#)
                .unwrap();
        assert_eq!(old.source, WalletSourceCfg::Seed);

        // A descriptor-source (legacy-kind) wallet survives the JSON trip.
        let meta = WalletMeta {
            policy: DescriptorPolicy {
                kind: DescriptorKindCfg::Legacy,
                coin_type: 0,
            },
            created_at: Some(2),
            source: WalletSourceCfg::Descriptor,
            single_address: false,
            v30_migrated: false,
            group: "imported".to_string(),
            balance_snapshot: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains(r#""source":"descriptor""#), "{json}");
        assert!(json.contains(r#""kind":"legacy""#), "{json}");
        let parsed: WalletMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, meta);

        // Older configs have no `singleAddress` field — defaults false.
        assert!(!old.single_address);

        // A single-address (wpkh(WIF)) wallet survives the JSON trip, and
        // a policy update never loses the marker.
        let single = WalletMeta {
            policy: DescriptorPolicy::default(),
            created_at: Some(3),
            source: WalletSourceCfg::Descriptor,
            single_address: true,
            v30_migrated: true,
            group: DEFAULT_WALLET.to_string(),
            balance_snapshot: Some(BalanceSnapshot {
                sat: 42,
                height: 7,
                at: 1700000000,
            }),
        };
        let json = serde_json::to_string(&single).unwrap();
        assert!(json.contains(r#""singleAddress":true"#), "{json}");
        assert!(json.contains(r#""v30Migrated":true"#), "{json}");
        assert!(json.contains(r#""group":"default""#), "{json}");
        assert!(json.contains(r#""balanceSnapshot":{"sat":42"#), "{json}");
        let parsed: WalletMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, single);

        // Older configs have no `v30Migrated` field — defaults false.
        assert!(!old.v30_migrated);

        let mut config = BtcxWalletConfig::default();
        config.set_wallet_meta(WalletNetwork::Mainnet, DEFAULT_WALLET, single);
        config.set_policy(WalletNetwork::Mainnet, DescriptorPolicy::default());
        let updated = config
            .wallet_meta(WalletNetwork::Mainnet, DEFAULT_WALLET)
            .unwrap();
        assert!(
            updated.single_address,
            "set_policy must preserve the single-address marker"
        );
        assert!(
            updated.v30_migrated,
            "set_policy must preserve the v30-migration flag"
        );

        // Legacy has no seed-derivation family.
        assert_eq!(DescriptorKindCfg::Legacy.kind(), None);
        assert_eq!(
            DescriptorKindCfg::Bip84.kind(),
            Some(keys_btcx::DescriptorKind::Bip84)
        );
    }

    #[test]
    fn v30_migration_flag_get_set_and_coin_type_probe() {
        let mut config = BtcxWalletConfig::default();
        let net = WalletNetwork::Mainnet;

        // A v30 (coin type 0) wallet and its v31 (COIN_BTCX) counterpart.
        let v30 = WalletMeta {
            policy: DescriptorPolicy {
                kind: DescriptorKindCfg::Bip84,
                coin_type: 0,
            },
            created_at: Some(1),
            source: WalletSourceCfg::Seed,
            single_address: false,
            v30_migrated: false,
            group: String::new(),
            balance_snapshot: None,
        };
        let v31 = WalletMeta {
            policy: DescriptorPolicy::default(),
            ..v30.clone()
        };
        config.set_wallet_meta(net, "acct-v30", v30);
        config.set_wallet_meta(net, "acct", v31);

        // Unregistered wallets report not-migrated; set/get round-trips.
        assert!(!config.v30_migrated(net, "acct"));
        assert!(!config.v30_migrated(net, "missing"));
        config.set_v30_migrated(net, "acct", true);
        assert!(config.v30_migrated(net, "acct"));
        // Setting the flag on a missing wallet is a no-op (no phantom entry).
        config.set_v30_migrated(net, "missing", true);
        assert!(config.wallet_meta(net, "missing").is_none());
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

    /// A seed-source WalletMeta at `coin_type`, group unassigned (the
    /// pre-groups shape the migration sees).
    fn ungrouped_seed_meta(coin_type: u32) -> WalletMeta {
        WalletMeta {
            policy: DescriptorPolicy {
                kind: DescriptorKindCfg::Bip84,
                coin_type,
            },
            created_at: Some(1),
            source: WalletSourceCfg::Seed,
            single_address: false,
            v30_migrated: false,
            group: String::new(),
            balance_snapshot: None,
        }
    }

    #[test]
    fn machine_suffix_parsing() {
        assert_eq!(machine_suffix_base("acct-v31"), Some(("acct", "-v31")));
        assert_eq!(machine_suffix_base("acct-v30"), Some(("acct", "-v30")));
        // resolve_counterpart_name's collision tails.
        assert_eq!(machine_suffix_base("acct-v31-2"), Some(("acct", "-v31")));
        assert_eq!(machine_suffix_base("acct-v30-99"), Some(("acct", "-v30")));
        // Chains strip ONE suffix at a time (x-v31-v30 folds onto x-v31).
        assert_eq!(machine_suffix_base("a-v31-v30"), Some(("a-v31", "-v30")));
        // Not machine shapes: plain names, bare tags, out-of-range tails.
        assert_eq!(machine_suffix_base("plain"), None);
        assert_eq!(machine_suffix_base("-v30"), None);
        assert_eq!(machine_suffix_base("acct-v30-1"), None);
        assert_eq!(machine_suffix_base("acct-v30-100"), None);
        assert_eq!(machine_suffix_base("acct-v312"), None);
    }

    #[test]
    fn group_migration_folds_machine_pairs_and_keeps_singletons() {
        let mut config = BtcxWalletConfig::default();
        let net = WalletNetwork::Mainnet;
        let asset = net.asset_coin_type();

        // A migrate_v30 pair: `acct` (the v30 original) + `acct-v31`.
        config.set_wallet_meta(net, "acct", ungrouped_seed_meta(0));
        config.set_wallet_meta(net, "acct-v31", ungrouped_seed_meta(asset));
        // A rescan_legacy pair: `main` + `main-v30`.
        config.set_wallet_meta(net, "main", ungrouped_seed_meta(asset));
        config.set_wallet_meta(net, "main-v30", ungrouped_seed_meta(0));
        // A plain standalone wallet.
        config.set_wallet_meta(net, "solo", ungrouped_seed_meta(asset));
        // DECOY: user-created name that merely looks machine-generated —
        // both sides on the asset coin type proves it is NOT a migrate
        // pair, so it must stay a singleton.
        config.set_wallet_meta(net, "other", ungrouped_seed_meta(asset));
        config.set_wallet_meta(net, "other-v31", ungrouped_seed_meta(asset));
        // DECOY: suffix name without any base wallet.
        config.set_wallet_meta(net, "orphan-v30", ungrouped_seed_meta(0));

        assert!(config.migrate_groups());

        assert_eq!(config.group_of(net, "acct"), "acct");
        assert_eq!(config.group_of(net, "acct-v31"), "acct");
        assert_eq!(config.group_of(net, "main"), "main");
        assert_eq!(config.group_of(net, "main-v30"), "main");
        assert_eq!(config.group_of(net, "solo"), "solo");
        assert_eq!(config.group_of(net, "other-v31"), "other-v31");
        assert_eq!(config.group_of(net, "orphan-v30"), "orphan-v30");

        let mut members = config.group_members(net, "acct");
        members.sort();
        assert_eq!(members, vec!["acct".to_string(), "acct-v31".to_string()]);

        // Idempotent: a second pass changes nothing.
        assert!(!config.migrate_groups());
    }

    #[test]
    fn group_migration_collapses_chains_and_skips_non_seed() {
        let mut config = BtcxWalletConfig::default();
        let net = WalletNetwork::Mainnet;
        let asset = net.asset_coin_type();

        // x (v30 original) → x-v31 (migrate) → x-v31-v30 (rescan of x-v31):
        // all one seed, all one group.
        config.set_wallet_meta(net, "x", ungrouped_seed_meta(0));
        config.set_wallet_meta(net, "x-v31", ungrouped_seed_meta(asset));
        config.set_wallet_meta(net, "x-v31-v30", ungrouped_seed_meta(0));
        // Descriptor-source wallets never fold, whatever their name.
        let mut desc = ungrouped_seed_meta(0);
        desc.source = WalletSourceCfg::Descriptor;
        config.set_wallet_meta(net, "imp", ungrouped_seed_meta(asset));
        config.set_wallet_meta(net, "imp-v30", desc);

        assert!(config.migrate_groups());
        assert_eq!(config.group_of(net, "x"), "x");
        assert_eq!(config.group_of(net, "x-v31"), "x");
        assert_eq!(config.group_of(net, "x-v31-v30"), "x");
        assert_eq!(config.group_members(net, "x").len(), 3);
        assert_eq!(config.group_of(net, "imp-v30"), "imp-v30");
    }

    #[test]
    fn group_migration_never_folds_off_mainnet() {
        // Testnet/regtest have no distinct legacy branch, so no machine
        // pairs can exist — pair-looking names stay singletons.
        let mut config = BtcxWalletConfig::default();
        let net = WalletNetwork::Testnet;
        config.set_wallet_meta(net, "acct", ungrouped_seed_meta(1));
        config.set_wallet_meta(net, "acct-v31", ungrouped_seed_meta(1));
        assert!(config.migrate_groups());
        assert_eq!(config.group_of(net, "acct-v31"), "acct-v31");
    }

    #[test]
    fn group_and_snapshot_survive_policy_updates_and_round_trip() {
        let mut config = BtcxWalletConfig::default();
        let net = WalletNetwork::Mainnet;
        let mut meta = ungrouped_seed_meta(0);
        meta.group = "family".to_string();
        config.set_wallet_meta(net, "acct", meta);
        config.set_active_wallet(net, "acct");
        config.set_balance_snapshot(net, "acct", 1234, 42);

        // A policy update (reprobe/branch switch) keeps group + snapshot.
        config.set_policy(net, DescriptorPolicy::default());
        let updated = config.wallet_meta(net, "acct").unwrap();
        assert_eq!(updated.group, "family");
        assert_eq!(updated.balance_snapshot.unwrap().sat, 1234);
        assert_eq!(updated.balance_snapshot.unwrap().height, 42);
        assert!(updated.balance_snapshot.unwrap().at > 0);

        // JSON round trip keeps both; group_of falls back to the own name
        // for unassigned/unregistered wallets.
        let json = serde_json::to_string(&config).unwrap();
        let parsed: BtcxWalletConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.group_of(net, "acct"), "family");
        assert_eq!(parsed.group_of(net, "missing"), "missing");
        assert_eq!(
            parsed.wallet_meta(net, "acct").unwrap().balance_snapshot,
            updated.balance_snapshot
        );

        // Snapshot writes on unregistered wallets are no-ops.
        config.set_balance_snapshot(net, "missing", 1, 1);
        assert!(config.wallet_meta(net, "missing").is_none());

        // A fresh registration via set_policy lands as a singleton group.
        config.set_active_wallet(net, "fresh");
        config.set_policy(net, DescriptorPolicy::default());
        assert_eq!(config.group_of(net, "fresh"), "fresh");
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
