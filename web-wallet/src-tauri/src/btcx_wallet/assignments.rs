//! Client-side PoCX forging assignments over Electrum
//!
//! Remote (nodeless) mode has no `create_assignment`/`revoke_assignment`/
//! `get_assignment` node RPCs, so this module reproduces them against the
//! BDK wallet + Electrum:
//!
//! - **Build**: an assignment is a standard transaction whose `output[0]`
//!   is a single-push OP_RETURN — `"POCX" <plot_addr_20> <forge_addr_20>`
//!   (44 bytes) to assign, `"XCOP" <plot_addr_20>` (24 bytes) to revoke —
//!   with ownership proven by SPENDING a P2WPKH UTXO whose witness program
//!   equals the plot address hash (the node wallet picks the largest such
//!   UTXO; so does this). See bitcoin-pocx `docs/4-forging-assignments.md`
//!   and `src/pocx/assignments/opcodes.cpp`.
//! - **Status**: assignment txs spend from the plot address, so they appear
//!   in that address's Electrum script history. Fetching the history,
//!   filtering to marker transactions that prove ownership, and replaying
//!   them oldest-to-newest against the consensus activation delays yields
//!   the same state machine the node serves
//!   (`UNASSIGNED → ASSIGNING → ASSIGNED → REVOKING → REVOKED`).
//!
//! Wire DTOs are snake_case to match the node RPCs exactly — the Angular
//! forging page consumes either backend through one interface.

use bdk_wallet::{SignOptions, TxOrdering};
use bitcoin::hashes::Hash;
use bitcoin::script::PushBytesBuf;
use bitcoin::{ScriptBuf, Sequence, Transaction};
use serde::Serialize;

use electrum_btcx::{ElectrumBackend, SendFee};
use wallet_btcx::BdkWalletBackend;

use super::config::WalletNetwork;
use super::state::SharedBtcxWalletState;

/// Assignment OP_RETURN marker ("Proof of Capacity neXt").
pub const ASSIGN_MARKER: &[u8; 4] = b"POCX";
/// Revocation OP_RETURN marker ("eXit Capacity OPeration").
pub const REVOKE_MARKER: &[u8; 4] = b"XCOP";

/// Consensus activation delays `(assignment, revocation)` in blocks —
/// bitcoin-pocx `src/kernel/chainparams.cpp` (nForgingAssignmentDelay /
/// nForgingRevocationDelay per network).
pub fn forging_delays(network: WalletNetwork) -> (u32, u32) {
    match network {
        WalletNetwork::Mainnet | WalletNetwork::Testnet => (30, 720),
        WalletNetwork::Regtest => (4, 8),
    }
}

/// Render a 20-byte witness program as this network's bech32 P2WPKH
/// address (`pocx`/`tpocx`/`rpocx` HRP — the `bitcoin` crate's `Address`
/// only knows bc/tb/bcrt).
fn p2wpkh_address(network: WalletNetwork, program: &[u8; 20]) -> Result<String, String> {
    let hrp = bech32::Hrp::parse(network.params().bech32_hrp)
        .map_err(|e| format!("chain HRP: {e}"))?;
    bech32::segwit::encode_v0(hrp, program).map_err(|e| format!("address encoding: {e}"))
}

/// The 20-byte witness program of a P2WPKH address on `network` — errors on
/// anything else (assignments are defined over P2WPKH per consensus).
fn p2wpkh_program(
    network: WalletNetwork,
    address: &str,
    what: &str,
) -> Result<[u8; 20], String> {
    let spk = network
        .params()
        .parse_address(address.trim())
        .map_err(|e| format!("{what}: {e:#}"))?;
    if !spk.is_p2wpkh() {
        return Err(format!(
            "{what} must be a bech32 P2WPKH (segwit v0) address"
        ));
    }
    // P2WPKH scriptPubKey: OP_0 <20-byte push> — bytes 2..22.
    spk.as_bytes()[2..22]
        .try_into()
        .map_err(|_| format!("{what}: unexpected script length"))
}

/// Assignment result — snake_case, mirrors the node's `create_assignment`.
#[derive(Debug, Clone, Serialize)]
pub struct CreateAssignmentDto {
    pub txid: String,
    pub hex: String,
    pub plot_address: String,
    pub forging_address: String,
}

