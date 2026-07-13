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
    self, BtcxWalletConfig, DescriptorKindCfg, DescriptorPolicy, WalletMeta, WalletNetwork,
    WalletSourceCfg, TRASH_SUBDIR,
};
use super::descriptors::{self, ImportValidation};
use super::descstore::{self, DescStore, DescriptorPayload};
use super::manager::{self, BranchHit};
use super::migrate::{self, V30MigrationPlan};
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
    if has_leftover_store(network, &name) {
        return Err(format!(
            "A wallet already exists on disk at '{name}' — pick another name",
        ));
    }
    Ok(name)
}

/// Whether a wallet directory holds leftover key material (a seed OR an
/// imported descriptor store) — e.g. a wallet restored from `.trash` by
/// hand. Creating/renaming onto it would mix unrelated wallets.
fn has_leftover_store(network: WalletNetwork, name: &str) -> bool {
    let root = BtcxWalletConfig::wallet_root(network, name);
    root.join(seedstore::SEED_FILE).exists() || root.join(descstore::DESCRIPTOR_FILE).exists()
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
        coin_type: network.asset_coin_type(),
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
    // F3: verify the server serves the right, UNPRUNED chain before probing.
    // A pruned server hides older history, so a real seed would probe as
    // "fresh" — verified_probe_chain fails hard (or falls over) instead.
    let chain = state.verified_probe_chain()?;
    let hits = manager::probe_all_branches(&seed, &chain, network)
        .map_err(|e| format!("Restore probing failed: {e:#}"))?;
    let (selected, fresh) = match kind {
        Some(kind) => manager::select_restore_policy_for_kind(&hits, kind, network),
        None => manager::select_restore_policy(&hits, network),
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
        // F3: same verified-chain guard as the first restore probe — a pruned
        // or wrong-chain server must not drive a "fresh" verdict.
        let chain = state.verified_probe_chain()?;
        let config = state.get_config();
        let network = config.network;
        let hits = manager::probe_all_branches(&seed, &chain, network)
            .map_err(|e| format!("Restore probing failed: {e:#}"))?;

        let current = config.policy();
        let current_has_history = hits.iter().any(|h| h.policy == current);
        let (mut selected, fresh) = manager::select_restore_policy(&hits, network);
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

// ============================================================================
// v30 → v31 Wallet Migration
// ============================================================================

/// What one migration pass did (`btcx_wallet_migrate_v30` /
/// `btcx_wallet_rescan_legacy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum V30MigrationOutcome {
    /// Nothing to create; the wallet is recorded as migrated.
    Noop,
    /// A v31 (BTCX coin type) counterpart was created and made active.
    CreatedV31,
    /// A legacy v30 (coin type 0') counterpart was created; the v31 wallet
    /// stays active.
    CreatedV30,
    /// The pass was skipped because the flag was already set (migrate only).
    Already,
    /// The pass could not run WITHOUT weakening the seed at rest (locked, or
    /// passphrase-encrypted) — the flag is left UNSET so a later pass retries.
    Deferred,
}

/// Result of a migration pass: what it did, the wallet left active, any
/// counterpart created, an optional note, and the post-pass status.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxV30MigrationResult {
    pub outcome: V30MigrationOutcome,
    /// The wallet selected after the pass.
    pub active_wallet: String,
    /// The counterpart wallet created (v31 or v30), if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_wallet: Option<String>,
    /// Human-readable note — e.g. why the pass deferred.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub status: BtcxWalletStatus,
}

/// The base (v31) name of a wallet: its own name with a trailing `-v30`
/// stripped, so `default` and `default-v30` share the base `default`.
fn base_name(name: &str) -> String {
    name.strip_suffix("-v30").unwrap_or(name).to_string()
}

/// The canonical counterpart names of a seed's migration pair: the clean
/// v31 base name and the `-v30` legacy name. Used to look up whether either
/// branch already has a registered wallet (existence check only — creation
/// disambiguates collisions via [`resolve_counterpart_name`]).
fn counterpart_names(base: &str) -> Vec<String> {
    vec![base.to_string(), format!("{base}-v30")]
}

/// A free wallet name for a counterpart being CREATED: `<base><suffix>`,
/// truncated to the 32-char limit and disambiguated with `-2`, `-3`, … if
/// the plain form is taken in the registry or holds a leftover on-disk store.
fn resolve_counterpart_name(
    state: &SharedBtcxWalletState,
    network: WalletNetwork,
    base: &str,
    suffix: &str,
) -> Result<String, String> {
    let config = state.get_config();
    // Keep within the 32-char wallet-name limit, suffix included.
    let max_base = 32usize.saturating_sub(suffix.len());
    let trimmed: String = base.chars().take(max_base).collect();
    let existing: Vec<String> = config
        .wallet_names(network)
        .into_iter()
        .map(|n| n.to_ascii_lowercase())
        .collect();
    let taken = |candidate: &str| {
        existing.contains(&candidate.to_ascii_lowercase())
            || has_leftover_store(network, candidate)
            || config::validate_wallet_name(candidate).is_err()
    };
    let plain = format!("{trimmed}{suffix}");
    if !taken(&plain) {
        return Ok(plain);
    }
    for n in 2..=99 {
        // Re-trim so the numeric tail also fits the 32-char limit.
        let tail = format!("{suffix}-{n}");
        let base_n: String = base
            .chars()
            .take(32usize.saturating_sub(tail.len()))
            .collect();
        let candidate = format!("{base_n}{tail}");
        if !taken(&candidate) {
            return Ok(candidate);
        }
    }
    Err("Could not find a free counterpart wallet name".into())
}

/// Build the migration result and read the post-pass status.
fn migration_result(
    state: &SharedBtcxWalletState,
    outcome: V30MigrationOutcome,
    created_wallet: Option<String>,
    detail: Option<String>,
) -> Result<BtcxV30MigrationResult, String> {
    Ok(BtcxV30MigrationResult {
        outcome,
        active_wallet: state.get_config().active_wallet_name(),
        created_wallet,
        detail,
        status: state.status()?,
    })
}

