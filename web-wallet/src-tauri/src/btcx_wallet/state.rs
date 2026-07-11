//! Shared state for the nodeless BTCX wallet
//!
//! Follows the node/mining module pattern: one `Arc<...>` managed by Tauri,
//! interior mutability via `Mutex`, config persisted as JSON. On top of
//! that it owns the btcx-crate runtime pieces:
//!
//! - the [`SeedStore`] (seed-at-rest, lock/unlock),
//! - the [`ElectrumPool`] (one long-lived connection per configured server),
//! - the open wallet runtime: bdk [`WalletHandle`] + background
//!   [`SyncWorker`] (which syncs over its OWN connection, per the
//!   wallet-btcx contract) + the `btcx-wallet:sync` event emitter thread.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use electrum_btcx::{ElectrumBackend, ElectrumPool, SyncWorker, WalletEntry, WalletHandle};
use keys_btcx::WalletSeed;
use params_btcx::params::ChainParams;
use seedstore::SeedStore;
use tauri::Emitter;
use wallet_btcx::BdkWalletBackend;

use super::config::{BtcxWalletConfig, DescriptorPolicy, WalletNetwork, WalletSourceCfg, COIN_ID};
use super::descstore::DescStore;
use super::{descriptors, manager};

/// Seed lifecycle as the frontend sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SeedState {
    /// No seed yet — first-run.
    None,
    /// Passphrase-encrypted seed present, passphrase not supplied.
    Locked,
    /// Seed readable (unlocked, or not passphrase-encrypted).
    Unlocked,
}

/// The seedstore passphrase wrap's file magic — the ONLY wrap that needs a
/// user passphrase. The keyring/obfuscation wraps auto-read, so user-facing
/// "lock" affordances key on this, not on encryption-at-rest (a Windows
/// no-passphrase seed is keystore-encrypted yet behaves like an
/// unencrypted Core wallet).
pub(crate) fn seed_needs_passphrase(seed_contents: &str) -> bool {
    seed_contents.trim_start().starts_with("PACTSEEDv1")
}

/// Wallet status snapshot for the frontend (`btcx_wallet_status`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxWalletStatus {
    /// Seed lifecycle: none | locked | unlocked.
    pub seed: SeedState,
    /// Whether the seed is PASSPHRASE-encrypted, i.e. lockable. False for
    /// the transparent at-rest wraps (OS keystore / obfuscation) — those
    /// behave like unencrypted Core wallets.
    pub seed_encrypted: bool,
    /// Whether the wallet runtime is open (bdk wallet + sync worker).
    pub wallet_active: bool,
    /// Whether the nodeless wallet feature is configured active.
    pub active: bool,
    /// Active network name (mainnet, testnet, regtest).
    pub network: String,
    /// Name of the selected wallet on the active network.
    pub wallet_name: String,
    /// The selected wallet is a single-address (`wpkh(WIF)`) wallet — one
    /// address, change to self; the receive page hides "new address".
    pub single_address: bool,
    /// Wallet-cache chain height (bdk checkpoint tip), once open.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_height: Option<u32>,
    /// Seconds since the sync worker last completed a pass — `None` before
    /// the first completed sync (or while closed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_age_secs: Option<u64>,
}

/// The open wallet runtime of the active network.
pub struct WalletRuntime {
    pub params: &'static ChainParams,
    pub network: WalletNetwork,
    /// Name of the wallet this runtime holds open.
    pub wallet_name: String,
    pub policy: DescriptorPolicy,
    pub handle: WalletHandle,
    pub worker: Arc<SyncWorker>,
    /// The wallet HOME server (first configured URL) — the pooled
    /// connection wallet chain reads ride; the worker dials it separately.
    pub home_url: String,
    /// Remaining configured servers: independent views / broadcast fallbacks.
    pub view_urls: Vec<String>,
    /// Tells the sync-event emitter thread to exit with this runtime.
    emitter_stop: Arc<AtomicBool>,
}