/// Revocation result — snake_case, mirrors the node's `revoke_assignment`.
#[derive(Debug, Clone, Serialize)]
pub struct RevokeAssignmentDto {
    pub txid: String,
    pub hex: String,
    pub plot_address: String,
}

/// Assignment status — snake_case, mirrors the node's `get_assignment`.
#[derive(Debug, Clone, Serialize)]
pub struct AssignmentStatusDto {
    pub plot_address: String,
    /// Chain tip height the state was evaluated at.
    pub height: u64,
    pub has_assignment: bool,
    /// UNASSIGNED | ASSIGNING | ASSIGNED | REVOKING | REVOKED
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forging_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_txid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activation_height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revocation_txid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revocation_height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revocation_effective_height: Option<u64>,
}

/// Build, sign and broadcast one marker transaction (assignment or
/// revocation): forces the largest plot-address UTXO in as the ownership
/// proof, puts the single-push OP_RETURN at `output[0]`
/// (`TxOrdering::Untouched` — bdk's default shuffle would displace it),
/// lets bdk add fee inputs/change, signs RBF (parity with the node wallet,
/// which broadcasts assignments replaceable).
fn build_and_send_marker(
    state: &SharedBtcxWalletState,
    backend: &BdkWalletBackend,
    plot_spk: &ScriptBuf,
    payload: Vec<u8>,
    fee_rate_sat_vb: Option<f64>,
) -> Result<(String, String), String> {
    state.ensure_first_sync()?;

    let fee = match fee_rate_sat_vb {
        Some(rate) => SendFee::RatePerKvb((rate * 1000.0).round().max(0.0) as u64),
        None => SendFee::Target(6),
    };
    // sat/kvB → sat/kwu, the same rounding wallet-btcx uses.
    let feerate_kvb = backend
        .chain()
        .resolve_send_fee(fee)
        .map_err(|e| format!("{e:#}"))?;
    let feerate = bitcoin::FeeRate::from_sat_per_kwu((feerate_kvb + 2) / 4);

    let push = PushBytesBuf::try_from(payload)
        .map_err(|_| "marker payload exceeds push limits".to_string())?;

    let tx = state.with_entry(|entry| {
        // Ownership proof: the LARGEST spendable UTXO on the plot address
        // (mirrors the node wallet's coin selection for assignments).
        let plot_utxo = entry
            .wallet
            .list_unspent()
            .filter(|u| u.txout.script_pubkey == *plot_spk)
            .max_by_key(|u| u.txout.value)
            .ok_or_else(|| {
                "The plot address has no spendable coins in this wallet — send a small \
                 amount to it first (the assignment must be signed by a coin on the plot \
                 address itself)"
                    .to_string()
            })?;

        let mut builder = entry.wallet.build_tx();
        builder
            .ordering(TxOrdering::Untouched)
            .add_data(&push)
            .fee_rate(feerate)
            .set_exact_sequence(Sequence::ENABLE_RBF_NO_LOCKTIME);
        builder
            .add_utxo(plot_utxo.outpoint)
            .map_err(|e| format!("selecting the plot UTXO: {e}"))?;
        let mut psbt = builder
            .finish()
            .map_err(|e| format!("building the transaction: {e}"))?;

        let done = entry
            .wallet
            .sign(&mut psbt, SignOptions::default())
            .map_err(|e| format!("signing: {e}"))?;
        if !done {
            return Err("wallet could not finalize the transaction".to_string());
        }
        let tx = psbt
            .extract_tx()
            .map_err(|e| format!("extracting the transaction: {e}"))?;

        // Consensus sanity before anything leaves this process: exactly one
        // marker OP_RETURN, at output[0], and the ownership input present.
        let markers = tx
            .output
            .iter()
            .filter(|o| parse_marker_output(&o.script_pubkey).is_some())
            .count();
        if markers != 1 || parse_marker_output(&tx.output[0].script_pubkey).is_none() {
            return Err("internal error: malformed marker transaction".to_string());
        }
        Ok(tx)
    })?;

    // Broadcast home-first with view fallback (any acceptance wins), then
    // fold our own tx into the cache and persist — broadcast-before-persist,
    // like wallet-btcx sends: a crash re-learns the tx from our own spk
    // history on the next sync.
    let txid = fan_broadcast(backend, &tx)?;
    state.with_entry(|entry| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entry.wallet.apply_unconfirmed_txs([(tx.clone(), now)]);
        entry
            .wallet
            .persist(&mut entry.conn)
            .map_err(|e| format!("persisting wallet: {e}"))?;
        Ok(())
    })?;
    let _ = state.poke();

    let hex = bitcoin::consensus::encode::serialize_hex(&tx);
    Ok((txid, hex))
}