/// Read the active wallet's stored mnemonic for a migration pass, or return
/// `Ok(None)` to DEFER (leaving the flag unset) when the seed cannot be
/// faithfully reproduced onto a counterpart wallet:
/// - a locked passphrase seed cannot be read at all;
/// - an unlocked passphrase-ENCRYPTED seed reads fine, but the counterpart
///   would have to be re-wrapped WITHOUT the passphrase (an unlocked store
///   never surrenders its plaintext), a security downgrade of the seed at
///   rest — so it is deferred rather than silently weakened.
///
/// The counterpart is therefore always created from the mnemonic with the
/// unattended at-rest wrap (never plaintext, same as an unencrypted create).
fn read_migratable_mnemonic(
    state: &SharedBtcxWalletState,
    config: &BtcxWalletConfig,
) -> (Option<String>, Option<String>) {
    let Ok(mnemonic) = state.with_seed(|s| s.mnemonic().map_err(|e| format!("{e:#}"))) else {
        return (
            None,
            Some("The wallet seed is locked — unlock it, then retry.".into()),
        );
    };
    let seed_file = std::fs::read_to_string(config.active_wallet_root().join(seedstore::SEED_FILE))
        .unwrap_or_default();
    if super::state::seed_needs_passphrase(&seed_file) {
        return (
            None,
            Some(
                "Passphrase-encrypted seeds are not auto-migrated yet — the counterpart wallet \
                 cannot inherit the passphrase protection."
                    .into(),
            ),
        );
    }
    (Some(mnemonic), None)
}

/// Create the seed's legacy v30 counterpart from `mnemonic` on `policy` as a
/// new named wallet, leaving the ORIGINALLY active wallet (`keep_active`)
/// selected afterwards. `set_flags` records both wallets as migrated (the
/// one-time pass) — the danger-zone rescan leaves the flag alone. Returns
/// the created wallet's name.
#[allow(clippy::too_many_arguments)]
fn create_v30_counterpart(
    state: &SharedBtcxWalletState,
    app: Option<AppHandle>,
    network: WalletNetwork,
    keep_active: &str,
    base: &str,
    mnemonic: &str,
    policy: DescriptorPolicy,
    set_flags: bool,
) -> Result<String, String> {
    let legacy_name = resolve_counterpart_name(state, network, base, "-v30")?;
    // import_into_named_wallet closes the runtime and switches the active
    // wallet to the newly created legacy one.
    import_into_named_wallet(state, network, &legacy_name, mnemonic, None, policy)?;
    if set_flags {
        state.update_config(|c| {
            c.set_v30_migrated(network, keep_active, true);
            c.set_v30_migrated(network, &legacy_name, true);
        })?;
    }
    // The v31 wallet must stay active — switch back to it (which reopens it).
    select_wallet_impl(state, app, keep_active)?;
    Ok(legacy_name)
}

/// The one-time v30→v31 migration for the OPEN wallet's seed. Idempotent via
/// the `v30Migrated` flag; a locked/encrypted seed defers WITHOUT setting it.
/// Requires a verified Electrum server (same guard as restore) so a
/// missing/pruned server is a hard error, never a silent "migrated".
pub fn migrate_v30_impl(
    state: &SharedBtcxWalletState,
    app: Option<AppHandle>,
) -> Result<BtcxV30MigrationResult, String> {
    let config = state.get_config();
    let network = config.network;
    let active_name = config.active_wallet_name();

    // Already migrated — nothing to do (leave the open runtime untouched).
    if config.v30_migrated(network, &active_name) {
        return migration_result(state, V30MigrationOutcome::Already, None, None);
    }
    // Descriptor-imported wallets have no seed branches to migrate: record
    // them done so the pass never re-checks.
    if state.active_source(&config) == WalletSourceCfg::Descriptor {
        state.update_config(|c| c.set_v30_migrated(network, &active_name, true))?;
        return migration_result(state, V30MigrationOutcome::Noop, None, None);
    }

    // The v30→v31 split only exists on mainnet (coin 0' → BTCX coin type).
    // Testnet/regtest use coin type 1' for both new and legacy wallets, so
    // there is nothing to migrate — record it done (skipping the Electrum
    // probe) and leave the runtime be.
    if network != WalletNetwork::Mainnet {
        state.update_config(|c| c.set_v30_migrated(network, &active_name, true))?;
        return migration_result(state, V30MigrationOutcome::Noop, None, None);
    }

    let (mnemonic, detail) = read_migratable_mnemonic(state, &config);
    let Some(mnemonic) = mnemonic else {
        return migration_result(state, V30MigrationOutcome::Deferred, None, detail);
    };

    // Probe the seed's branches against a verified server (hard error if none).
    let seed = WalletSeed::from_mnemonic(mnemonic.trim(), "").map_err(|e| format!("{e:#}"))?;
    let chain = state.verified_probe_chain()?;
    let hits = manager::probe_all_branches(&seed, &chain, network)
        .map_err(|e| format!("Migration probing failed: {e:#}"))?;

    let base = base_name(&active_name);
    let names = counterpart_names(&base);
    let existing: Vec<DescriptorPolicy> = names
        .iter()
        .filter_map(|n| config.wallet_meta(network, n).map(|m| m.policy))
        .collect();
    let active_policy = config.policy();

    match migrate::plan_v30_migration(active_policy, &hits, &existing) {
        V30MigrationPlan::Noop => {
            state.update_config(|c| {
                c.set_v30_migrated(network, &active_name, true);
                for n in &names {
                    c.set_v30_migrated(network, n, true);
                }
            })?;
            migration_result(state, V30MigrationOutcome::Noop, None, None)
        }
        V30MigrationPlan::CreateV31 { policy } => {
            // Close the open runtime so the legacy wallet can be renamed off
            // the clean base name, then hand that name to the new v31 wallet.
            state.close_runtime();
            let legacy_name = resolve_counterpart_name(state, network, &base, "-v30")?;
            rename_wallet_impl(state, &active_name, &legacy_name)?;
            let v31_name =
                resolve_new_wallet_name(&state.get_config(), network, Some(base.clone()))?;
            import_into_named_wallet(state, network, &v31_name, &mnemonic, None, policy)?;
            state.update_config(|c| {
                c.set_v30_migrated(network, &v31_name, true);
                c.set_v30_migrated(network, &legacy_name, true);
            })?;
            // import_into_named_wallet already made the v31 wallet active;
            // open its runtime.
            state.open_runtime(app)?;
            migration_result(state, V30MigrationOutcome::CreatedV31, Some(v31_name), None)
        }
        V30MigrationPlan::CreateV30Legacy { policy } => {
            let created = create_v30_counterpart(
                state,
                app,
                network,
                &active_name,
                &base,
                &mnemonic,
                policy,
                true,
            )?;
            migration_result(state, V30MigrationOutcome::CreatedV30, Some(created), None)
        }
    }
}

