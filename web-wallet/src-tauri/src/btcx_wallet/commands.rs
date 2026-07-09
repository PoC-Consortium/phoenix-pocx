//! Tauri commands for the nodeless BTCX wallet
//!
//! Exposed to the frontend as `btcx_wallet_*`. Commands that can block on
//! the network or on scrypt (create/restore/unlock, sends, fee estimates)
//! are async and run on the blocking pool; cheap cache reads are sync.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use electrum_btcx::SendFee;
use keys_btcx::WalletSeed;
use wallet_btcx::WalletTxInfo;

use super::config::{BtcxWalletConfig, WalletNetwork};
use super::manager;
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

/// Generate a fresh 12-word BIP39 mnemonic WITHOUT persisting it — for the
/// show-and-confirm onboarding flow; commit it with `btcx_wallet_create`.
#[tauri::command]
pub fn btcx_wallet_generate_mnemonic(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<String, String> {
    state.with_seed(|s| s.generate_mnemonic(12).map_err(|e| format!("{e:#}")))
}

/// Create the wallet from a (freshly generated, user-confirmed) mnemonic.
/// An optional passphrase encrypts the seed at rest (it is NOT a BIP39
/// word-25 — derivation always uses an empty BIP39 passphrase, so the
/// mnemonic alone always recovers the funds). New wallets derive BIP-84 at
/// the BTCX coin type. Refuses to overwrite an existing seed.
#[tauri::command]
pub async fn btcx_wallet_create(
    mnemonic: String,
    passphrase: Option<String>,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    let state = state.inner().clone();
    blocking(move || {
        state.with_seed(|s| {
            s.import_seed(&mnemonic, passphrase.as_deref())
                .map(|_| ())
                .map_err(|e| format!("{e:#}"))
        })?;
        state.update_config(|c| {
            let network = c.network;
            let policy = c.policy();
            c.set_policy(network, policy); // pin the default explicitly
            c.active = true;
        })?;
        // No Electrum server configured yet is fine — the runtime opens
        // later, when one is (Ok(false)).
        state.open_runtime(Some(app))?;
        state.status()
    })
    .await
}

/// Restore the wallet from an existing mnemonic. Probes which descriptor
/// branch the seed's history lives on (BIP-84/86 × BTCX-coin-type/legacy
/// coin-0 — see `manager`) against the configured Electrum server BEFORE
/// importing, and opens the winning branch; no history anywhere opens the
/// fresh default (BIP-84/BTCX). Requires a configured, reachable Electrum
/// server — restoring blind could silently hide legacy funds.
#[tauri::command]
pub async fn btcx_wallet_restore(
    mnemonic: String,
    passphrase: Option<String>,
    app: AppHandle,
    state: State<'_, SharedBtcxWalletState>,
) -> Result<BtcxWalletStatus, String> {
    let state = state.inner().clone();
    blocking(move || {
        // Validate + derive first: nothing is written if the phrase is bad
        // or the probe cannot run.
        let seed = WalletSeed::from_mnemonic(mnemonic.trim(), "").map_err(|e| format!("{e:#}"))?;
        let chain = state.probe_chain()?;
        let policy = manager::probe_restore_policy(&seed, &chain)
            .map_err(|e| format!("Restore probing failed: {e:#}"))?;

        state.with_seed(|s| {
            s.import_seed(&mnemonic, passphrase.as_deref())
                .map(|_| ())
                .map_err(|e| format!("{e:#}"))
        })?;
        state.update_config(|c| {
            let network = c.network;
            c.set_policy(network, policy);
            c.active = true;
        })?;
        state.open_runtime(Some(app))?;
        state.status()
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

/// Transaction history, newest first (the activity feed).
#[tauri::command]
pub fn btcx_wallet_transactions(
    state: State<'_, SharedBtcxWalletState>,
) -> Result<Vec<WalletTxInfo>, String> {
    state
        .backend()?
        .wallet_transactions()
        .map_err(|e| format!("{e:#}"))
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

#[cfg(test)]
mod tests {
    use super::*;

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
