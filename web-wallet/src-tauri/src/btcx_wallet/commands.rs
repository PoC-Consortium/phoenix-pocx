//! Tauri commands for the nodeless BTCX wallet
//!
//! Exposed to the frontend as `btcx_wallet_*`. Commands that can block on
//! the network or on scrypt (create/restore/unlock, sends, fee estimates)
//! are async and run on the blocking pool; cheap cache reads are sync.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use electrum_btcx::{SendFee, WalletEntry};
use keys_btcx::WalletSeed;
use seedstore::SeedStore;
use wallet_btcx::WalletTxInfo;

use super::config::{
    self, BtcxWalletConfig, DescriptorKindCfg, DescriptorPolicy, WalletNetwork, TRASH_SUBDIR,
};
use super::manager::{self, BranchHit};
use super::state::{BtcxWalletStatus, SharedBtcxWalletState};

/// Run a blocking wallet operation off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("Wallet task failed: {e}"))?
}

// ============================================================================
// Status & Seed Lifecycle
// ============================================================================

/// Current wallet status: seed lifecycle, runtime, network, sync freshness.
#[tauri::command]
pub fn btcx_wallet_status(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    state.status()
}

/// Generate a fresh 24-word BIP39 mnemonic WITHOUT persisting it — for the
/// show-and-confirm onboarding flow; commit it with `btcx_wallet_create`.
/// 24 words (256-bit entropy) for parity with the desktop Phoenix create
/// flow; restore keeps accepting both 12- and 24-word phrases.
#[tauri::command]
pub fn btcx_wallet_generate_mnemonic(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<String, String> {
    state.with_seed(|s| s.generate_mnemonic(24).map_err(|e| format!("{e:#}")))
}

/// Resolve + validate the wallet name of a create/restore: an explicit
/// `name`, or the active wallet (the mobile UI's name-less flow).
///
/// Uniqueness is CASE-INSENSITIVE (while the stored name keeps its case):
/// wallet directories live on case-insensitive filesystems on Windows and
/// macOS, where `Johnny` and `johnny` are the same path — Bitcoin Core gets
/// the same outcome from its database-exists check. A leftover on-disk seed
/// (e.g. a wallet restored from `.trash` by hand) is refused too.
fn resolve_new_wallet_name(
    config: &BtcxWalletConfig,
    network: WalletNetwork,
    name: Option<String>,
) -> Result<String, String> {
    let name = name.unwrap_or_else(|| config.active_wallet_name());
    config::validate_wallet_name(&name)?;
    let lower = name.to_ascii_lowercase();
    if let Some(existing) = config
        .wallet_names(network)
        .into_iter()
        .find(|n| n.to_ascii_lowercase() == lower)
    {
        return Err(format!(
            "A wallet named '{existing}' already exists on {}",
            network.as_str()
        ));
    }
    if BtcxWalletConfig::wallet_root(network, &name)
        .join(seedstore::SEED_FILE)
        .exists()
    {
        return Err(format!(
            "A wallet already exists on disk at '{name}' — pick another name",
        ));
    }
    Ok(name)
}

/// Write `mnemonic` into the named wallet's OWN data dir (standalone store
/// — the state's cached store still points at the previously active
/// wallet), then adopt the wallet: close the old runtime, select the new
/// name, record its descriptor policy, and re-hold the passphrase so an
/// encrypted seed opens without an extra unlock round trip.
fn import_into_named_wallet(
    state: &SharedBtcxWalletState,
    network: WalletNetwork,
    name: &str,
    mnemonic: &str,
    passphrase: Option<&str>,
    policy: DescriptorPolicy,
) -> Result<(), String> {
    let root = BtcxWalletConfig::wallet_root(network, name);
    let mut store =
        SeedStore::open(&root, None).map_err(|e| format!("Failed to open seed store: {e:#}"))?;
    store
        .import_seed(mnemonic, passphrase)
        .map(|_| ())
        .map_err(|e| format!("{e:#}"))?;

    state.close_runtime();
    state.drop_seed_passphrase();
    state.update_config(|c| {
        c.set_active_wallet(network, name);
        c.set_policy(network, policy);
        c.active = true;
    })?;
    if let Some(pass) = passphrase.filter(|p| !p.is_empty()) {
        state.with_seed(|s| s.unlock(pass).map_err(|e| format!("{e:#}")))?;
    }
    Ok(())
}

/// The full create flow (resolve name → import → open runtime → status),
/// shared by the `btcx_wallet_create` command and the regtest integration
/// tests (which run it without an `AppHandle`).
pub fn create_wallet_impl(
    state: &SharedBtcxWalletState,
    app: Option<AppHandle>,
    mnemonic: &str,
    passphrase: Option<&str>,
    name: Option<String>,
    kind: Option<DescriptorKindCfg>,
) -> Result<BtcxWalletStatus, String> {
    let config = state.get_config();
    let network = config.network;
    let name = resolve_new_wallet_name(&config, network, name)?;
    let policy = DescriptorPolicy {
        kind: kind.unwrap_or(DescriptorKindCfg::Bip84),
        ..DescriptorPolicy::default()
    };
    import_into_named_wallet(state, network, &name, mnemonic, passphrase, policy)?;
    // No Electrum server configured yet is fine — the runtime opens
    // later, when one is (Ok(false)).
    state.open_runtime(app)?;
    state.status()
}

/// Create a wallet from a (freshly generated, user-confirmed) mnemonic.
/// An optional passphrase encrypts the seed at rest (it is NOT a BIP39
/// word-25 — derivation always uses an empty BIP39 passphrase, so the
/// mnemonic alone always recovers the funds). New wallets derive at the
/// BTCX coin type on the `kind` branch — BIP-84 unless the caller
/// explicitly asks for BIP-86 (the mobile create flow's advanced address-
/// type choice). Refuses to overwrite an existing seed. `name` picks the
/// named wallet to create (default: the active wallet — the mobile flow);
/// the created wallet becomes the active one.
#[tauri::command]
pub async fn btcx_wallet_create(
    mnemonic: String,
    passphrase: Option<String>,
    name: Option<String>,
    kind: Option<DescriptorKindCfg>,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    let state = state.inner().clone();
    blocking(move || {
        create_wallet_impl(
            &state,
            Some(app),
            &mnemonic,
            passphrase.as_deref(),
            name,
            kind,
        )
    })
    .await
}

/// What a restore (or a later re-probe) found and did: the branch the
/// wallet opened on, EVERY branch with history (candidate priority order),
/// and the honest fresh verdict when none had any.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxRestoreResult {
    pub status: BtcxWalletStatus,
    /// The branch the wallet opened with (also recorded in the config).
    pub selected: DescriptorPolicy,
    /// Every probed branch with history, candidate priority order. More
    /// than one entry means funds/history also exist on branches this
    /// wallet does NOT open — the desktop restore imports them all.
    pub hits: Vec<BranchHit>,
    /// True when NO branch had history — the wallet starts fresh on the
    /// default branch (BIP-84 / BTCX coin type).
    pub fresh: bool,
}