/// The danger-zone "check for older (v30) funds" pass: re-probe the open
/// wallet's seed and create the legacy v30 counterpart if the coin-0' branch
/// holds history and no v30 wallet exists yet. Unlike the one-time migration
/// it IGNORES the flag (always re-checks) and never touches it, so the user
/// can run it again after later legacy activity.
pub fn rescan_legacy_impl(
    state: &SharedBtcxWalletState,
    app: Option<AppHandle>,
) -> Result<BtcxV30MigrationResult, String> {
    let config = state.get_config();
    let network = config.network;
    let active_name = config.active_wallet_name();

    // No legacy branch to rescan off-mainnet — testnet/regtest are coin
    // type 1' end to end.
    if network != WalletNetwork::Mainnet {
        return migration_result(state, V30MigrationOutcome::Noop, None, None);
    }

    if state.active_source(&config) == WalletSourceCfg::Descriptor {
        return migration_result(
            state,
            V30MigrationOutcome::Noop,
            None,
            Some("Descriptor-imported wallets have no legacy seed branch.".into()),
        );
    }

    let (mnemonic, detail) = read_migratable_mnemonic(state, &config);
    let Some(mnemonic) = mnemonic else {
        return migration_result(state, V30MigrationOutcome::Deferred, None, detail);
    };

    let seed = WalletSeed::from_mnemonic(mnemonic.trim(), "").map_err(|e| format!("{e:#}"))?;
    let chain = state.verified_probe_chain()?;
    let hits = manager::probe_all_branches(&seed, &chain, network)
        .map_err(|e| format!("Legacy probing failed: {e:#}"))?;

    let base = base_name(&active_name);
    let names = counterpart_names(&base);
    // A v30 counterpart already exists over this seed — nothing to recover.
    if config.has_wallet_on_coin_type(network, &names, 0) {
        return migration_result(
            state,
            V30MigrationOutcome::Noop,
            None,
            Some("A legacy (v30) wallet already exists for this seed.".into()),
        );
    }
    // Recover the highest-priority legacy branch that holds history.
    match hits.iter().find(|h| h.policy.coin_type == 0) {
        Some(hit) => {
            let created = create_v30_counterpart(
                state,
                app,
                network,
                &active_name,
                &base,
                &mnemonic,
                hit.policy,
                false,
            )?;
            migration_result(state, V30MigrationOutcome::CreatedV30, Some(created), None)
        }
        None => migration_result(
            state,
            V30MigrationOutcome::Noop,
            None,
            Some("No legacy (v30) funds found for this seed.".into()),
        ),
    }
}

