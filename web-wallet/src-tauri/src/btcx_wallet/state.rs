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

use bdk_wallet::KeychainKind;
use electrum_btcx::{
    ChainMismatch, ElectrumBackend, ElectrumPool, SyncWorker, WalletEntry, WalletHandle, STOP_GAP,
};
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
    /// Serializes store-opening operations: the runtime open and the
    /// group-sync one-shots (`one_shot_compartment_sync`). Two writers on
    /// one compartment's sqlite would trade "database is locked" errors —
    /// the same failure class as the Windows file-lock bug behind PR #156.
    sync_gate: Mutex<()>,
    /// Weak handles of recently CLOSED wallets, keyed `<network>/<name>`.
    /// A worker/emitter thread can outlive its close while blocked in a
    /// connect attempt, still holding the sqlite open — on Windows that
    /// fails any directory move. Rename/delete wait on these via
    /// [`Self::wait_wallet_released`] instead of blind retries.
    closing: Mutex<Vec<(String, std::sync::Weak<Mutex<WalletEntry>>)>>,
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
    // Assign wallet-selector groups (config rewrite only, wallet dirs
    // untouched). The pre-migration config is backed up once, first.
    if config.migrate_groups() {
        BtcxWalletConfig::backup_config_file("pre-groups");
        if let Err(e) = config.save() {
            log::error!("btcx wallet: saving group-migrated config failed: {e}");
        }
    }
    Arc::new(BtcxWalletState {
        config: Mutex::new(config),
        seed: Mutex::new(None),
        desc: Mutex::new(None),
        pool: ElectrumPool::new(),
        runtime: Mutex::new(None),
        sync_gate: Mutex::new(()),
        closing: Mutex::new(Vec::new()),
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
    ///
    /// Takes `&Arc<Self>` so the sync emitter can persist balance
    /// snapshots; serialized against the group-sync one-shots via
    /// `sync_gate` so no compartment store ever has two writers.
    pub fn open_runtime(self: &Arc<Self>, app: Option<tauri::AppHandle>) -> Result<bool, String> {
        let _gate = self.sync_gate.lock().map_err(|_| "sync gate poisoned")?;
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
        // F3: verify the chain the wallet is about to sync against BEFORE the
        // first sync. Elect a server whose genesis matches and that is not
        // pruned; fall over past an unreachable / wrong-chain / pruned server
        // to a healthy one so one bad server never bricks the wallet. A
        // reachable server that DISAGREES with no healthy alternative is a
        // connection error (the UI already handles it) — never a silent sync
        // against an unverified server.
        let (home_url, view_urls) =
            self.elect_verified_home(&servers, params, config.network.as_str())?;

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
                self.clone(),
                config.network,
                config.active_wallet_name(),
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
    /// Persists a final balance snapshot first (best-effort) so the wallet
    /// selector keeps a last-known balance across a switch/close.
    pub fn close_runtime(&self) {
        let runtime = self.runtime.lock().ok().and_then(|mut r| r.take());
        if let Some(runtime) = runtime {
            if let Ok(entry) = runtime.handle.lock() {
                let sat = entry.wallet.balance().total().to_sat();
                let height = entry.wallet.latest_checkpoint().height();
                drop(entry);
                let _ = self.update_config(|c| {
                    c.set_balance_snapshot(runtime.network, &runtime.wallet_name, sat, height);
                });
            }
            runtime.emitter_stop.store(true, Ordering::Relaxed);
            runtime.worker.shutdown();
            // The worker/emitter may outlive this close (a blocking connect
            // ignores the shutdown flag) — leave a weak marker so
            // rename/delete can wait for the actual sqlite release.
            self.track_closing(runtime.network, &runtime.wallet_name, &runtime.handle);
            log::info!("btcx wallet closed");
        }
    }

    /// Remember a just-closed wallet's handle (weakly) for
    /// [`Self::wait_wallet_released`]. Dead entries are pruned in passing.
    fn track_closing(&self, network: WalletNetwork, name: &str, handle: &WalletHandle) {
        if let Ok(mut closing) = self.closing.lock() {
            closing.retain(|(_, weak)| weak.strong_count() > 0);
            closing.push((
                format!("{}/{name}", network.as_str()),
                Arc::downgrade(handle),
            ));
        }
    }

    /// Bounded wait until every straggler thread of a CLOSED wallet has
    /// dropped its handle (= its sqlite is really closed and the wallet
    /// directory is movable). `true` = released; `false` = still held at
    /// the deadline (the caller's move will fail honestly).
    pub fn wait_wallet_released(
        &self,
        network: WalletNetwork,
        name: &str,
        timeout: std::time::Duration,
    ) -> bool {
        let key = format!("{}/{name}", network.as_str());
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let held = self
                .closing
                .lock()
                .map(|c| c.iter().any(|(k, w)| *k == key && w.strong_count() > 0))
                .unwrap_or(false);
            if !held {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    /// The (network, name) of the wallet the open runtime holds, if any.
    pub fn open_wallet_name(&self) -> Option<(WalletNetwork, String)> {
        self.runtime
            .lock()
            .ok()?
            .as_ref()
            .map(|rt| (rt.network, rt.wallet_name.clone()))
    }

    /// One-shot sync of one NON-OPEN wallet of the active network — the
    /// group-sync building block. Opens the wallet's store temporarily,
    /// runs a bounded first sync on a dedicated worker, persists the
    /// balance snapshot, and tears everything down again. If the wallet is
    /// the OPEN one, its live balance is snapshotted instead (no second
    /// writer on its store). Returns `(total_sat, height)`.
    ///
    /// Serialized against `open_runtime` via `sync_gate`, so a wallet
    /// switch mid-group-sync waits (bounded by the first-sync timeout)
    /// instead of colliding on the compartment's sqlite.
    pub fn one_shot_compartment_sync(&self, name: &str) -> Result<(u64, u32), String> {
        let _gate = self.sync_gate.lock().map_err(|_| "sync gate poisoned")?;
        let config = self.get_config();
        let network = config.network;

        // The open wallet is live — snapshot its cache, never its store.
        if self.open_wallet_name() == Some((network, name.to_string())) {
            let (sat, height) = self.with_entry(|entry| {
                Ok((
                    entry.wallet.balance().total().to_sat(),
                    entry.wallet.latest_checkpoint().height(),
                ))
            })?;
            self.update_config(|c| c.set_balance_snapshot(network, name, sat, height))?;
            return Ok((sat, height));
        }

        let meta = config
            .wallet_meta(network, name)
            .ok_or_else(|| format!("No wallet named '{name}' on {}", network.as_str()))?;
        let servers = config.servers();
        if servers.is_empty() {
            return Err(format!(
                "No Electrum server configured for {}",
                network.as_str()
            ));
        }
        let params = network.params();
        // Same chain-verified election as the runtime open: a one-shot that
        // synced against a wrong-chain server would write garbage into the
        // compartment's persistent store.
        let (home_url, _views) = self.elect_verified_home(&servers, params, network.as_str())?;

        let root = BtcxWalletConfig::wallet_root(network, name);
        let db_path = BtcxWalletConfig::wallet_db_path_for(network, name);
        let handle = match meta.source {
            WalletSourceCfg::Seed => {
                // Standalone store — the state's cached seed store belongs
                // to the ACTIVE wallet and must not be repointed here.
                let store = SeedStore::open(&root, None)
                    .map_err(|e| format!("Failed to open seed store: {e:#}"))?;
                let mnemonic = store
                    .mnemonic()
                    .map_err(|_| format!("The seed of '{name}' is locked"))?;
                let seed = WalletSeed::from_mnemonic(&mnemonic, "")
                    .map_err(|e| format!("Failed to derive wallet seed: {e:#}"))?;
                manager::open_wallet(&db_path, params, &seed, meta.policy)
                    .map_err(|e| format!("Failed to open wallet: {e:#}"))?
            }
            WalletSourceCfg::Descriptor => {
                let store = DescStore::open(&root)?;
                let payload = store
                    .payload()
                    .map_err(|_| format!("The descriptor store of '{name}' is locked"))?;
                manager::open_wallet_from_descriptors(
                    &db_path,
                    params,
                    &payload.external,
                    payload.internal.as_deref(),
                    descriptors::bdk_network(network),
                )
                .map_err(|e| format!("Failed to open wallet: {e:#}"))?
            }
        };

        let worker_chain = Arc::new(
            ElectrumBackend::new(params, &home_url)
                .map_err(|e| format!("Failed to set up Electrum connection: {e:#}"))?,
        );
        let worker = SyncWorker::spawn(COIN_ID, worker_chain, &handle);
        worker.poke();
        let synced = worker.wait_first_sync(electrum_btcx::FIRST_SYNC_WAIT);
        worker.shutdown();
        // Same straggler hazard as close_runtime: the one-shot worker may
        // outlive this call while blocked in a connect.
        self.track_closing(network, name, &handle);
        if !synced {
            return Err(format!(
                "'{name}' has not completed a sync pass — Electrum server unreachable?"
            ));
        }
        let (sat, height) = {
            let entry = handle.lock().map_err(|_| "wallet entry poisoned")?;
            (
                entry.wallet.balance().total().to_sat(),
                entry.wallet.latest_checkpoint().height(),
            )
        };
        self.update_config(|c| c.set_balance_snapshot(network, name, sat, height))?;
        Ok((sat, height))
    }

    /// Look-ahead sweep past the revealed address range of an OPEN wallet.
    ///
    /// The sync layer's steady-state contract covers REVEALED spks only —
    /// correct for a single instance (every handout reveals first), but a
    /// seed may live on several devices: an address handed out by the
    /// desktop instance is unrevealed here, and funds sent to it stay
    /// invisible forever (field report: pool payouts to a desktop-issued
    /// address froze the mobile balance at its restore-time state, while
    /// the height kept rising). One batched `histories` call over the next
    /// [`STOP_GAP`] unrevealed spks per keychain (peek — never reveals by
    /// itself); hits are revealed-through + persisted (the probe-reach
    /// pattern), so the next worker pass picks their history up on the
    /// normal revealed path. Only USED addresses get revealed, so the
    /// wallet's unused-ahead handout cap is never inflated. Returns
    /// whether anything new was revealed (the caller pokes the worker).
    pub fn gap_watch(&self, handle: &WalletHandle) -> Result<bool, String> {
        // Derive the look-ahead windows under a brief lock (pure CPU).
        let jobs = {
            let entry = handle.lock().map_err(|_| "wallet entry poisoned")?;
            // Single-address stores have one non-wildcard keychain — no gap.
            if entry.wallet.keychains().count() < 2 {
                return Ok(false);
            }
            [KeychainKind::External, KeychainKind::Internal]
                .into_iter()
                .map(|keychain| {
                    let start = entry
                        .wallet
                        .derivation_index(keychain)
                        .map_or(0, |i| i + 1);
                    let spks: Vec<bitcoin::ScriptBuf> = (start..start + STOP_GAP)
                        .map(|i| {
                            entry
                                .wallet
                                .peek_address(keychain, i)
                                .address
                                .script_pubkey()
                        })
                        .collect();
                    (keychain, start, spks)
                })
                .collect::<Vec<_>>()
        };

        let chain = self.probe_chain()?;
        let mut revealed_any = false;
        for (keychain, start, spks) in jobs {
            let histories = chain
                .histories(&spks)
                .map_err(|e| format!("gap watch histories: {e:#}"))?;
            if let Some(deepest) = histories.iter().rposition(|h| !h.is_empty()) {
                let mut guard = handle.lock().map_err(|_| "wallet entry poisoned")?;
                let entry = &mut *guard;
                let _ = entry
                    .wallet
                    .reveal_addresses_to(keychain, start + deepest as u32);
                entry
                    .wallet
                    .persist(&mut entry.conn)
                    .map_err(|e| format!("persisting gap-watch reveal: {e}"))?;
                log::info!(
                    "btcx wallet: gap watch found history beyond the revealed range \
                     ({keychain:?} index {}) — revealing through it",
                    start + deepest as u32
                );
                revealed_any = true;
            }
        }
        Ok(revealed_any)
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

    /// Like [`probe_chain`], but VERIFIES the elected server's chain (genesis
    /// match + not pruned) first, falling over to the next configured server
    /// if the first is unreachable / wrong-chain / pruned. Restore probing
    /// rides this: a pruned server serves only recent history, so a real
    /// seed's older transactions look absent and the restore would report the
    /// seed as "fresh" — a real-money-alarming false negative. A restore that
    /// cannot verify ANY configured server therefore FAILS HARD rather than
    /// probe blind against an unverifiable server.
    pub fn verified_probe_chain(&self) -> Result<Arc<ElectrumBackend>, String> {
        let config = self.get_config();
        let servers = config.servers();
        if servers.is_empty() {
            return Err(format!(
                "No Electrum server configured for {} — add one first",
                config.network.as_str()
            ));
        }
        let params = config.network.params();
        let live: Vec<&str> = servers.iter().map(String::as_str).collect();
        let mut last_err: Option<String> = None;
        for url in &servers {
            match self.pool.get(params, COIN_ID, url, &live) {
                Ok(backend) => match backend.verify_chain() {
                    Ok(()) => return Ok(backend),
                    Err(e) => {
                        log::warn!("btcx wallet: restore probe rejected {url}: {e:#}");
                        last_err = Some(format!("{url}: {e:#}"));
                    }
                },
                Err(e) => last_err = Some(format!("{url}: {e:#}")),
            }
        }
        Err(format!(
            "Electrum server is pruned or on the wrong chain — cannot verify wallet history. {}",
            last_err.unwrap_or_default()
        ))
    }

    /// Elect a home server whose chain is VERIFIED (genesis match + not
    /// pruned), returning `(home_url, view_urls)` with the elected server
    /// first and the rest in configured order. The first server that verifies
    /// wins, preserving the user's primary preference. Verification rides the
    /// pool (cheap: `verify_chain` caches its verdict per connection), while
    /// the sync worker still dials the elected URL on its own connection.
    ///
    /// Fall-over verdicts:
    /// - a server that VERIFIES → elected;
    /// - NONE verify but every failure was a mere unreachable server →
    ///   fall back to the configured primary so an offline unlock still opens
    ///   and the sync worker can retry (no server ever DISAGREED about the
    ///   chain — this is not the F3 hazard);
    /// - NONE verify and at least one reachable server actively DISAGREED
    ///   (wrong-chain / pruned [`ChainMismatch`]) → error, surfaced as a
    ///   connection failure the UI already handles. We refuse to silently
    ///   sync a wallet against an unverified / hostile server.
    fn elect_verified_home(
        &self,
        servers: &[String],
        params: &'static ChainParams,
        network: &str,
    ) -> Result<(String, Vec<String>), String> {
        let live: Vec<&str> = servers.iter().map(String::as_str).collect();
        let mut saw_mismatch = false;
        let mut last_err: Option<String> = None;
        for (i, url) in servers.iter().enumerate() {
            let verdict = self
                .pool
                .get(params, COIN_ID, url, &live)
                .and_then(|b| b.verify_chain());
            match verdict {
                Ok(()) => {
                    let views = servers
                        .iter()
                        .enumerate()
                        .filter(|(j, _)| *j != i)
                        .map(|(_, u)| u.clone())
                        .collect();
                    return Ok((url.clone(), views));
                }
                Err(e) => {
                    if e.downcast_ref::<ChainMismatch>().is_some() {
                        saw_mismatch = true;
                    }
                    log::warn!("btcx wallet: server {url} failed chain verification: {e:#}");
                    last_err = Some(format!("{url}: {e:#}"));
                }
            }
        }
        if saw_mismatch {
            Err(format!(
                "No usable Electrum server for {network}: a reachable server is on the wrong \
                 chain or pruned and no configured server could be verified — refusing to sync \
                 against an unverified server. {}",
                last_err.unwrap_or_default()
            ))
        } else {
            // Every failure was an unreachable server, not a disagreement:
            // keep the offline-open behavior (the sync worker retries) rather
            // than brick a wallet whose servers are merely down right now.
            log::warn!(
                "btcx wallet: no Electrum server reachable for {network} at open — opening \
                 offline, the sync worker will retry"
            );
            Ok((servers[0].clone(), servers[1..].to_vec()))
        }
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
/// hook; polling its cheap accessors is the sanctioned pattern). Also
/// persists the live wallet's balance snapshot (selector display) whenever
/// balance or height moved. Exits with the runtime that spawned it.
#[allow(clippy::too_many_arguments)]
fn spawn_sync_emitter(
    app: tauri::AppHandle,
    state: SharedBtcxWalletState,
    network: WalletNetwork,
    wallet_name: String,
    handle: WalletHandle,
    worker: Arc<SyncWorker>,
    home_url: String,
    view_urls: Vec<String>,
    stop: Arc<AtomicBool>,
) {
    let result = std::thread::Builder::new()
        .name("btcx-wallet-sync-emitter".to_string())
        .spawn(move || {
            let mut last: Option<(u32, u64, &'static str)> = None;
            let mut last_snapshot: Option<(u64, u32)> = None;
            // Gap-watch cadence: first pass right after open (a reopened
            // store catches out-of-range funds within seconds), then every
            // ~2 minutes (40 × 3s iterations).
            const GAP_WATCH_EVERY: u32 = 40;
            let mut gap_tick: u32 = GAP_WATCH_EVERY - 1;
            loop {
                // ~3s cadence, checking the stop flag every 500ms so a
                // close/network-switch never waits on a sleeping thread.
                for _ in 0..6 {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
                gap_tick += 1;
                if gap_tick >= GAP_WATCH_EVERY {
                    gap_tick = 0;
                    // Multi-instance seeds: sweep past the revealed range
                    // (see gap_watch) — a hit reveals + re-syncs.
                    match state.gap_watch(&handle) {
                        Ok(true) => worker.poke(),
                        Ok(false) => {}
                        Err(e) => log::debug!("btcx wallet: gap watch skipped: {e}"),
                    }
                }
                let age = worker.fresh_age();
                let Ok(entry) = handle.lock() else { return };
                let height = entry.wallet.latest_checkpoint().height();
                let balance_sat = entry.wallet.balance().total().to_sat();
                drop(entry);
                // Persist the selector snapshot when it moved (a config
                // write — rare: block cadence or an actual balance change).
                if last_snapshot != Some((balance_sat, height)) {
                    last_snapshot = Some((balance_sat, height));
                    let _ = state.update_config(|c| {
                        c.set_balance_snapshot(network, &wallet_name, balance_sat, height);
                    });
                }
                let overall = overall_health(&home_url, &view_urls);
                // BALANCE is part of the change detection: an incoming
                // mempool tx moves the balance WITHOUT a height change,
                // and the remote UIs refresh exclusively on this event —
                // without it, an unconfirmed receive stays invisible
                // until the next block.
                if last != Some((height, balance_sat, overall)) {
                    last = Some((height, balance_sat, overall));
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