/// Open the runtime and, when the winning branch has probe hits beyond the
/// first sync's gap-scan reach, pre-reveal addresses through them (see
/// `manager::ensure_probe_reach`). Reveal failures are logged, not fatal:
/// the seed is already imported and the hit list still tells the UI where
/// history lives.
fn open_after_probe(
    state: &SharedBtcxWalletState,
    app: Option<AppHandle>,
    hits: &[BranchHit],
    selected: DescriptorPolicy,
) -> Result<(), String> {
    state.open_runtime(app)?;
    if let Some(hit) = hits.iter().find(|h| h.policy == selected) {
        let reach = state.with_entry(|entry| {
            manager::ensure_probe_reach(entry, hit).map_err(|e| format!("{e:#}"))
        });
        if let Err(e) = reach {
            log::warn!("btcx wallet: revealing probe reach after restore failed: {e}");
        }
    }
    Ok(())
}

/// The full restore flow (resolve name → probe → import → open runtime),
/// shared by the `btcx_wallet_restore` command and the regtest integration
/// tests (which run it without an `AppHandle`). See the command docs for
/// the `kind` semantics.
pub fn restore_wallet_impl(
    state: &SharedBtcxWalletState,
    app: Option<AppHandle>,
    mnemonic: &str,
    passphrase: Option<&str>,
    name: Option<String>,
    kind: Option<DescriptorKindCfg>,
) -> Result<BtcxRestoreResult, String> {
    // Validate + derive + resolve the name first: nothing is written if
    // the phrase is bad, the name is taken, or the probe cannot run.
    let config = state.get_config();
    let network = config.network;
    let name = resolve_new_wallet_name(&config, network, name)?;
    let seed = WalletSeed::from_mnemonic(mnemonic.trim(), "").map_err(|e| format!("{e:#}"))?;
    let chain = state.probe_chain()?;
    let hits = manager::probe_all_branches(&seed, &chain)
        .map_err(|e| format!("Restore probing failed: {e:#}"))?;
    let (selected, fresh) = match kind {
        Some(kind) => manager::select_restore_policy_for_kind(&hits, kind),
        None => manager::select_restore_policy(&hits),
    };

    import_into_named_wallet(state, network, &name, mnemonic, passphrase, selected)?;
    open_after_probe(state, app, &hits, selected)?;
    Ok(BtcxRestoreResult {
        status: state.status()?,
        selected,
        hits,
        fresh,
    })
}