/// Run the one-time v30→v31 auto-migration for the open wallet (the frontend
/// calls this once after opening a wallet). Idempotent: a wallet already
/// migrated returns `already`, a locked/encrypted seed returns `deferred`
/// without recording the pass. See [`migrate_v30_impl`].
#[tauri::command]
pub async fn btcx_wallet_migrate_v30(
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxV30MigrationResult, String> {
    let state = state.inner().clone();
    blocking(move || migrate_v30_impl(&state, Some(app))).await
}

/// Danger-zone rescan for older (v30) funds: re-probe the open wallet's seed
/// and create the legacy counterpart if the coin-0' branch holds history,
/// ignoring the migration flag (always re-checks). See [`rescan_legacy_impl`].
#[tauri::command]
pub async fn btcx_wallet_rescan_legacy(
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxV30MigrationResult, String> {
    let state = state.inner().clone();
    blocking(move || rescan_legacy_impl(&state, Some(app))).await
}

// ============================================================================
// Descriptor Import
// ============================================================================

/// What a descriptor import did: the status after opening, plus how the
/// paste was interpreted (for the success screen).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtcxImportResult {
    pub status: BtcxWalletStatus,
    /// Script class the wallet was registered with (`kind` drives the
    /// badges and the mining/assignment gates; `coin_type` is
    /// informational, parsed from the derivation path when present).
    pub policy: DescriptorPolicy,
    /// The internal (change) descriptor was inferred from the external one.
    pub inferred_internal: bool,
    /// Both branches came from one multipath `<0;1>` descriptor.
    pub from_multipath: bool,
    /// Single-address (`wpkh(WIF)`) wallet: one keychain, change returns
    /// to the same address — the success screen notes it.
    pub single_address: bool,
}

/// The full descriptor-import flow (parse/validate → resolve name → store
/// the pair encrypted-at-rest → register as a descriptor-source wallet →
/// open runtime), shared by the `btcx_wallet_import_descriptor` command and
/// the regtest integration tests (which run it without an `AppHandle`).
///
/// Unlike restore there is no branch probing and no Electrum requirement —
/// the descriptors say exactly which scripts the wallet owns; the fresh
/// store's first sync gap-scans them the same way a restored branch is
/// scanned. Nothing is written if the paste is invalid or the name is
/// taken.
pub fn import_descriptor_wallet_impl(
    state: &SharedBtcxWalletState,
    app: Option<AppHandle>,
    input: &str,
    passphrase: Option<&str>,
    name: Option<String>,
) -> Result<BtcxImportResult, String> {
    let config = state.get_config();
    let network = config.network;
    let name = resolve_new_wallet_name(&config, network, name)?;
    let parsed = descriptors::parse_import(input, network).map_err(|e| e.message)?;

    let root = BtcxWalletConfig::wallet_root(network, &name);
    let mut store = DescStore::open(&root)?;
    store.import(
        &DescriptorPayload::new(parsed.external.clone(), parsed.internal.clone()),
        passphrase,
    )?;

    // Adopt the wallet: close the old runtime, select the new name, record
    // its classification, and re-hold the passphrase so an encrypted store
    // opens without an extra unlock round trip (the create/restore flow).
    state.close_runtime();
    state.drop_seed_passphrase();
    let policy = DescriptorPolicy {
        kind: parsed.kind,
        // Informational: the parsed coin type when the derivation path
        // carries one, else the BTCX default. Gating reads `kind` only.
        coin_type: parsed.coin_type.unwrap_or(keys_btcx::COIN_BTCX),
    };
    state.update_config(|c| {
        c.set_active_wallet(network, &name);
        c.set_wallet_meta(
            network,
            &name,
            WalletMeta {
                policy,
                created_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_secs()),
                source: WalletSourceCfg::Descriptor,
                single_address: parsed.single_address(),
                // Descriptor-imported wallets are never part of the seed
                // v30→v31 migration — mark them done so it never re-checks.
                v30_migrated: true,
            },
        );
        c.active = true;
    })?;
    if let Some(pass) = passphrase.filter(|p| !p.is_empty()) {
        state.with_desc(|d| d.unlock(pass))?;
    }
    // No Electrum server configured yet is fine — the runtime opens later,
    // when one is (Ok(false)); the first sync then gap-scans the history
    // (or, for a single-address wallet, syncs its one revealed script).
    state.open_runtime(app)?;
    Ok(BtcxImportResult {
        status: state.status()?,
        policy,
        inferred_internal: parsed.inferred_internal,
        from_multipath: parsed.from_multipath,
        single_address: parsed.single_address(),
    })
}