/// Broadcast through the home server, falling over to the healthy views —
/// any acceptance wins (the wallet-btcx `broadcast_fan` pattern; that
/// method is private, so it is reproduced over the backend's public
/// chain/views accessors).
fn fan_broadcast(backend: &BdkWalletBackend, tx: &Transaction) -> Result<String, String> {
    let mut last_err: Option<String> = None;
    let mut tried = false;
    for server in std::iter::once(backend.chain()).chain(backend.views().iter()) {
        if !server.health().available() {
            continue;
        }
        tried = true;
        match server.broadcast(tx) {
            Ok(txid) => return Ok(txid.to_string()),
            Err(e) => last_err = Some(format!("{e:#}")),
        }
    }
    if !tried {
        // Everything is inside a backoff window: dial the home anyway
        // rather than stranding a signed transaction.
        return backend
            .chain()
            .broadcast(tx)
            .map(|txid| txid.to_string())
            .map_err(|e| format!("{e:#}"));
    }
    Err(format!(
        "Transaction rejected — {}",
        last_err.expect("tried at least one server")
    ))
}

/// Create a forging assignment: delegate `plot_address`'s forging rights to
/// `forging_address`.
pub fn create_assignment(
    state: &SharedBtcxWalletState,
    plot_address: &str,
    forging_address: &str,
    fee_rate_sat_vb: Option<f64>,
) -> Result<CreateAssignmentDto, String> {
    let network = state.get_config().network;
    let plot20 = p2wpkh_program(network, plot_address, "plot address")?;
    let forge20 = p2wpkh_program(network, forging_address, "forging address")?;
    let plot_spk = ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array(plot20));

    let mut payload = Vec::with_capacity(44);
    payload.extend_from_slice(ASSIGN_MARKER);
    payload.extend_from_slice(&plot20);
    payload.extend_from_slice(&forge20);

    let backend = state.backend()?;
    let (txid, hex) = build_and_send_marker(state, &backend, &plot_spk, payload, fee_rate_sat_vb)?;
    Ok(CreateAssignmentDto {
        txid,
        hex,
        plot_address: plot_address.trim().to_string(),
        forging_address: forging_address.trim().to_string(),
    })
}

/// Revoke `plot_address`'s active forging assignment.
pub fn revoke_assignment(
    state: &SharedBtcxWalletState,
    plot_address: &str,
    fee_rate_sat_vb: Option<f64>,
) -> Result<RevokeAssignmentDto, String> {
    let network = state.get_config().network;
    let plot20 = p2wpkh_program(network, plot_address, "plot address")?;
    let plot_spk = ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array(plot20));

    let mut payload = Vec::with_capacity(24);
    payload.extend_from_slice(REVOKE_MARKER);
    payload.extend_from_slice(&plot20);

    let backend = state.backend()?;
    let (txid, hex) = build_and_send_marker(state, &backend, &plot_spk, payload, fee_rate_sat_vb)?;
    Ok(RevokeAssignmentDto {
        txid,
        hex,
        plot_address: plot_address.trim().to_string(),
    })
}

/// One marker found in a transaction output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Marker {
    Assign { plot: [u8; 20], forge: [u8; 20] },
    Revoke { plot: [u8; 20] },
}

/// Parse an output script as a PoCX marker OP_RETURN: a single push of
/// `POCX <20> <20>` (44 bytes) or `XCOP <20>` (24 bytes). Pure — unit
/// tested against the documented format.
pub fn parse_marker_output(spk: &ScriptBuf) -> Option<Marker> {
    let bytes = spk.as_bytes();
    // OP_RETURN <push_len> <data>: 0x6a 0x2c … or 0x6a 0x18 …
    if bytes.first() != Some(&0x6a) {
        return None;
    }
    let data = match bytes.get(1) {
        Some(&0x2c) if bytes.len() == 46 => &bytes[2..46],
        Some(&0x18) if bytes.len() == 26 => &bytes[2..26],
        _ => return None,
    };
    if data[..4] == *ASSIGN_MARKER && data.len() == 44 {
        Some(Marker::Assign {
            plot: data[4..24].try_into().ok()?,
            forge: data[24..44].try_into().ok()?,
        })
    } else if data[..4] == *REVOKE_MARKER && data.len() == 24 {
        Some(Marker::Revoke {
            plot: data[4..24].try_into().ok()?,
        })
    } else {
        None
    }
}