/// Restore the wallet from an existing mnemonic. Probes ALL descriptor
/// branches the seed's history could live on (BIP-84/86 × BTCX-coin-type/
/// legacy coin-0 — see `manager`) against the configured Electrum server
/// BEFORE importing, opens the highest-priority branch with history, and
/// reports every hit plus an honest fresh verdict. Requires a configured,
/// reachable Electrum server — restoring blind could silently hide legacy
/// funds.
///
/// `kind` (optional, additive) FORCES the descriptor family the wallet
/// opens with: the highest-priority hit of that family wins, or — when no
/// probed branch of that family has history — the fresh default at the
/// BTCX coin type. The mobile "create both wallets" flow calls restore a
/// second time with the OTHER family's kind so a seed with history on both
/// BIP-84 and BIP-86 ends up as two named wallets over the same mnemonic.
/// Without `kind` the behavior is exactly the pre-existing one.
#[tauri::command]
pub async fn btcx_wallet_restore(
    mnemonic: String,
    passphrase: Option<String>,
    name: Option<String>,
    kind: Option<DescriptorKindCfg>,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxRestoreResult, String> {
    let state = state.inner().clone();
    blocking(move || {
        restore_wallet_impl(
            &state,
            Some(app),
            &mnemonic,
            passphrase.as_deref(),
            name,
            kind,
        )
    })
    .await
}

/// Re-run the restore probe over the ALREADY-imported seed — the "scan
/// again" affordance behind a fresh-restore verdict (the Electrum server
/// could have been lagging when the restore probed). If the probe now
/// finds history and the current branch has NONE of it, the wallet
/// switches to the winning branch: the current branch's store is by
/// definition an empty fresh-default store, so it is discarded and
/// recreated on the new branch. A current branch that HAS history is never
/// switched away from — the hit list still reports the other branches.
#[tauri::command]
pub async fn btcx_wallet_reprobe(
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxRestoreResult, String> {
    let state = state.inner().clone();
    blocking(move || {
        let mnemonic = state.with_seed(|s| s.mnemonic().map_err(|e| format!("{e:#}")))?;
        let seed = WalletSeed::from_mnemonic(mnemonic.trim(), "").map_err(|e| format!("{e:#}"))?;
        let chain = state.probe_chain()?;
        let hits = manager::probe_all_branches(&seed, &chain)
            .map_err(|e| format!("Restore probing failed: {e:#}"))?;

        let config = state.get_config();
        let current = config.policy();
        let current_has_history = hits.iter().any(|h| h.policy == current);
        let (mut selected, fresh) = manager::select_restore_policy(&hits);
        if current_has_history {
            // Never abandon a branch that holds history.
            selected = current;
        }

        if selected != current {
            // The current store belongs to a branch WITHOUT history — an
            // empty fresh-default store. Close it and remove its sqlite
            // files so open_wallet can create the new branch's store.
            state.close_runtime();
            let db = config.wallet_db_path();
            for suffix in ["", "-wal", "-shm"] {
                let mut path = db.clone().into_os_string();
                path.push(suffix);
                if let Err(e) = std::fs::remove_file(&path) {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!(
                            "Removing the fresh wallet store {}: {e}",
                            std::path::Path::new(&path).display()
                        ));
                    }
                }
            }
            state.update_config(|c| {
                let network = c.network;
                c.set_policy(network, selected);
            })?;
        }

        open_after_probe(&state, Some(app), &hits, selected)?;
        Ok(BtcxRestoreResult {
            status: state.status()?,
            selected,
            hits,
            fresh,
        })
    })
    .await
}

/// Supply the passphrase of an encrypted seed (verified by trial
/// decryption) and open the wallet.
#[tauri::command]
pub async fn btcx_wallet_unlock(
    passphrase: String,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    let state = state.inner().clone();
    blocking(move || {
        state.with_seed(|s| s.unlock(&passphrase).map_err(|e| format!("{e:#}")))?;
        state.open_runtime(Some(app))?;
        state.status()
    })
    .await
}

/// Lock the wallet: close the runtime (dropping the in-memory keys) and
/// forget the held passphrase. Only meaningful for passphrase-encrypted
/// seeds — an unencrypted seed reopens on the next unlock-free operation.
#[tauri::command]
pub fn btcx_wallet_lock(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    state.close_runtime();
    state.drop_seed_passphrase();
    state.status()
}

// ============================================================================
// Named-Wallet Registry
// ============================================================================

/// One registered wallet of the active network, as the wallet selector
/// lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxWalletSummary {
    pub name: String,
    pub network: String,
    pub policy: DescriptorPolicy,
    /// The selected wallet of the network.
    pub is_active: bool,
    /// Runtime open (only ever true for the active wallet).
    pub is_open: bool,
    /// Whether this wallet's seed is PASSPHRASE-encrypted (lockable). The
    /// transparent at-rest wraps (OS keystore / obfuscation) report false —
    /// they present like unencrypted Core wallets.
    pub seed_encrypted: bool,
    /// Whether this wallet's seed currently needs a passphrase unlock.
    pub seed_locked: bool,
    /// Total balance in sats — only for the OPEN wallet (a cheap cache
    /// read); listing must not open every store.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub balance_sat: Option<u64>,
}