/// Import a wallet from one or two PRIVATE descriptors (`wpkh`/`tr`, plus
/// legacy `pkh`/`sh(wpkh)` — gated from mining/assignments). A single
/// standard descriptor infers its `/0/*`↔`/1/*` sibling; a multipath
/// `<0;1>` descriptor carries both branches; a `wpkh(WIF)` descriptor
/// imports as a SINGLE-ADDRESS wallet (one keychain, change returns to the
/// same address — vanity/plot identities). Public-only (xpub) material is
/// rejected — watch-only wallets are not supported yet. The optional
/// passphrase encrypts the stored descriptors at rest (same scheme as the
/// seed store). `name` picks the named wallet (default: the active one);
/// the imported wallet becomes active.
#[tauri::command]
pub async fn btcx_wallet_import_descriptor(
    input: String,
    passphrase: Option<String>,
    name: Option<String>,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxImportResult, String> {
    let state = state.inner().clone();
    blocking(move || {
        import_descriptor_wallet_impl(&state, Some(app), &input, passphrase.as_deref(), name)
    })
    .await
}

/// Pre-submit validation of the import paste box: parses/classifies the
/// input WITHOUT writing anything and returns structured feedback (error
/// code for the translated message, script class, inferred-sibling and
/// multipath flags). Offline and cheap — safe to call on every debounced
/// input change.
#[tauri::command]
pub fn btcx_wallet_validate_import(
    input: String,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<ImportValidation, String> {
    let network = state.get_config().network;
    Ok(ImportValidation::from_result(&descriptors::parse_import(
        &input, network,
    )))
}

/// Supply the passphrase of an encrypted seed — or of an imported
/// wallet's encrypted descriptor store — (verified by trial decryption)
/// and open the wallet.
#[tauri::command]
pub async fn btcx_wallet_unlock(
    passphrase: String,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    let state = state.inner().clone();
    blocking(move || {
        match state.active_source(&state.get_config()) {
            WalletSourceCfg::Seed => {
                state.with_seed(|s| s.unlock(&passphrase).map_err(|e| format!("{e:#}")))?
            }
            WalletSourceCfg::Descriptor => state.with_desc(|d| d.unlock(&passphrase))?,
        }
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
    /// Key-material source: seed (create/restore) or imported descriptors.
    pub source: WalletSourceCfg,
    /// Single-address (`wpkh(WIF)`) wallet — the switcher/settings badge.
    pub single_address: bool,
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
        // Only the passphrase wraps need an unlock; keyring/obfuscation
        // auto-read and present like unencrypted Core wallets. Descriptor-
        // source wallets read their descriptor store instead of the seed.
        let root = BtcxWalletConfig::wallet_root(network, &name);
        let needs_passphrase = match meta.source {
            WalletSourceCfg::Seed => super::state::seed_needs_passphrase(
                &std::fs::read_to_string(root.join(seedstore::SEED_FILE)).unwrap_or_default(),
            ),
            WalletSourceCfg::Descriptor => descstore::is_passphrase_descriptor_file(
                &std::fs::read_to_string(root.join(descstore::DESCRIPTOR_FILE)).unwrap_or_default(),
            ),
        };
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
            source: meta.source,
            single_address: meta.single_address,
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

/// The full rename flow (validate → refuse open → data-dir rename →
/// registry move), shared by the `btcx_wallet_rename` command and the
/// regtest integration tests (which run it without an `AppHandle`).
///
/// The registry only updates AFTER the directory rename succeeded, so a
/// failed move leaves everything consistent under the old name.
pub fn rename_wallet_impl(
    state: &SharedBtcxWalletState,
    name: &str,
    new_name: &str,
) -> Result<(), String> {
    config::validate_wallet_name(name)?;
    config::validate_wallet_name(new_name)?;
    if name == new_name {
        return Err("The new name is the same as the current name".into());
    }
    let config = state.get_config();
    let network = config.network;
    let Some(meta) = config.wallet_meta(network, name) else {
        return Err(format!("No wallet named '{name}' on {}", network.as_str()));
    };
    if config.active_wallet_name() == name && state.is_open() {
        return Err("Cannot rename the open wallet — close it first".into());
    }

    // Case-insensitive uniqueness, same rule as create/restore — EXCEPT a
    // case-only rename of this same wallet (`Johnny` → `johnny`), which is
    // the same path on the case-insensitive filesystems the stores live on.
    let lower_new = new_name.to_ascii_lowercase();
    let case_only = name.to_ascii_lowercase() == lower_new;
    if !case_only {
        if let Some(existing) = config
            .wallet_names(network)
            .into_iter()
            .find(|n| n.to_ascii_lowercase() == lower_new)
        {
            return Err(format!(
                "A wallet named '{existing}' already exists on {}",
                network.as_str()
            ));
        }
        // A leftover on-disk store (e.g. restored from `.trash` by hand) is
        // refused too — renaming onto it would mix unrelated wallets.
        if has_leftover_store(network, new_name) {
            return Err(format!(
                "A wallet already exists on disk at '{new_name}' — pick another name",
            ));
        }
    }

    // The cached seed store may reference the old directory — drop it.
    state.drop_seed_passphrase();

    let old_root = BtcxWalletConfig::wallet_root(network, name);
    let new_root = BtcxWalletConfig::wallet_root(network, new_name);
    if old_root.exists() {
        std::fs::rename(&old_root, &new_root).map_err(|e| {
            format!(
                "moving {} to {}: {e}",
                old_root.display(),
                new_root.display()
            )
        })?;
        log::info!("btcx wallet '{name}' renamed to '{new_name}'");
    }

    // Registry move; the active-wallet pointer follows the wallet it
    // referenced (a non-open wallet can still be the selected one — and the
    // `default` fallback counts: an absent pointer names `default` too).
    let was_selected = config.active_wallet_name() == name;
    state.update_config(|c| {
        c.remove_wallet_meta(network, name);
        c.set_wallet_meta(network, new_name, meta);
        if was_selected {
            c.set_active_wallet(network, new_name);
        }
    })?;
    Ok(())
}

/// Rename a registered wallet: the data dir moves to the new name and the
/// registry entry (plus the active-wallet pointer, if it referenced the
/// old name) follows. Same name rules as create; refuses the OPEN wallet
/// (switch first — the delete flow's pattern).
#[tauri::command]
pub async fn btcx_wallet_rename(
    name: String,
    new_name: String,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || rename_wallet_impl(&state, &name, &new_name)).await
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

/// One page of the activity feed: the requested slice plus the total entry
/// count (the transaction page's paginator length; `limit: 0` is a cheap
/// count-only query).
#[derive(Debug, Clone, Serialize)]
pub struct BtcxWalletTxPage {
    pub items: Vec<BtcxWalletTxDto>,
    /// History size BEFORE the limit/offset slice.
    pub total: usize,
}

/// Seam behind `btcx_wallet_transactions` (unit-testable from the live
/// regtest suite). The crate builds the full sorted history (cheap in-
/// process arithmetic per entry); the slice is applied BEFORE the per-item
/// display-address derivation (tx-graph reads + bech32 encoding), DTO
/// mapping and IPC serialization — the parts that actually hurt on a fat
/// wallet — so absent `limit`/`offset` keep the old full-list behavior.
pub fn wallet_transactions_impl(
    state: &SharedBtcxWalletState,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<BtcxWalletTxPage, String> {
    let network = state.get_config().network;
    let infos = state
        .backend()?
        .wallet_transactions()
        .map_err(|e| format!("{e:#}"))?;
    let total = infos.len();
    state.with_entry(|entry| {
        Ok(BtcxWalletTxPage {
            items: infos
                .into_iter()
                .skip(offset.unwrap_or(0))
                .take(limit.unwrap_or(usize::MAX))
                .map(|info| {
                    let address = tx_display_address(entry, network, &info);
                    BtcxWalletTxDto { info, address }
                })
                .collect(),
            total,
        })
    })
}

/// Transaction history, newest first (the activity feed), each entry
/// carrying the display address derived from its outputs. Optional
/// `limit`/`offset` slice the feed so the dashboard/transaction pages stay
/// O(visible) on fat wallets; both absent = the full history.
#[tauri::command]
pub fn btcx_wallet_transactions(
    limit: Option<usize>,
    offset: Option<usize>,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletTxPage, String> {
    wallet_transactions_impl(&state, limit, offset)
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

/// Refuse assignment operations on a taproot wallet. Plot addresses are
/// 20-byte segwit-v0 witness programs (assignments are defined over P2WPKH
/// per consensus), so a BIP-86 wallet can never own one — fail fast with a
/// clear message instead of letting the UTXO lookup report "no coin on the
/// plot address". The OPEN wallet is by invariant the ACTIVE wallet of the
/// active network, whose descriptor policy the registry records.
pub fn ensure_segwit_wallet(policy: DescriptorPolicy) -> Result<(), String> {
    match policy.kind {
        DescriptorKindCfg::Bip84 => Ok(()),
        DescriptorKindCfg::Bip86 => Err(
            "Forging assignments require a segwit-v0 wallet — the open wallet is taproot".into(),
        ),
        DescriptorKindCfg::Legacy => Err(
            "Forging assignments require a segwit-v0 wallet — the open wallet is legacy \
             (pre-segwit)"
                .into(),
        ),
    }
}

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
        ensure_segwit_wallet(state.get_config().policy())?;
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
    blocking(move || {
        ensure_segwit_wallet(state.get_config().policy())?;
        super::assignments::revoke_assignment(&state, &plot_address, fee_rate_sat_vb)
    })
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

    /// `PHOENIX_DATA_DIR` is process-global: tests that redirect it must
    /// not overlap. (A poisoned lock is fine — one failing test must not
    /// cascade into the other.)
    static DATA_DIR_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// The full named-wallet create flow (resolve → import → open runtime →
    /// status), OFFLINE: the configured Electrum server is unreachable, and
    /// creation must still succeed because the backend dials lazily.
    /// Exercises the exact code `btcx_wallet_create` runs.
    #[test]
    fn create_named_wallet_flow_works_offline() {
        let _guard = DATA_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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

    /// The segwit-only assignment gate: BIP-84 (either coin type — the
    /// legacy coin-0 restore branch is still wpkh) passes, BIP-86 is
    /// refused with the taproot message the UI surfaces verbatim.
    #[test]
    fn assignment_guard_refuses_taproot_wallets() {
        assert!(ensure_segwit_wallet(DescriptorPolicy::default()).is_ok());
        assert!(ensure_segwit_wallet(DescriptorPolicy {
            kind: DescriptorKindCfg::Bip84,
            coin_type: 0,
        })
        .is_ok());

        let err = ensure_segwit_wallet(DescriptorPolicy {
            kind: DescriptorKindCfg::Bip86,
            coin_type: keys_btcx::COIN_BTCX,
        })
        .unwrap_err();
        assert!(err.contains("segwit-v0"), "{err}");
        assert!(err.contains("taproot"), "{err}");

        // Legacy (imported pkh / sh(wpkh)) wallets can't mine either: a
        // plot account_id is a segwit-v0 witness program.
        let err = ensure_segwit_wallet(DescriptorPolicy {
            kind: DescriptorKindCfg::Legacy,
            coin_type: 0,
        })
        .unwrap_err();
        assert!(err.contains("segwit-v0"), "{err}");
        assert!(err.contains("legacy"), "{err}");
    }

    /// The full descriptor-import flow, OFFLINE (unreachable Electrum
    /// server): unlike restore, an import never probes — the descriptors
    /// already say which scripts the wallet owns. Exercises the exact code
    /// `btcx_wallet_import_descriptor` runs: registry entry with
    /// source=descriptor + classified kind, descriptor store on disk (no
    /// seed file), runtime open, and the watch-only/bare-key rejections.
    #[test]
    fn import_descriptor_flow_works_offline() {
        let _guard = DATA_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("PHOENIX_DATA_DIR", dir.path());
        std::env::set_var("PACT_DISABLE_KEYRING", "1");

        let state = super::super::state::create_btcx_wallet_state();
        state
            .update_config(|c| {
                c.network = WalletNetwork::Regtest;
                // Unreachable on purpose — import is an offline operation.
                c.set_servers(
                    WalletNetwork::Regtest,
                    vec!["tcp://127.0.0.1:1".to_string()],
                );
            })
            .unwrap();

        // A deterministic tprv-based external descriptor (regtest keys).
        let secp = bitcoin::secp256k1::Secp256k1::new();
        let master =
            bitcoin::bip32::Xpriv::new_master(bitcoin::NetworkKind::Test, &[9u8; 32]).unwrap();
        let path: Vec<bitcoin::bip32::ChildNumber> = [84u32, 1, 0]
            .iter()
            .map(|&i| bitcoin::bip32::ChildNumber::from_hardened_idx(i).unwrap())
            .collect();
        let account = master.derive_priv(&secp, &path).unwrap();
        let fp = master.fingerprint(&secp);
        let external = format!("wpkh([{fp}/84'/1'/0']{account}/0/*)");

        let result =
            import_descriptor_wallet_impl(&state, None, &external, None, Some("imported".into()))
                .expect("import");
        assert_eq!(result.status.wallet_name, "imported");
        assert!(result.status.wallet_active, "runtime opens (lazy dial)");
        assert_eq!(result.policy.kind, DescriptorKindCfg::Bip84);
        assert!(result.inferred_internal);

        // Registry: descriptor source; disk: descriptor store, NO seed.
        let config = state.get_config();
        let meta = config
            .wallet_meta(WalletNetwork::Regtest, "imported")
            .unwrap();
        assert_eq!(meta.source, WalletSourceCfg::Descriptor);
        let root = BtcxWalletConfig::wallet_root(WalletNetwork::Regtest, "imported");
        assert!(root.join(descstore::DESCRIPTOR_FILE).exists());
        assert!(!root.join(seedstore::SEED_FILE).exists());

        // The open wallet hands out regtest segwit-v0 addresses derived
        // from the imported descriptors.
        let address = state
            .with_entry(|entry| current_address_of(entry, WalletNetwork::Regtest))
            .unwrap();
        assert!(address.starts_with("rpocx1q"), "{address}");

        // Watch-only and bare-key pastes never write anything.
        let tpub = bitcoin::bip32::Xpub::from_priv(&secp, &account);
        let err = import_descriptor_wallet_impl(
            &state,
            None,
            &format!("wpkh({tpub}/0/*)"),
            None,
            Some("watchonly".into()),
        )
        .unwrap_err();
        assert!(err.contains("Watch-only"), "{err}");
        let err = import_descriptor_wallet_impl(
            &state,
            None,
            &master.to_string(),
            None,
            Some("barekey".into()),
        )
        .unwrap_err();
        assert!(err.contains("full descriptor"), "{err}");
        assert!(state
            .get_config()
            .wallet_meta(WalletNetwork::Regtest, "watchonly")
            .is_none());

        // Importing over a taken name is refused before anything parses.
        let err =
            import_descriptor_wallet_impl(&state, None, &external, None, Some("imported".into()))
                .unwrap_err();
        assert!(err.contains("already exists"), "{err}");

        state.close_runtime();
        std::env::remove_var("PHOENIX_DATA_DIR");
        std::env::remove_var("PACT_DISABLE_KEYRING");
    }

    /// The full `wpkh(WIF)` single-address import flow, OFFLINE: registry
    /// entry with singleAddress=true, descriptor store with a null
    /// internal, ONE keychain open with THE address revealed, and the
    /// bare-WIF / non-segwit rejections writing nothing.
    #[test]
    fn import_wif_single_address_flow_works_offline() {
        let _guard = DATA_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("PHOENIX_DATA_DIR", dir.path());
        std::env::set_var("PACT_DISABLE_KEYRING", "1");

        let state = super::super::state::create_btcx_wallet_state();
        state
            .update_config(|c| {
                c.network = WalletNetwork::Regtest;
                // Unreachable on purpose — import is an offline operation.
                c.set_servers(
                    WalletNetwork::Regtest,
                    vec!["tcp://127.0.0.1:1".to_string()],
                );
            })
            .unwrap();

        let secret = bitcoin::secp256k1::SecretKey::from_slice(&[0x33u8; 32]).unwrap();
        let wif = bitcoin::PrivateKey::new(secret, bitcoin::NetworkKind::Test).to_wif();

        let result = import_descriptor_wallet_impl(
            &state,
            None,
            &format!("wpkh({wif})"),
            None,
            Some("vanity".into()),
        )
        .expect("import wpkh(WIF)");
        assert_eq!(result.status.wallet_name, "vanity");
        assert!(result.status.wallet_active, "runtime opens (lazy dial)");
        assert!(result.status.single_address, "status carries the marker");
        assert!(result.single_address);
        assert_eq!(result.policy.kind, DescriptorKindCfg::Bip84);
        assert!(!result.inferred_internal);

        // Registry: descriptor source + single-address marker; the list
        // DTO carries it for the switcher badge.
        let meta = state
            .get_config()
            .wallet_meta(WalletNetwork::Regtest, "vanity")
            .unwrap();
        assert_eq!(meta.source, WalletSourceCfg::Descriptor);
        assert!(meta.single_address);

        // The stored payload has NO internal descriptor (v2 shape).
        let payload = state.with_desc(|d| d.payload()).unwrap();
        assert_eq!(payload.internal, None);
        assert_eq!(payload.version, 2);

        // Current and "new" address are THE address — identity-preserving.
        let current = state
            .with_entry(|entry| current_address_of(entry, WalletNetwork::Regtest))
            .unwrap();
        assert!(current.starts_with("rpocx1q"), "{current}");
        let again = state
            .with_entry(|entry| current_address_of(entry, WalletNetwork::Regtest))
            .unwrap();
        assert_eq!(current, again);

        // Mining/assignments stay ALLOWED — the point of the feature.
        assert!(ensure_segwit_wallet(meta.policy).is_ok());

        // Bare WIF and non-segwit WIF forms never write anything.
        for (input, needle) in [
            (wif.clone(), "wpkh(YOUR_WIF)"),
            (format!("pkh({wif})"), "segwit only"),
            (format!("tr({wif})"), "segwit only"),
        ] {
            let err =
                import_descriptor_wallet_impl(&state, None, &input, None, Some("nope".into()))
                    .unwrap_err();
            assert!(err.contains(needle), "{input}: {err}");
            assert!(state
                .get_config()
                .wallet_meta(WalletNetwork::Regtest, "nope")
                .is_none());
        }

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

    #[test]
    fn base_and_counterpart_naming() {
        // A `-v30` suffix folds back to the clean base; anything else is its
        // own base.
        assert_eq!(base_name("default"), "default");
        assert_eq!(base_name("default-v30"), "default");
        assert_eq!(base_name("savings-v30-2"), "savings-v30-2");
        assert_eq!(
            counterpart_names("default"),
            vec!["default".to_string(), "default-v30".to_string()]
        );
    }

    /// 24-word all-zero-entropy BIP39 test vector (shared by the migration
    /// tests below).
    const MNEMONIC_24: &str = "abandon abandon abandon abandon abandon abandon abandon \
         abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
         abandon abandon abandon abandon abandon abandon art";

    /// Spin up a regtest state rooted at a temp data dir with an unreachable
    /// server — enough to exercise the migration's OFFLINE early-return paths
    /// (before any probe).
    fn offline_state(network: WalletNetwork) -> SharedBtcxWalletState {
        let state = super::super::state::create_btcx_wallet_state();
        state
            .update_config(|c| {
                c.network = network;
                c.set_servers(network, vec!["tcp://127.0.0.1:1".to_string()]);
            })
            .unwrap();
        state
    }

    fn offline_regtest_state() -> SharedBtcxWalletState {
        offline_state(WalletNetwork::Regtest)
    }

    #[test]
    fn resolve_counterpart_name_disambiguates_and_fits_limit() {
        let _guard = DATA_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("PHOENIX_DATA_DIR", dir.path());
        std::env::set_var("PACT_DISABLE_KEYRING", "1");

        let state = offline_regtest_state();
        let net = WalletNetwork::Regtest;

        // Free name: the plain `<base>-v30`.
        assert_eq!(
            resolve_counterpart_name(&state, net, "default", "-v30").unwrap(),
            "default-v30"
        );

        // Register `default-v30`, so the next resolution disambiguates.
        state
            .update_config(|c| {
                c.set_wallet_meta(
                    net,
                    "default-v30",
                    WalletMeta {
                        policy: DescriptorPolicy::default(),
                        created_at: Some(1),
                        source: WalletSourceCfg::Seed,
                        single_address: false,
                        v30_migrated: false,
                    },
                );
            })
            .unwrap();
        assert_eq!(
            resolve_counterpart_name(&state, net, "default", "-v30").unwrap(),
            "default-v30-2"
        );

        // A 32-char base still yields a valid (<=32) counterpart name.
        let long = "x".repeat(32);
        let resolved = resolve_counterpart_name(&state, net, &long, "-v30").unwrap();
        assert!(resolved.len() <= 32, "{resolved}");
        assert!(
            config::validate_wallet_name(&resolved).is_ok(),
            "{resolved}"
        );

        std::env::remove_var("PHOENIX_DATA_DIR");
        std::env::remove_var("PACT_DISABLE_KEYRING");
    }

    #[test]
    fn create_wallet_coin_type_is_network_aware() {
        let _guard = DATA_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("PHOENIX_DATA_DIR", dir.path());
        std::env::set_var("PACT_DISABLE_KEYRING", "1");

        // A new wallet's persisted coin type follows the network: mainnet
        // gets the per-asset BTCX coin type, testnet/regtest the shared
        // SLIP-44 testnet coin type 1'.
        for (network, expected) in [
            (WalletNetwork::Mainnet, keys_btcx::COIN_BTCX),
            (WalletNetwork::Testnet, 1u32),
            (WalletNetwork::Regtest, 1u32),
        ] {
            let state = offline_state(network);
            create_wallet_impl(&state, None, MNEMONIC_24, None, Some("w".into()), None).unwrap();
            assert_eq!(
                state.get_config().policy().coin_type,
                expected,
                "new wallet on {network:?} must derive at coin type {expected:#x}",
            );
        }

        std::env::remove_var("PHOENIX_DATA_DIR");
        std::env::remove_var("PACT_DISABLE_KEYRING");
    }

    #[test]
    fn migrate_v30_skips_descriptor_wallets() {
        let _guard = DATA_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("PHOENIX_DATA_DIR", dir.path());
        std::env::set_var("PACT_DISABLE_KEYRING", "1");

        let state = offline_regtest_state();
        // A deterministic tprv-based external descriptor (regtest keys).
        let secp = bitcoin::secp256k1::Secp256k1::new();
        let master =
            bitcoin::bip32::Xpriv::new_master(bitcoin::NetworkKind::Test, &[7u8; 32]).unwrap();
        let path: Vec<bitcoin::bip32::ChildNumber> = [84u32, 1, 0]
            .iter()
            .map(|&i| bitcoin::bip32::ChildNumber::from_hardened_idx(i).unwrap())
            .collect();
        let account = master.derive_priv(&secp, &path).unwrap();
        let fp = master.fingerprint(&secp);
        let external = format!("wpkh([{fp}/84'/1'/0']{account}/0/*)");
        import_descriptor_wallet_impl(&state, None, &external, None, Some("imported".into()))
            .unwrap();

        // Import already flags descriptor wallets as migrated — the pass is
        // a no-op `already`, needing no (unreachable) Electrum server.
        assert!(state
            .get_config()
            .v30_migrated(WalletNetwork::Regtest, "imported"));
        assert_eq!(
            migrate_v30_impl(&state, None).unwrap().outcome,
            V30MigrationOutcome::Already
        );

        // Clear the flag to exercise the descriptor-skip branch directly (an
        // older config predating the import-time flag): a descriptor wallet
        // has no seed branch, so the pass is a no-op that re-records it —
        // still without touching the server.
        state
            .update_config(|c| c.set_v30_migrated(WalletNetwork::Regtest, "imported", false))
            .unwrap();
        let result = migrate_v30_impl(&state, None).unwrap();
        assert_eq!(result.outcome, V30MigrationOutcome::Noop);
        assert!(state
            .get_config()
            .v30_migrated(WalletNetwork::Regtest, "imported"));

        std::env::remove_var("PHOENIX_DATA_DIR");
        std::env::remove_var("PACT_DISABLE_KEYRING");
    }

    #[test]
    fn migrate_v30_early_returns_already_and_defers_encrypted() {
        let _guard = DATA_DIR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("PHOENIX_DATA_DIR", dir.path());
        std::env::set_var("PACT_DISABLE_KEYRING", "1");

        // Mainnet: this exercises the migration's own already/defer branches,
        // which only run on mainnet (testnet/regtest short-circuit to a
        // no-op before the seed is ever read).
        let state = offline_state(WalletNetwork::Mainnet);

        // (1) A passphrase-encrypted (but unlocked) seed wallet DEFERS —
        // the counterpart can't inherit the passphrase, so the pass must not
        // silently weaken it, and must NOT set the flag.
        create_wallet_impl(
            &state,
            None,
            MNEMONIC_24,
            Some("hunter2"),
            Some("enc".into()),
            None,
        )
        .unwrap();
        let result = migrate_v30_impl(&state, None).unwrap();
        assert_eq!(result.outcome, V30MigrationOutcome::Deferred);
        assert!(result.detail.is_some());
        assert!(
            !state
                .get_config()
                .v30_migrated(WalletNetwork::Mainnet, "enc"),
            "a deferred pass must not record the wallet as migrated"
        );

        // (2) A wallet already flagged returns `already` without touching the
        // (unreachable) server.
        create_wallet_impl(&state, None, MNEMONIC_24, None, Some("plain".into()), None).unwrap();
        state
            .update_config(|c| c.set_v30_migrated(WalletNetwork::Mainnet, "plain", true))
            .unwrap();
        let result = migrate_v30_impl(&state, None).unwrap();
        assert_eq!(result.outcome, V30MigrationOutcome::Already);

        std::env::remove_var("PHOENIX_DATA_DIR");
        std::env::remove_var("PACT_DISABLE_KEYRING");
    }
}