/// One ownership-proven marker event on a plot address's history.
#[derive(Debug, Clone)]
struct MarkerEvent {
    txid: String,
    /// Confirmation height; `None` = still in the mempool.
    height: Option<u64>,
    marker: Marker,
}

/// Derive the assignment state of `plot_address` from its Electrum script
/// history — the remote-mode replacement for the node's `get_assignment`.
/// Chain-only: needs no seed and no open wallet.
pub fn get_assignment(
    state: &SharedBtcxWalletState,
    plot_address: &str,
) -> Result<AssignmentStatusDto, String> {
    let network = state.get_config().network;
    let plot20 = p2wpkh_program(network, plot_address, "plot address")?;
    let plot_spk = ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array(plot20));

    let chain = state.probe_chain()?;
    let tip = chain.tip_height().map_err(|e| format!("{e:#}"))?;
    let events = collect_marker_events(&chain, &plot_spk, plot20)?;
    let (assign_delay, revoke_delay) = forging_delays(network);
    Ok(derive_status(
        plot_address.trim(),
        network,
        tip,
        &events,
        assign_delay as u64,
        revoke_delay as u64,
    ))
}

/// Fetch the plot address's history and keep only marker transactions that
/// (a) name this plot in their OP_RETURN and (b) prove ownership by
/// spending from the plot address — which membership in this script's
/// history already implies for inputs, but is re-checked against the
/// prevouts the node checks (any input whose spent output pays the plot
/// script). Ordered oldest-first, mempool entries last.
fn collect_marker_events(
    chain: &ElectrumBackend,
    plot_spk: &ScriptBuf,
    plot20: [u8; 20],
) -> Result<Vec<MarkerEvent>, String> {
    let mut history = chain.history(plot_spk).map_err(|e| format!("{e:#}"))?;
    if history.is_empty() {
        return Ok(Vec::new());
    }
    // Electrum history heights: >0 confirmed, 0 / -1 mempool.
    history.sort_by_key(|(_, h)| if *h > 0 { *h } else { i64::MAX });
    let txids: Vec<String> = history.iter().map(|(txid, _)| txid.clone()).collect();
    let txs = chain.get_raw_txs(&txids).map_err(|e| format!("{e:#}"))?;

    let mut events = Vec::new();
    for ((txid, height), tx) in history.iter().zip(txs.iter()) {
        let marker = tx
            .output
            .iter()
            .find_map(|o| parse_marker_output(&o.script_pubkey));
        let Some(marker) = marker else { continue };
        let marker_plot = match marker {
            Marker::Assign { plot, .. } | Marker::Revoke { plot } => plot,
        };
        if marker_plot != plot20 {
            // A marker for a DIFFERENT plot funded from this address —
            // not this plot's event.
            continue;
        }
        // Ownership: at least one input spends an output paying the plot
        // script. This tx is in the plot script's history, which Electrum
        // grants for both funding and spending — verify the spending side.
        let spends_plot = tx.input.iter().any(|input| {
            chain
                .get_raw_tx(&input.previous_output.txid.to_string())
                .ok()
                .and_then(|prev| {
                    prev.output
                        .get(input.previous_output.vout as usize)
                        .map(|o| o.script_pubkey == *plot_spk)
                })
                .unwrap_or(false)
        });
        if !spends_plot {
            continue;
        }
        events.push(MarkerEvent {
            txid: txid.clone(),
            height: if *height > 0 {
                Some(*height as u64)
            } else {
                None
            },
            marker,
        });
    }
    Ok(events)
}