/// List the registered wallets of the active network.
#[tauri::command]
pub fn btcx_wallet_list(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<Vec<BtcxWalletSummary>, String> {
    let config = state.get_config();
    let network = config.network;
    let active_name = config.active_wallet_name();
    let runtime_open = state.is_open();
    // Whether the ACTIVE wallet's store currently holds a working
    // passphrase — the one thing the seed file alone can't tell.
    let active_unlocked = state
        .status()
        .map(|s| s.seed == super::state::SeedState::Unlocked)
        .unwrap_or(false);

    let mut out = Vec::new();
    for name in config.wallet_names(network) {
        let Some(meta) = config.wallet_meta(network, &name) else {
            continue;
        };
        let seed_contents = std::fs::read_to_string(
            BtcxWalletConfig::wallet_root(network, &name).join(seedstore::SEED_FILE),
        )
        .unwrap_or_default();
        // Only the passphrase wrap needs an unlock; keyring/obfuscation
        // auto-read and present like unencrypted Core wallets.
        let needs_passphrase = super::state::seed_needs_passphrase(&seed_contents);
        let is_active = name == active_name;
        let is_open = is_active && runtime_open;
        let balance_sat = if is_open {
            state
                .with_entry(|entry| Ok(entry.wallet.balance().total().to_sat()))
                .ok()
        } else {
            None
        };
        out.push(BtcxWalletSummary {
            name,
            network: network.as_str().to_string(),
            policy: meta.policy,
            is_active,
            is_open,
            seed_encrypted: needs_passphrase,
            // Only the active wallet can hold a passphrase, so every other
            // passphrase wallet lists as locked.
            seed_locked: needs_passphrase && !(is_active && active_unlocked),
            balance_sat,
        });
    }
    Ok(out)
}

/// The full select flow (validate → close old runtime → switch → open),
/// shared by the `btcx_wallet_select` command and the regtest integration
/// tests (which run it without an `AppHandle`).
pub fn select_wallet_impl(
    state: &SharedBtcxWalletState,
    app: Option<AppHandle>,
    name: &str,
) -> Result<BtcxWalletStatus, String> {
    config::validate_wallet_name(name)?;
    let config = state.get_config();
    let network = config.network;
    if config.wallet_meta(network, name).is_none() {
        return Err(format!("No wallet named '{name}' on {}", network.as_str()));
    }
    if config.active_wallet_name() != name {
        state.close_runtime();
        state.drop_seed_passphrase();
        state.update_config(|c| c.set_active_wallet(network, name))?;
    }
    // Ok(false) (locked seed / no server) is a valid selected-but-closed
    // state — the status tells the UI which.
    state.open_runtime(app)?;
    state.status()
}

/// Select (and open, when possible) another registered wallet of the
/// active network. Closes the previous wallet's runtime and drops its held
/// passphrase.
#[tauri::command]
pub async fn btcx_wallet_select(
    name: String,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    let state = state.inner().clone();
    blocking(move || select_wallet_impl(&state, Some(app), &name)).await
}

/// Close the active wallet's runtime WITHOUT switching the selection (the
/// wallet selector's "unload"). Unlike `btcx_wallet_lock` the held
/// passphrase survives, so reopening needs no re-unlock.
#[tauri::command]
pub fn btcx_wallet_close(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    state.close_runtime();
    state.status()
}

/// Delete a registered wallet: moved to `<network>/.trash/<name>-<ts>`,
/// NEVER removed from disk — the seed inside stays recoverable. Refuses
/// the open wallet and demands the name typed back (`confirm_name`).
#[tauri::command]
pub async fn btcx_wallet_delete(
    name: String,
    confirm_name: String,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || {
        config::validate_wallet_name(&name)?;
        if name != confirm_name {
            return Err("Confirmation does not match the wallet name".into());
        }
        let config = state.get_config();
        let network = config.network;
        if config.wallet_meta(network, &name).is_none() {
            return Err(format!("No wallet named '{name}' on {}", network.as_str()));
        }
        if config.active_wallet_name() == name && state.is_open() {
            return Err("Cannot delete the open wallet — close it first".into());
        }
        // The cached seed store holds no OS file handle, but drop it anyway
        // so nothing references the moved directory.
        state.drop_seed_passphrase();

        let root = BtcxWalletConfig::wallet_root(network, &name);
        if root.exists() {
            let trash = BtcxWalletConfig::wallet_dir()
                .join(network.as_str())
                .join(TRASH_SUBDIR);
            std::fs::create_dir_all(&trash)
                .map_err(|e| format!("creating {}: {e}", trash.display()))?;
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let mut dest = trash.join(format!("{name}-{ts}"));
            let mut n = 0;
            while dest.exists() {
                n += 1;
                dest = trash.join(format!("{name}-{ts}-{n}"));
            }
            std::fs::rename(&root, &dest)
                .map_err(|e| format!("moving {} to {}: {e}", root.display(), dest.display()))?;
            log::info!("btcx wallet '{name}' moved to {}", dest.display());
        }
        state.update_config(|c| c.remove_wallet_meta(network, &name))?;
        Ok(())
    })
    .await
}

// ============================================================================
// Wallet Operations
// ============================================================================

/// Fresh receive address (capped handout — see wallet-btcx).
#[tauri::command]
pub async fn btcx_wallet_new_address(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || {
        state
            .backend()?
            .wallet_new_address()
            .map_err(|e| format!("{e:#}"))
    })
    .await
}

/// The CURRENT receive address: the lowest-index revealed-but-unused
/// external address, revealing a fresh one ONLY when none is outstanding
/// (bdk's next-unused semantics). Unlike `btcx_wallet_new_address`,
/// repeated calls hand out the SAME address until it sees funds on-chain
/// or a fresh one is explicitly requested — the receive page rides this on
/// entry so page visits never burn through the handout cap.
#[tauri::command]
pub async fn btcx_wallet_current_address(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || current_address_impl(&state)).await
}

/// `btcx_wallet_current_address` behind a testable seam — the regtest
/// integration suite drives it against a live stack.
pub fn current_address_impl(state: &SharedBtcxWalletState) -> Result<String, String> {
    let network = state.get_config().network;
    let address = state.with_entry(|entry| current_address_of(entry, network))?;
    // The receive page is open: poke the worker so the (possibly fresh)
    // spk is subscribed and an incoming payment is spotted promptly — the
    // same nudge wallet_new_address gives.
    let _ = state.poke();
    Ok(address)
}

/// The peek itself, on a bare wallet entry (unit-testable without the
/// Tauri state): bdk's `next_unused_address` picks the lowest unused
/// index and reveals only when nothing is unused; the persist makes a
/// reveal survive a restart (and is a no-op otherwise).
pub fn current_address_of(
    entry: &mut WalletEntry,
    network: WalletNetwork,
) -> Result<String, String> {
    let info = entry
        .wallet
        .next_unused_address(bdk_wallet::KeychainKind::External);
    entry
        .wallet
        .persist(&mut entry.conn)
        .map_err(|e| format!("persisting wallet: {e}"))?;
    super::psbt::spk_to_address(network, &info.address.script_pubkey())
        .ok_or_else(|| "Unsupported address script".to_string())
}