/// Internal state for the nodeless BTCX wallet.
pub struct BtcxWalletState {
    /// Persisted configuration.
    pub config: Mutex<BtcxWalletConfig>,
    /// Seed store of ONE wallet, opened lazily and keyed by
    /// `<network>/<wallet name>` so a wallet/network switch reopens the
    /// right store (and drops the previous wallet's held passphrase).
    seed: Mutex<Option<(String, SeedStore)>>,
    /// Descriptor store of ONE (descriptor-source) wallet — the same
    /// lazily-opened, key-scoped pattern as `seed`, for wallets whose key
    /// material is an imported descriptor pair instead of a mnemonic.
    desc: Mutex<Option<(String, DescStore)>>,
    /// Long-lived Electrum connections, one per (coin, url).
    pool: ElectrumPool,
    /// The open wallet runtime, if any.
    runtime: Mutex<Option<WalletRuntime>>,
}

/// Type alias for shared BTCX wallet state.
pub type SharedBtcxWalletState = Arc<BtcxWalletState>;

/// Create a new shared BTCX wallet state. Runs the legacy-layout migration
/// (single shared seed → named wallets) BEFORE anything can open a store —
/// sqlite files move freely only while no runtime holds them.
pub fn create_btcx_wallet_state() -> SharedBtcxWalletState {
    let mut config = BtcxWalletConfig::load();
    match config.migrate_legacy_layout() {
        Ok(true) => {
            if let Err(e) = config.save() {
                log::error!("btcx wallet: saving migrated config failed: {e}");
            }
        }
        Ok(false) => {}
        // Non-fatal: the marker (root seed) stays, the next launch retries.
        Err(e) => log::error!("btcx wallet: legacy layout migration failed: {e}"),
    }
    Arc::new(BtcxWalletState {
        config: Mutex::new(config),
        seed: Mutex::new(None),
        desc: Mutex::new(None),
        pool: ElectrumPool::new(),
        runtime: Mutex::new(None),
    })
}

impl BtcxWalletState {
    /// The seed-cache key of the currently selected wallet.
    fn seed_key(config: &BtcxWalletConfig) -> String {
        format!(
            "{}/{}",
            config.network.as_str(),
            config.active_wallet_name()
        )
    }