/// Replay ownership-proven marker events (oldest first) against the
/// activation delays — pure, unit-tested. Consensus accepts an assignment
/// only from UNASSIGNED/REVOKED and a revocation only from ASSIGNED, so a
/// linear replay tracking the latest assignment reproduces the node's
/// state machine; events that consensus would have rejected are skipped
/// the same way the node's mempool/block validation rejects them.
fn derive_status(
    plot_address: &str,
    network: WalletNetwork,
    tip: u64,
    events: &[MarkerEvent],
    assign_delay: u64,
    revoke_delay: u64,
) -> AssignmentStatusDto {
    let mut current: Option<(MarkerEvent, [u8; 20], Option<MarkerEvent>)> = None; // (assign, forge, revoke)

    let state_of = |assign: &MarkerEvent, revoke: &Option<MarkerEvent>| -> &'static str {
        let assigned_active = assign
            .height
            .map(|h| tip >= h + assign_delay)
            .unwrap_or(false);
        match revoke {
            None => {
                if assigned_active {
                    "ASSIGNED"
                } else {
                    "ASSIGNING"
                }
            }
            Some(revoke) => {
                let revoke_active = revoke
                    .height
                    .map(|h| tip >= h + revoke_delay)
                    .unwrap_or(false);
                if revoke_active {
                    "REVOKED"
                } else {
                    "REVOKING"
                }
            }
        }
    };

    for event in events {
        match event.marker {
            Marker::Assign { forge, .. } => {
                let acceptable = match &current {
                    None => true,
                    // A new assignment is valid only once the previous one
                    // is fully REVOKED.
                    Some((assign, _, revoke)) => state_of(assign, revoke) == "REVOKED",
                };
                if acceptable {
                    current = Some((event.clone(), forge, None));
                }
            }
            Marker::Revoke { .. } => {
                if let Some((assign, _, revoke @ None)) = &mut current {
                    // Consensus requires ASSIGNED to revoke; the delays make
                    // ASSIGNING-then-immediate-revoke invalid, mirror that.
                    let assigned_active = assign
                        .height
                        .map(|h| event.height.map(|eh| eh >= h + assign_delay).unwrap_or(tip >= h + assign_delay))
                        .unwrap_or(false);
                    if assigned_active {
                        *revoke = Some(event.clone());
                    }
                }
            }
        }
    }

    match current {
        None => AssignmentStatusDto {
            plot_address: plot_address.to_string(),
            height: tip,
            has_assignment: false,
            state: "UNASSIGNED",
            forging_address: None,
            assignment_txid: None,
            assignment_height: None,
            activation_height: None,
            revoked: None,
            revocation_txid: None,
            revocation_height: None,
            revocation_effective_height: None,
        },
        Some((assign, forge20, revoke)) => {
            let state = state_of(&assign, &revoke);
            let forging_address = p2wpkh_address(network, &forge20).ok();
            AssignmentStatusDto {
                plot_address: plot_address.to_string(),
                height: tip,
                // The node reports has_assignment=false again once REVOKED.
                has_assignment: state != "REVOKED",
                state,
                forging_address,
                assignment_txid: Some(assign.txid.clone()),
                assignment_height: assign.height,
                activation_height: assign.height.map(|h| h + assign_delay),
                revoked: Some(revoke.is_some()),
                revocation_txid: revoke.as_ref().map(|r| r.txid.clone()),
                revocation_height: revoke.as_ref().and_then(|r| r.height),
                revocation_effective_height: revoke
                    .as_ref()
                    .and_then(|r| r.height)
                    .map(|h| h + revoke_delay),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spk_assign(plot: [u8; 20], forge: [u8; 20]) -> ScriptBuf {
        let mut payload = Vec::new();
        payload.extend_from_slice(ASSIGN_MARKER);
        payload.extend_from_slice(&plot);
        payload.extend_from_slice(&forge);
        let push = PushBytesBuf::try_from(payload).unwrap();
        ScriptBuf::new_op_return(&push)
    }

    fn spk_revoke(plot: [u8; 20]) -> ScriptBuf {
        let mut payload = Vec::new();
        payload.extend_from_slice(REVOKE_MARKER);
        payload.extend_from_slice(&plot);
        let push = PushBytesBuf::try_from(payload).unwrap();
        ScriptBuf::new_op_return(&push)
    }

    #[test]
    fn marker_parse_round_trip() {
        let plot = [1u8; 20];
        let forge = [2u8; 20];
        assert_eq!(
            parse_marker_output(&spk_assign(plot, forge)),
            Some(Marker::Assign { plot, forge })
        );
        assert_eq!(
            parse_marker_output(&spk_revoke(plot)),
            Some(Marker::Revoke { plot })
        );
        // The documented sizes: 46 bytes total for POCX, 26 for XCOP.
        assert_eq!(spk_assign(plot, forge).as_bytes().len(), 46);
        assert_eq!(spk_revoke(plot).as_bytes().len(), 26);
        // Non-markers parse to None.
        assert_eq!(parse_marker_output(&ScriptBuf::new()), None);
        assert_eq!(
            parse_marker_output(&ScriptBuf::new_p2wpkh(
                &bitcoin::WPubkeyHash::from_byte_array(plot)
            )),
            None
        );
        // Right size, wrong magic.
        let mut payload = vec![0u8; 44];
        payload[..4].copy_from_slice(b"NOPE");
        let bad = ScriptBuf::new_op_return(&PushBytesBuf::try_from(payload).unwrap());
        assert_eq!(parse_marker_output(&bad), None);
    }

    fn event(txid: &str, height: Option<u64>, marker: Marker) -> MarkerEvent {
        MarkerEvent {
            txid: txid.to_string(),
            height,
            marker,
        }
    }

    const PLOT: [u8; 20] = [7u8; 20];
    const FORGE: [u8; 20] = [9u8; 20];

    fn assign(txid: &str, height: Option<u64>) -> MarkerEvent {
        event(
            txid,
            height,
            Marker::Assign {
                plot: PLOT,
                forge: FORGE,
            },
        )
    }

    fn revoke(txid: &str, height: Option<u64>) -> MarkerEvent {
        event(txid, height, Marker::Revoke { plot: PLOT })
    }

    fn status(tip: u64, events: &[MarkerEvent]) -> AssignmentStatusDto {
        // Regtest delays: assign 4, revoke 8.
        derive_status("rpocx1qplot", WalletNetwork::Regtest, tip, events, 4, 8)
    }

    #[test]
    fn no_events_is_unassigned() {
        let s = status(100, &[]);
        assert_eq!(s.state, "UNASSIGNED");
        assert!(!s.has_assignment);
        assert_eq!(s.height, 100);
    }

    #[test]
    fn assignment_walks_assigning_to_assigned() {
        let events = [assign("a", Some(100))];
        // Below activation (100 + 4).
        let s = status(103, &events);
        assert_eq!(s.state, "ASSIGNING");
        assert!(s.has_assignment);
        assert_eq!(s.activation_height, Some(104));
        // At activation.
        let s = status(104, &events);
        assert_eq!(s.state, "ASSIGNED");
        assert!(s.forging_address.is_some());
    }

    #[test]
    fn unconfirmed_assignment_is_assigning() {
        let s = status(100, &[assign("a", None)]);
        assert_eq!(s.state, "ASSIGNING");
        assert_eq!(s.activation_height, None);
        assert_eq!(s.assignment_height, None);
    }

    #[test]
    fn revocation_walks_revoking_to_revoked() {
        let events = [assign("a", Some(100)), revoke("r", Some(110))];
        // Revocation at 110, active at 118.
        let s = status(115, &events);
        assert_eq!(s.state, "REVOKING");
        assert_eq!(s.revoked, Some(true));
        assert_eq!(s.revocation_effective_height, Some(118));
        let s = status(118, &events);
        assert_eq!(s.state, "REVOKED");
        assert!(!s.has_assignment, "REVOKED reads as no active assignment");
    }

    #[test]
    fn premature_revocation_is_skipped_like_consensus_rejects_it() {
        // Revoke at 102 — the assignment (100) activates only at 104, so
        // consensus rejects this revocation; the replay must skip it.
        let events = [assign("a", Some(100)), revoke("r", Some(102))];
        let s = status(120, &events);
        assert_eq!(s.state, "ASSIGNED");
        assert_eq!(s.revoked, Some(false));
    }

    #[test]
    fn reassignment_after_full_revocation_wins() {
        let events = [
            assign("a1", Some(100)),
            revoke("r1", Some(110)), // active at 118
            assign("a2", Some(120)), // valid: prior fully revoked
        ];
        let s = status(130, &events);
        assert_eq!(s.state, "ASSIGNED");
        assert_eq!(s.assignment_txid.as_deref(), Some("a2"));
        assert_eq!(s.revoked, Some(false));
    }

    #[test]
    fn second_assignment_while_active_is_skipped() {
        // Consensus rejects an assignment while one is ASSIGNING/ASSIGNED.
        let events = [assign("a1", Some(100)), assign("a2", Some(101))];
        let s = status(130, &events);
        assert_eq!(s.assignment_txid.as_deref(), Some("a1"));
    }
}