/// Wallet balance breakdown, in sats (bdk balance categories).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxBalance {
    /// Confirmed and spendable.
    pub confirmed_sat: u64,
    /// Unconfirmed change from our own txs (spendable).
    pub trusted_pending_sat: u64,
    /// Unconfirmed receives from others (not yet spendable).
    pub untrusted_pending_sat: u64,
    /// Immature coinbase outputs.
    pub immature_sat: u64,
    /// confirmed + trusted pending — what a send can use.
    pub spendable_sat: u64,
    /// Everything the wallet knows about.
    pub total_sat: u64,
}

/// Current balance, served from the background-synced bdk cache.
#[tauri::command]
pub fn btcx_wallet_balance(state: State<'_, SharedBtcxWalletState>) -> Result<BtcxBalance, String> {
    state.with_entry(|entry| {
        let balance = entry.wallet.balance();
        Ok(BtcxBalance {
            confirmed_sat: balance.confirmed.to_sat(),
            trusted_pending_sat: balance.trusted_pending.to_sat(),
            untrusted_pending_sat: balance.untrusted_pending.to_sat(),
            immature_sat: balance.immature.to_sat(),
            spendable_sat: balance.trusted_spendable().to_sat(),
            total_sat: balance.total().to_sat(),
        })
    })
}

/// One activity-feed entry as the UI lists it: the crate's [`WalletTxInfo`]
/// (flattened, snake_case) plus a display address derived from the tx
/// outputs — the counterparty on sends, our receiving address on receives.
#[derive(Debug, Clone, Serialize)]
pub struct BtcxWalletTxDto {
    #[serde(flatten)]
    pub info: WalletTxInfo,
    /// Absent when the tx is unknown to the graph or no candidate output
    /// has a bech32 display form (e.g. an OP_RETURN-only counterparty).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
}

/// Derive the display address of one activity entry from its tx outputs:
/// a send shows the first foreign (non-wallet, non-OP_RETURN) output — a
/// self-transfer falls back to our own receive output; a receive shows the
/// first own external-keychain output, falling back to any own output
/// (mirrors what Core's `listtransactions` puts in `address`).
pub fn tx_display_address(
    entry: &WalletEntry,
    network: WalletNetwork,
    info: &WalletTxInfo,
) -> Option<String> {
    use bdk_wallet::KeychainKind;

    let txid: bitcoin::Txid = info.txid.parse().ok()?;
    let tx = entry.wallet.get_tx(txid)?.tx_node.tx.clone();
    let spks = || tx.output.iter().map(|o| &o.script_pubkey);
    let own_external = |spk: &bitcoin::ScriptBuf| {
        matches!(
            entry.wallet.derivation_of_spk(spk.clone()),
            Some((KeychainKind::External, _))
        )
    };
    let spk = if info.direction == "sent" {
        spks()
            .find(|spk| !spk.is_op_return() && !entry.wallet.is_mine((*spk).clone()))
            .or_else(|| spks().find(|spk| own_external(spk)))
    } else {
        spks()
            .find(|spk| own_external(spk))
            .or_else(|| spks().find(|spk| entry.wallet.is_mine((*spk).clone())))
    }?;
    super::psbt::spk_to_address(network, spk)
}

/// Transaction history, newest first (the activity feed), each entry
/// carrying the display address derived from its outputs.
#[tauri::command]
pub fn btcx_wallet_transactions(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<Vec<BtcxWalletTxDto>, String> {
    let network = state.get_config().network;
    let infos = state
        .backend()?
        .wallet_transactions()
        .map_err(|e| format!("{e:#}"))?;
    state.with_entry(|entry| {
        Ok(infos
            .into_iter()
            .map(|info| {
                let address = tx_display_address(entry, network, &info);
                BtcxWalletTxDto { info, address }
            })
            .collect())
    })
}

/// A send request. Exactly one of `amount_sat` / `send_all` must be given.
/// Fee: an explicit `fee_rate_sat_vb` wins over `fee_target` (confirmation
/// target in blocks); with neither, the market estimate at 6 blocks.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxSendRequest {
    pub address: String,
    #[serde(default)]
    pub amount_sat: Option<u64>,
    /// Sweep the whole wallet (fee taken out of the swept amount).
    #[serde(default)]
    pub send_all: bool,
    /// Confirmation target in blocks (market fee estimate).
    #[serde(default)]
    pub fee_target: Option<u16>,
    /// Explicit feerate in sat/vB (decimals carry: 1.08 → 1080 sat/kvB).
    #[serde(default)]
    pub fee_rate_sat_vb: Option<f64>,
}

impl BtcxSendRequest {
    fn fee(&self) -> SendFee {
        match self.fee_rate_sat_vb {
            // sat/vB → sat/kvB, the estimator's native integer resolution.
            Some(rate) => SendFee::RatePerKvb((rate * 1000.0).round().max(0.0) as u64),
            None => SendFee::Target(self.fee_target.unwrap_or(6)),
        }
    }
}

/// Send `amount_sat` (or sweep everything) to `address`, RBF-signaling.
/// Returns the txid.
#[tauri::command]
pub async fn btcx_wallet_send(
    request: BtcxSendRequest,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || {
        let backend = state.backend()?;
        let fee = request.fee();
        match (request.send_all, request.amount_sat) {
            (true, None) => backend
                .wallet_send_all(&request.address, fee)
                .map_err(|e| format!("{e:#}")),
            (false, Some(amount_sat)) => backend
                .wallet_send(&request.address, amount_sat, fee)
                .map_err(|e| format!("{e:#}")),
            (true, Some(_)) => Err("Give either amountSat or sendAll, not both".to_string()),
            (false, None) => Err("Missing amountSat (or set sendAll)".to_string()),
        }
    })
    .await
}