    /// Run `f` on the ACTIVE wallet's seed store, opening it on first use.
    /// The store lives in that wallet's data dir
    /// (`btcx-wallet/<network>/<name>/`) and holds the unlock passphrase in
    /// memory across calls; selecting another wallet or network drops it.
    pub fn with_seed<T>(
        &self,
        f: impl FnOnce(&mut SeedStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let config = self.get_config();
        let key = Self::seed_key(&config);
        let mut guard = self.seed.lock().map_err(|_| "seed store lock poisoned")?;
        if guard.as_ref().map(|(k, _)| k.as_str()) != Some(key.as_str()) {
            let store = SeedStore::open(&config.active_wallet_root(), None)
                .map_err(|e| format!("Failed to open seed store: {e:#}"))?;
            *guard = Some((key, store));
        }
        f(&mut guard.as_mut().expect("seed store just opened").1)
    }

    /// Run `f` on the ACTIVE wallet's DESCRIPTOR store (descriptor-source
    /// wallets), opening it on first use — the `with_seed` twin. The store
    /// holds the unlock passphrase in memory across calls; selecting
    /// another wallet or network drops it.
    pub fn with_desc<T>(
        &self,
        f: impl FnOnce(&mut DescStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let config = self.get_config();
        let key = Self::seed_key(&config);
        let mut guard = self
            .desc
            .lock()
            .map_err(|_| "descriptor store lock poisoned")?;
        if guard.as_ref().map(|(k, _)| k.as_str()) != Some(key.as_str()) {
            let store = DescStore::open(&config.active_wallet_root())?;
            *guard = Some((key, store));
        }
        f(&mut guard.as_mut().expect("descriptor store just opened").1)
    }

    /// The key-material source of the ACTIVE wallet (registry lookup;
    /// unregistered wallets default to seed).
    pub fn active_source(&self, config: &BtcxWalletConfig) -> WalletSourceCfg {
        config
            .wallet_meta(config.network, &config.active_wallet_name())
            .map(|m| m.source)
            .unwrap_or_default()
    }

    /// Drop the in-memory seed AND descriptor stores (and with them any
    /// held passphrase). The next `with_seed`/`with_desc` reopens them
    /// without a passphrase.
    pub fn drop_seed_passphrase(&self) {
        if let Ok(mut guard) = self.seed.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.desc.lock() {
            *guard = None;
        }
    }

    /// Snapshot of the current configuration.
    pub fn get_config(&self) -> BtcxWalletConfig {
        self.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    /// Update + persist the configuration.
    pub fn update_config(
        &self,
        f: impl FnOnce(&mut BtcxWalletConfig),
    ) -> Result<BtcxWalletConfig, String> {
        let mut guard = self.config.lock().map_err(|_| "config lock poisoned")?;
        f(&mut guard);
        guard.save()?;
        Ok(guard.clone())
    }

    /// Whether the wallet runtime is currently open.
    pub fn is_open(&self) -> bool {
        self.runtime.lock().map(|r| r.is_some()).unwrap_or(false)
    }

    /// Open the wallet runtime (bdk wallet + sync worker + sync-event
    /// emitter) if everything it needs is available. Returns `Ok(false)` —
    /// not an error — when prerequisites are missing: no seed yet, seed
    /// locked, or no Electrum server configured for the active network.
    pub fn open_runtime(&self, app: Option<tauri::AppHandle>) -> Result<bool, String> {
        if self.is_open() {
            return Ok(true);
        }
        let config = self.get_config();
        let servers = config.servers();
        if servers.is_empty() {
            log::info!(
                "btcx wallet: no Electrum servers configured for {} — wallet stays closed",
                config.network.as_str()
            );
            return Ok(false);
        }
        let params = config.network.params();
        let policy = config.policy();
        let home_url = servers[0].clone();
        let view_urls: Vec<String> = servers[1..].to_vec();

        let handle = match self.active_source(&config) {
            WalletSourceCfg::Seed => {
                // Locked or absent seed: not an error, the wallet just
                // stays closed.
                let Ok(mnemonic) = self.with_seed(|s| s.mnemonic().map_err(|e| format!("{e:#}")))
                else {
                    return Ok(false);
                };
                let seed = WalletSeed::from_mnemonic(&mnemonic, "")
                    .map_err(|e| format!("Failed to derive wallet seed: {e:#}"))?;
                manager::open_wallet(&config.wallet_db_path(), params, &seed, policy)
                    .map_err(|e| format!("Failed to open wallet: {e:#}"))?
            }
            WalletSourceCfg::Descriptor => {
                // Locked or absent descriptor store: same closed verdict.
                let Ok(payload) = self.with_desc(|d| d.payload()) else {
                    return Ok(false);
                };
                manager::open_wallet_from_descriptors(
                    &config.wallet_db_path(),
                    params,
                    &payload.external,
                    payload.internal.as_deref(),
                    descriptors::bdk_network(config.network),
                )
                .map_err(|e| format!("Failed to open wallet: {e:#}"))?
            }
        };

        // The worker gets its OWN connection to the home server (never the
        // pooled one) so each socket has exactly one caller domain — see
        // wallet_btcx::WalletManager::ensure_worker.
        let worker_chain = Arc::new(
            ElectrumBackend::new(params, &home_url)
                .map_err(|e| format!("Failed to set up Electrum connection: {e:#}"))?,
        );
        let worker = SyncWorker::spawn(COIN_ID, worker_chain, &handle);

        let emitter_stop = Arc::new(AtomicBool::new(false));
        if let Some(app) = app {
            spawn_sync_emitter(
                app,
                config.network,
                handle.clone(),
                worker.clone(),
                home_url.clone(),
                view_urls.clone(),
                emitter_stop.clone(),
            );
        }

        let runtime = WalletRuntime {
            params,
            network: config.network,
            wallet_name: config.active_wallet_name(),
            policy,
            handle,
            worker,
            home_url,
            view_urls,
            emitter_stop,
        };
        *self.runtime.lock().map_err(|_| "runtime lock poisoned")? = Some(runtime);
        log::info!(
            "btcx wallet '{}' opened on {} ({:?}, coin type 0x{:x})",
            config.active_wallet_name(),
            config.network.as_str(),
            policy.kind,
            policy.coin_type
        );
        Ok(true)
    }

    /// Close the wallet runtime: stop the sync worker and the emitter
    /// thread, drop the wallet handle (and with it the in-memory keys).
    pub fn close_runtime(&self) {
        let runtime = self.runtime.lock().ok().and_then(|mut r| r.take());
        if let Some(runtime) = runtime {
            runtime.emitter_stop.store(true, Ordering::Relaxed);
            runtime.worker.shutdown();
            log::info!("btcx wallet closed");
        }
    }

    /// Build the per-call wallet backend from the open runtime: pooled home
    /// connection for chain reads, the other configured servers as
    /// broadcast-fallback views, the shared wallet handle + worker for the
    /// wallet operations (the wallet-btcx consumption pattern).
    pub fn backend(&self) -> Result<BdkWalletBackend, String> {
        let guard = self.runtime.lock().map_err(|_| "runtime lock poisoned")?;
        let rt = guard.as_ref().ok_or(
            "The nodeless wallet is not open — create or restore a seed, unlock it, and \
             configure an Electrum server first",
        )?;
        let live: Vec<&str> = std::iter::once(rt.home_url.as_str())
            .chain(rt.view_urls.iter().map(String::as_str))
            .collect();
        let chain = self
            .pool
            .get(rt.params, COIN_ID, &rt.home_url, &live)
            .map_err(|e| format!("Electrum connection: {e:#}"))?;
        let views = rt
            .view_urls
            .iter()
            .map(|url| self.pool.get(rt.params, COIN_ID, url, &live))
            .collect::<anyhow::Result<Vec<_>>>()
            .map_err(|e| format!("Electrum connection: {e:#}"))?;
        Ok(BdkWalletBackend::new(
            rt.params,
            chain,
            views,
            Some((rt.handle.clone(), rt.worker.clone())),
        ))
    }

    /// A pooled Electrum connection to the FIRST configured server of the
    /// active network — for operations that need the chain but not an open
    /// wallet (restore probing).
    pub fn probe_chain(&self) -> Result<Arc<ElectrumBackend>, String> {
        let config = self.get_config();
        let servers = config.servers();
        let home = servers.first().ok_or_else(|| {
            format!(
                "No Electrum server configured for {} — add one first",
                config.network.as_str()
            )
        })?;
        let live: Vec<&str> = servers.iter().map(String::as_str).collect();
        self.pool
            .get(config.network.params(), COIN_ID, home, &live)
            .map_err(|e| format!("Electrum connection: {e:#}"))
    }

    /// Broadcast a raw transaction over Electrum — chain-only: needs no
    /// seed and no open wallet runtime, only a configured server for
    /// `network` (default: the active network). This is what the desktop
    /// Transaction Builder's "broadcast via Electrum" rides.
    pub fn broadcast_tx(
        &self,
        tx_hex: &str,
        network: Option<WalletNetwork>,
    ) -> Result<String, String> {
        let config = self.get_config();
        let network = network.unwrap_or(config.network);
        let servers = config.servers_for(network);
        if servers.is_empty() {
            return Err(format!(
                "No Electrum server configured for {} — add one in the wallet settings first",
                network.as_str()
            ));
        }
        broadcast_tx_over_electrum(network.params(), &servers, tx_hex)
    }

    /// Run `f` on the open wallet entry (bdk wallet + sqlite connection).
    pub fn with_entry<T>(
        &self,
        f: impl FnOnce(&mut WalletEntry) -> Result<T, String>,
    ) -> Result<T, String> {
        let guard = self.runtime.lock().map_err(|_| "runtime lock poisoned")?;
        let rt = guard.as_ref().ok_or("The nodeless wallet is not open")?;
        let handle = rt.handle.clone();
        drop(guard);
        let mut entry = handle.lock().map_err(|_| "wallet entry poisoned")?;
        f(&mut entry)
    }

    /// Poke the sync worker for an immediate pass.
    pub fn poke(&self) -> Result<(), String> {
        let guard = self.runtime.lock().map_err(|_| "runtime lock poisoned")?;
        let rt = guard.as_ref().ok_or("The nodeless wallet is not open")?;
        rt.worker.poke();
        Ok(())
    }

    /// The open runtime's (home, views) server URLs, if any — the health
    /// command uses this to stamp server roles.
    pub fn runtime_urls(&self) -> Option<(String, Vec<String>)> {
        self.runtime
            .lock()
            .ok()?
            .as_ref()
            .map(|rt| (rt.home_url.clone(), rt.view_urls.clone()))
    }

    /// Bounded wait for the sync worker's first completed pass of this run,
    /// poking it first — operations that BUILD/SPEND call this so they can
    /// never coin-select from a cache that has not seen the chain at all
    /// (mirrors wallet-btcx's `with_synced_wallet` guard). Steady state
    /// costs nothing: the latch is already set.
    pub fn ensure_first_sync(&self) -> Result<(), String> {
        let worker = {
            let guard = self.runtime.lock().map_err(|_| "runtime lock poisoned")?;
            let rt = guard.as_ref().ok_or("The nodeless wallet is not open")?;
            rt.worker.clone()
        };
        worker.poke();
        if !worker.wait_first_sync(electrum_btcx::FIRST_SYNC_WAIT) {
            return Err(
                "The wallet has not completed its first chain sync yet — check that the \
                 Electrum server is reachable, then retry"
                    .to_string(),
            );
        }
        Ok(())
    }

    /// Current status snapshot (`btcx_wallet_status`).
    ///
    /// For descriptor-source wallets the "seed" lifecycle fields describe
    /// the descriptor store instead — same states, same lock/unlock UX.
    pub fn status(&self) -> Result<BtcxWalletStatus, String> {
        let config = self.get_config();
        let seed = match self.active_source(&config) {
            WalletSourceCfg::Seed => {
                let seed_status =
                    self.with_seed(|s| s.wallet_status().map_err(|e| format!("{e:#}")))?;
                if !seed_status.seed_exists {
                    SeedState::None
                } else if seed_status.locked {
                    SeedState::Locked
                } else {
                    SeedState::Unlocked
                }
            }
            WalletSourceCfg::Descriptor => {
                let desc_status = self.with_desc(|d| Ok(d.status()))?;
                if !desc_status.exists {
                    SeedState::None
                } else if desc_status.locked {
                    SeedState::Locked
                } else {
                    SeedState::Unlocked
                }
            }
        };

        let (wallet_active, synced_height, sync_age_secs) = {
            let guard = self.runtime.lock().map_err(|_| "runtime lock poisoned")?;
            match guard.as_ref() {
                Some(rt) => {
                    let height = rt
                        .handle
                        .lock()
                        .ok()
                        .map(|entry| entry.wallet.latest_checkpoint().height());
                    let age = rt.worker.fresh_age().map(|d| d.as_secs());
                    (true, height, age)
                }
                None => (false, None, None),
            }
        };

        // "Encrypted" for the UI = passphrase-lockable. The keystore/
        // obfuscation wraps auto-read and must present like an unencrypted
        // Core wallet (no padlock).
        let seed_encrypted = seed != SeedState::None
            && match self.active_source(&config) {
                WalletSourceCfg::Seed => {
                    std::fs::read_to_string(config.active_wallet_root().join(seedstore::SEED_FILE))
                        .map(|contents| seed_needs_passphrase(&contents))
                        .unwrap_or(false)
                }
                WalletSourceCfg::Descriptor => std::fs::read_to_string(
                    config
                        .active_wallet_root()
                        .join(super::descstore::DESCRIPTOR_FILE),
                )
                .map(|contents| super::descstore::is_passphrase_descriptor_file(&contents))
                .unwrap_or(false),
            };

        let single_address = config
            .wallet_meta(config.network, &config.active_wallet_name())
            .map(|m| m.single_address)
            .unwrap_or(false);

        Ok(BtcxWalletStatus {
            seed,
            seed_encrypted,
            wallet_active,
            active: config.active,
            network: config.network.as_str().to_string(),
            wallet_name: config.active_wallet_name(),
            single_address,
            synced_height,
            sync_age_secs,
        })
    }
}

/// Payload of the `btcx-wallet:sync` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncEvent {
    network: &'static str,
    height: u32,
    sync_age_secs: Option<u64>,
    /// Aggregate Electrum connectivity as the toolbar indicator shows it:
    /// `connecting` (home server untested), `healthy`, `degraded` (home
    /// down, a view still healthy), `down`.
    overall: &'static str,
}

/// Aggregate Electrum connectivity from the passive per-server health
/// cells: the HOME server (the one the sync worker rides) decides between
/// healthy/connecting; when it is down, a healthy view downgrades to
/// `degraded` instead of `down`.
pub fn overall_health(home_url: &str, view_urls: &[String]) -> &'static str {
    use electrum_btcx::HealthState;
    let state = |url: &str| electrum_btcx::server_health(COIN_ID, url).state();
    match state(home_url) {
        HealthState::Healthy => "healthy",
        HealthState::Untested => "connecting",
        HealthState::Down { .. } => {
            if view_urls
                .iter()
                .any(|u| matches!(state(u), HealthState::Healthy))
            {
                "degraded"
            } else {
                "down"
            }
        }
    }
}

/// Emit `btcx-wallet:sync` to the frontend on sync completion, on every
/// height change, and on every aggregate-health change: a small polling
/// thread over the worker's freshness latch, the wallet's checkpoint tip
/// and the passive health cells (the SyncWorker surface has no callback
/// hook; polling its cheap accessors is the sanctioned pattern). Exits with
/// the runtime that spawned it.
fn spawn_sync_emitter(
    app: tauri::AppHandle,
    network: WalletNetwork,
    handle: WalletHandle,
    worker: Arc<SyncWorker>,
    home_url: String,
    view_urls: Vec<String>,
    stop: Arc<AtomicBool>,
) {
    let result = std::thread::Builder::new()
        .name("btcx-wallet-sync-emitter".to_string())
        .spawn(move || {
            let mut last: Option<(u32, &'static str)> = None;
            loop {
                // ~3s cadence, checking the stop flag every 500ms so a
                // close/network-switch never waits on a sleeping thread.
                for _ in 0..6 {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
                let age = worker.fresh_age();
                let Ok(entry) = handle.lock() else { return };
                let height = entry.wallet.latest_checkpoint().height();
                drop(entry);
                let overall = overall_health(&home_url, &view_urls);
                if last != Some((height, overall)) {
                    last = Some((height, overall));
                    let _ = app.emit(
                        "btcx-wallet:sync",
                        SyncEvent {
                            network: network.as_str(),
                            height,
                            sync_age_secs: age.map(|d| d.as_secs()),
                            overall,
                        },
                    );
                }
            }
        });
    if let Err(e) = result {
        log::warn!("btcx wallet: failed to spawn sync emitter: {e}");
    }
}

/// Chain-only Electrum broadcast: decode `tx_hex` and hand it to the first
/// server that takes it, trying each of `servers` in turn (the serial
/// fan-over pattern of wallet-btcx's broadcast_fan). Deliberately dials
/// FRESH connections instead of going through the pool: broadcasts are rare,
/// and the pool's live-URL pruning is keyed to the active network's server
/// list — which this call, unlike everything else, may not be using.
///
/// Errors distinguish the three failure shapes: `servers` empty (caller
/// guards, but kept for direct users like the integration test), no server
/// reachable, and the transaction being rejected.
pub fn broadcast_tx_over_electrum(
    params: &'static ChainParams,
    servers: &[String],
    tx_hex: &str,
) -> Result<String, String> {
    if servers.is_empty() {
        return Err("No Electrum server configured — add one in the wallet settings first".into());
    }
    let tx: bitcoin::Transaction = bitcoin::consensus::encode::deserialize_hex(tx_hex.trim())
        .map_err(|e| format!("Not a valid raw transaction: {e}"))?;

    // Connection failures and rejections are kept apart: a rejection is
    // definitive for that server but another server MIGHT still take the tx
    // (mempool policy differences), so the fan-over continues either way and
    // the rejection — the more actionable message — wins the error report.
    // `new` dials lazily, so reachability is probed with a cheap `tip()`
    // first: a server that cannot even answer that is unreachable, one that
    // can but refuses the broadcast rejected the transaction.
    let mut last_reject: Option<String> = None;
    let mut last_connect: Option<String> = None;
    for url in servers {
        let backend = match ElectrumBackend::new(params, url) {
            Ok(backend) => backend,
            Err(e) => {
                last_connect = Some(format!("{url}: {e:#}"));
                continue;
            }
        };
        if let Err(e) = backend.tip() {
            last_connect = Some(format!("{url}: {e:#}"));
            continue;
        }
        match backend.broadcast(&tx) {
            Ok(txid) => return Ok(txid.to_string()),
            Err(e) => last_reject = Some(format!("{url}: {e:#}")),
        }
    }
    match (last_reject, last_connect) {
        (Some(reject), _) => Err(format!("Transaction rejected — {reject}")),
        (None, Some(connect)) => Err(format!("No Electrum server reachable — {connect}")),
        (None, None) => unreachable!("servers is non-empty"),
    }
}