/// RBF-bump a wallet-owned transaction to `fee_rate_sat_vb`; returns the
/// replacement txid.
#[tauri::command]
pub async fn btcx_wallet_bumpfee(
    txid: String,
    fee_rate_sat_vb: f64,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || {
        let feerate_sat_kvb = (fee_rate_sat_vb * 1000.0).round().max(0.0) as u64;
        state
            .backend()?
            .wallet_bumpfee(&txid, feerate_sat_kvb)
            .map_err(|e| format!("{e:#}"))
    })
    .await
}

/// Broadcast a raw transaction (hex) over the configured Electrum servers
/// and return the txid. Chain-only: works with NO seed and NO open wallet —
/// this is the desktop Transaction Builder's nodeless broadcast target.
/// `network` picks which network's server list to use (default: the wallet
/// config's active network).
#[tauri::command]
pub async fn btcx_broadcast_tx(
    tx_hex: String,
    network: Option<WalletNetwork>,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || state.broadcast_tx(&tx_hex, network)).await
}

/// Fee estimates for the send form, decimal sat/vB at the estimator's full
/// sat/kvB resolution. `None` where the estimator has no data (fall back
/// to `min_sat_per_vb`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxFeeEstimates {
    /// Coin feerate floor (the custom field's minimum/default).
    pub min_sat_per_vb: f64,
    /// 1-block target.
    pub fast: Option<f64>,
    /// 6-block target.
    pub normal: Option<f64>,
    /// 144-block target.
    pub slow: Option<f64>,
}

/// Market fee estimates from the wallet's home Electrum server.
#[tauri::command]
pub async fn btcx_wallet_fee_estimates(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxFeeEstimates, String> {
    let state = state.inner().clone();
    blocking(move || {
        let backend = state.backend()?;
        let chain = backend.chain();
        let vb = |kvb: Option<u64>| kvb.map(|rate| rate as f64 / 1000.0);
        Ok(BtcxFeeEstimates {
            min_sat_per_vb: backend.params().min_feerate_sat_vb as f64,
            fast: vb(chain.fee_estimate_kvb(1).map_err(|e| format!("{e:#}"))?),
            normal: vb(chain.fee_estimate_kvb(6).map_err(|e| format!("{e:#}"))?),
            slow: vb(chain.fee_estimate_kvb(144).map_err(|e| format!("{e:#}"))?),
        })
    })
    .await
}

// ============================================================================
// Configuration & Sync
// ============================================================================

/// The full persisted wallet configuration.
#[tauri::command]
pub fn btcx_wallet_get_config(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletConfig, String> {
    Ok(state.get_config())
}

/// Update network and/or the active network's Electrum servers. A change
/// that affects the open runtime (network switch, server edit) closes and
/// reopens it against the new configuration.
#[tauri::command]
pub async fn btcx_wallet_set_config(
    network: Option<WalletNetwork>,
    electrum_servers: Option<Vec<String>>,
    active: Option<bool>,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    let state = state.inner().clone();
    blocking(move || {
        let before = state.get_config();
        let after = state.update_config(|c| {
            if let Some(network) = network {
                c.network = network;
            }
            if let Some(servers) = electrum_servers {
                let servers = servers
                    .into_iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                let network = c.network;
                c.set_servers(network, servers);
            }
            if let Some(active) = active {
                c.active = active;
            }
        })?;
        if before.network != after.network || before.servers() != after.servers() {
            state.close_runtime();
        }
        // Reopen (or first-open) whenever possible; Ok(false) when not.
        state.open_runtime(Some(app))?;
        state.status()
    })
    .await
}

/// Poke the background sync worker for an immediate pass. Completion
/// surfaces through the `btcx-wallet:sync` event / `btcx_wallet_status`.
#[tauri::command]
pub fn btcx_wallet_sync_now(state: State<'_, SharedBtcxWalletState>) -> Result<(), String> {
    state.poke()
}

// ============================================================================
// Forging Assignments (remote node mode)
// ============================================================================

/// Create a forging assignment: delegate `plot_address`'s forging rights to
/// `forging_address`, entirely client-side (BDK build + sign, Electrum
/// broadcast) — the remote-mode replacement for the node's
/// `create_assignment`. The plot address must hold a spendable coin in THIS
/// wallet (ownership proof).
#[tauri::command]
pub async fn btcx_wallet_create_assignment(
    plot_address: String,
    forging_address: String,
    fee_rate_sat_vb: Option<f64>,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<super::assignments::CreateAssignmentDto, String> {
    let state = state.inner().clone();
    blocking(move || {
        super::assignments::create_assignment(
            &state,
            &plot_address,
            &forging_address,
            fee_rate_sat_vb,
        )
    })
    .await
}

/// Revoke `plot_address`'s active forging assignment (client-side) — the
/// remote-mode replacement for the node's `revoke_assignment`.
#[tauri::command]
pub async fn btcx_wallet_revoke_assignment(
    plot_address: String,
    fee_rate_sat_vb: Option<f64>,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<super::assignments::RevokeAssignmentDto, String> {
    let state = state.inner().clone();
    blocking(move || super::assignments::revoke_assignment(&state, &plot_address, fee_rate_sat_vb))
        .await
}

/// Assignment status of `plot_address`, derived from its Electrum script
/// history — the remote-mode replacement for the node's `get_assignment`.
/// Chain-only: needs no seed and no open wallet.
#[tauri::command]
pub async fn btcx_wallet_get_assignment(
    plot_address: String,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<super::assignments::AssignmentStatusDto, String> {
    let state = state.inner().clone();
    blocking(move || super::assignments::get_assignment(&state, &plot_address)).await
}

// ============================================================================
// PSBT Operations (remote node mode)
// ============================================================================

/// Decode a base64 PSBT for display — client-side `decodepsbt`.
#[tauri::command]
pub fn btcx_psbt_decode(
    psbt_base64: String,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<super::psbt::PsbtDecodeDto, String> {
    super::psbt::decode(state.get_config().network, &psbt_base64)
}

/// Analyze a PSBT's signing progress — client-side `analyzepsbt`.
#[tauri::command]
pub fn btcx_psbt_analyze(psbt_base64: String) -> Result<super::psbt::PsbtAnalyzeDto, String> {
    super::psbt::analyze(&psbt_base64)
}

/// Sign a PSBT with the open wallet — client-side `walletprocesspsbt`.
/// Foreign inputs pass through untouched.
#[tauri::command]
pub async fn btcx_psbt_wallet_process(
    psbt_base64: String,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<super::psbt::PsbtProcessDto, String> {
    let state = state.inner().clone();
    blocking(move || super::psbt::wallet_process(&state, &psbt_base64)).await
}

/// Finalize a PSBT's wallet-owned inputs — client-side `finalizepsbt`.
/// When every input ends up final the raw tx hex is included.
#[tauri::command]
pub async fn btcx_psbt_finalize(
    psbt_base64: String,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<super::psbt::PsbtProcessDto, String> {
    let state = state.inner().clone();
    blocking(move || super::psbt::finalize(&state, &psbt_base64)).await
}

/// Combine several PSBTs of the same transaction — client-side
/// `combinepsbt`. Pure; needs no wallet.
#[tauri::command]
pub fn btcx_psbt_combine(psbts: Vec<String>) -> Result<String, String> {
    super::psbt::combine(&psbts)
}

/// Compose a funded, UNSIGNED PSBT from the open wallet — client-side
/// `walletcreatefundedpsbt` (the Transaction Builder's compose tab).
#[tauri::command]
pub async fn btcx_wallet_create_funded_psbt(
    outputs: Vec<super::psbt::PsbtRecipient>,
    fee_rate_sat_vb: Option<f64>,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || super::psbt::create_funded_psbt(&state, &outputs, fee_rate_sat_vb)).await
}

/// The open wallet's unspent outputs (cache read) — the remote-mode
/// `listunspent`.
#[tauri::command]
pub fn btcx_wallet_utxos(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<Vec<super::psbt::WalletUtxoDto>, String> {
    super::psbt::wallet_utxos(&state)
}

// ============================================================================
// Electrum Health & Chain Info (remote node mode)
// ============================================================================

/// Per-server health snapshots of the ACTIVE network's configured Electrum
/// servers, with roles stamped from the open runtime (`wallet` = home,
/// `view` = broadcast fallback, `standby` = configured but unused). Cheap:
/// reads the passive health cells, no network I/O.
#[tauri::command]
pub fn btcx_electrum_health(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<Vec<electrum_btcx::HealthSnapshot>, String> {
    let config = state.get_config();
    let servers = config.servers();
    let urls: Vec<&str> = servers.iter().map(String::as_str).collect();
    let mut snapshots = electrum_btcx::server_health::coin_snapshots(super::config::COIN_ID, &urls);
    let runtime_urls = state.runtime_urls();
    for snapshot in &mut snapshots {
        snapshot.role = Some(match &runtime_urls {
            Some((home, _)) if *home == snapshot.url => "wallet".to_string(),
            Some((_, views)) if views.contains(&snapshot.url) => "view".to_string(),
            _ => "standby".to_string(),
        });
    }
    Ok(snapshots)
}

/// Result of a live Electrum server probe (`btcx_electrum_probe`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElectrumProbeResult {
    /// The server's chain tip height.
    pub height: u64,
    /// Round-trip time of the tip fetch, milliseconds.
    pub latency_ms: f64,
}

/// Probe one Electrum server with a FRESH connection (never the pool): dial,
/// verify it serves the expected chain (genesis check — catches a server of
/// the wrong network), and time a tip fetch. The settings page's "Test
/// connection" button.
#[tauri::command]
pub async fn btcx_electrum_probe(
    url: String,
    network: Option<WalletNetwork>,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<ElectrumProbeResult, String> {
    let state = state.inner().clone();
    blocking(move || {
        let network = network.unwrap_or_else(|| state.get_config().network);
        let params = network.params();
        let backend = electrum_btcx::ElectrumBackend::new(params, url.trim())
            .map_err(|e| format!("{e:#}"))?;
        let started = std::time::Instant::now();
        let (height, _) = backend
            .tip()
            .map_err(|e| format!("Server unreachable: {e:#}"))?;
        backend
            .verify_chain()
            .map_err(|e| format!("Wrong chain or unusable server: {e:#}"))?;
        Ok(ElectrumProbeResult {
            height,
            latency_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    })
    .await
}

/// Chain tip snapshot from the active network's first configured Electrum
/// server (`btcx_chain_info`) — the remote-mode replacement for the desktop
/// header's getblockchaininfo/getblock poll. Chain-only: needs no seed and
/// no open wallet. `base_target` comes from the PoCX 286-byte tip header
/// (version 4 + prev 32 + merkle 32 + time 4 + height 4 + gensig 32 =
/// offset 108, 8 bytes LE); the frontend derives network capacity from it
/// with its existing formula.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxChainInfo {
    pub network: String,
    pub height: u64,
    pub tip_hash: String,
    /// `nTime` of the tip header, unix seconds.
    pub header_time: u32,
    /// PoCX consensus base target of the tip (0 on non-PoCX headers).
    pub base_target: u64,
}

#[tauri::command]
pub async fn btcx_chain_info(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxChainInfo, String> {
    let state = state.inner().clone();
    blocking(move || {
        let config = state.get_config();
        let params = config.network.params();
        let chain = state.probe_chain()?;
        let (height, raw) = chain.tip().map_err(|e| format!("{e:#}"))?;
        let header_time = params.header_time(&raw).map_err(|e| format!("{e:#}"))?;
        let tip_hash = params.header_hash(&raw).map_err(|e| format!("{e:#}"))?;
        // Only the PoCX 286-byte format carries a base target.
        let base_target = if raw.len() == 286 {
            u64::from_le_bytes(raw[108..116].try_into().expect("length checked"))
        } else {
            0
        };
        Ok(BtcxChainInfo {
            network: config.network.as_str().to_string(),
            height,
            tip_hash,
            header_time,
            base_target,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The full named-wallet create flow (resolve → import → open runtime →
    /// status), OFFLINE: the configured Electrum server is unreachable, and
    /// creation must still succeed because the backend dials lazily.
    /// Exercises the exact code `btcx_wallet_create` runs.
    #[test]
    fn create_named_wallet_flow_works_offline() {
        // 24-word all-zero-entropy BIP39 test vector.
        const MNEMONIC_24: &str = "abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon art";

        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("PHOENIX_DATA_DIR", dir.path());
        // Never touch the developer's real OS keychain from a test.
        std::env::set_var("PACT_DISABLE_KEYRING", "1");

        let state = super::super::state::create_btcx_wallet_state();
        state
            .update_config(|c| {
                c.network = WalletNetwork::Regtest;
                // Unreachable on purpose — creation is an offline operation.
                c.set_servers(
                    WalletNetwork::Regtest,
                    vec!["tcp://127.0.0.1:1".to_string()],
                );
            })
            .unwrap();

        let config = state.get_config();

        // The Rust-side name rules reject what the UI must also reject —
        // and mixed case is fine (Core parity: saved as stated).
        let err = resolve_new_wallet_name(&config, config.network, Some("my wallet".to_string()))
            .unwrap_err();
        assert!(err.contains("letters"), "{err}");
        assert!(
            resolve_new_wallet_name(&config, config.network, Some("MyWallet".to_string())).is_ok()
        );

        let name =
            resolve_new_wallet_name(&config, config.network, Some("mywallet".to_string())).unwrap();
        import_into_named_wallet(
            &state,
            config.network,
            &name,
            MNEMONIC_24,
            None,
            DescriptorPolicy::default(),
        )
        .unwrap();
        let opened = state.open_runtime(None).unwrap();
        assert!(
            opened,
            "runtime must open with an unreachable server (lazy dial)"
        );

        let status = state.status().unwrap();
        assert_eq!(status.wallet_name, "mywallet");
        assert!(status.wallet_active);

        // Re-creating the same name is refused with a clear message — and
        // the uniqueness check is case-INSENSITIVE (the wallet directory
        // would collide on Windows/macOS filesystems).
        let config = state.get_config();
        let err = resolve_new_wallet_name(&config, config.network, Some("mywallet".to_string()))
            .unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        let err = resolve_new_wallet_name(&config, config.network, Some("MyWallet".to_string()))
            .unwrap_err();
        assert!(err.contains("already exists"), "{err}");

        state.close_runtime();
        std::env::remove_var("PHOENIX_DATA_DIR");
        std::env::remove_var("PACT_DISABLE_KEYRING");
    }

    fn request(fee_target: Option<u16>, fee_rate_sat_vb: Option<f64>) -> BtcxSendRequest {
        BtcxSendRequest {
            address: "rpocx1qtest".to_string(),
            amount_sat: Some(1),
            send_all: false,
            fee_target,
            fee_rate_sat_vb,
        }
    }

    #[test]
    fn send_fee_mapping() {
        // Explicit rate wins over target and keeps sub-sat/vB resolution.
        assert_eq!(
            request(Some(1), Some(1.08)).fee(),
            SendFee::RatePerKvb(1080)
        );
        // Target passes through.
        assert_eq!(request(Some(3), None).fee(), SendFee::Target(3));
        // Neither: the 6-block preset.
        assert_eq!(request(None, None).fee(), SendFee::Target(6));
        // Negative garbage clamps instead of wrapping.
        assert_eq!(request(None, Some(-5.0)).fee(), SendFee::RatePerKvb(0));
    }

    #[test]
    fn send_request_json_shape() {
        // The exact camelCase wire shape Phase 4's TS will send.
        let req: BtcxSendRequest = serde_json::from_str(
            r#"{"address":"rpocx1qxyz","amountSat":12345,"feeRateSatVb":2.5}"#,
        )
        .unwrap();
        assert_eq!(req.amount_sat, Some(12345));
        assert!(!req.send_all);
        assert_eq!(req.fee(), SendFee::RatePerKvb(2500));

        let sweep: BtcxSendRequest =
            serde_json::from_str(r#"{"address":"rpocx1qxyz","sendAll":true}"#).unwrap();
        assert!(sweep.send_all);
        assert_eq!(sweep.amount_sat, None);
    }
}
