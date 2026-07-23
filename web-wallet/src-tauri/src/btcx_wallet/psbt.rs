//! Client-side PSBT operations for the Transaction Builder
//!
//! Remote (nodeless) mode has no `decodepsbt`/`analyzepsbt`/
//! `walletprocesspsbt`/`finalizepsbt`/`combinepsbt`/`walletcreatefundedpsbt`
//! node RPCs; this module reproduces the Transaction Builder's real flows
//! (compose → sign → finalize → broadcast, import → sign, combine
//! half-signed copies) over `bitcoin::Psbt` + the BDK wallet.
//!
//! Deliberately NOT reproduced: finalizing FOREIGN non-final inputs (needs
//! a miniscript satisfier — the wallet finalizes its own inputs and passes
//! through inputs that are already final), `joinpsbts`, and
//! `testmempoolaccept` (no Electrum equivalent; the broadcast fan-over is
//! the mempool test).
//!
//! Addresses are rendered under the chain's own HRP (pocx/tpocx/rpocx) —
//! never through `bitcoin::Address`, which only knows bc/tb/bcrt.

use std::str::FromStr;

use bdk_wallet::{SignOptions, TxOrdering};
use bitcoin::{Amount, Psbt, ScriptBuf, Sequence};
use serde::{Deserialize, Serialize};

use electrum_btcx::SendFee;

use super::config::WalletNetwork;
use super::state::SharedBtcxWalletState;

/// Parse a base64 PSBT string.
fn parse_psbt(psbt_base64: &str) -> Result<Psbt, String> {
    Psbt::from_str(psbt_base64.trim()).map_err(|e| format!("Not a valid PSBT: {e}"))
}

/// Render a scriptPubKey as this network's address: bech32(m) for segwit
/// v0 (P2WPKH/P2WSH) and v1 (P2TR), base58check with the network's version
/// bytes for legacy P2PKH/P2SH (imported legacy-descriptor wallets must be
/// able to display their own addresses); anything else has no display form.
pub fn spk_to_address(network: WalletNetwork, spk: &ScriptBuf) -> Option<String> {
    let params = network.params();
    let bytes = spk.as_bytes();
    if spk.is_p2wpkh() || spk.is_p2wsh() {
        let hrp = bech32::Hrp::parse(params.bech32_hrp).ok()?;
        bech32::segwit::encode_v0(hrp, &bytes[2..]).ok()
    } else if spk.is_p2tr() {
        let hrp = bech32::Hrp::parse(params.bech32_hrp).ok()?;
        bech32::segwit::encode_v1(hrp, &bytes[2..]).ok()
    } else if spk.is_p2pkh() {
        // OP_DUP OP_HASH160 <20-byte hash> OP_EQUALVERIFY OP_CHECKSIG
        let mut payload = vec![params.p2pkh_prefix];
        payload.extend_from_slice(&bytes[3..23]);
        Some(bitcoin::base58::encode_check(&payload))
    } else if spk.is_p2sh() {
        // OP_HASH160 <20-byte hash> OP_EQUAL
        let mut payload = vec![params.p2sh_prefix];
        payload.extend_from_slice(&bytes[2..22]);
        Some(bitcoin::base58::encode_check(&payload))
    } else {
        None
    }
}

// ============================================================================
// Decode
// ============================================================================

/// One unsigned-tx input as the decode view shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtVinDto {
    pub txid: String,
    pub vout: u32,
    pub sequence: u32,
}

/// One unsigned-tx output as the decode view shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtVoutDto {
    pub n: u32,
    pub value_sat: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    pub script_hex: String,
    /// True for OP_RETURN outputs (rendered as data, not an address).
    pub op_return: bool,
}

/// Per-input PSBT metadata as the decode view shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtInputDto {
    pub index: u32,
    pub has_witness_utxo: bool,
    pub has_non_witness_utxo: bool,
    /// Value of the spent output, when the PSBT carries it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub utxo_value_sat: Option<u64>,
    /// Address of the spent output, when renderable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub utxo_address: Option<String>,
    /// Number of partial signatures present.
    pub partial_sigs: u32,
    /// Final script witness / scriptSig present — nothing left to sign.
    pub is_final: bool,
}

/// `btcx_psbt_decode` result — the client-side decodepsbt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtDecodeDto {
    pub txid: String,
    pub version: i32,
    pub locktime: u32,
    pub vin: Vec<PsbtVinDto>,
    pub vout: Vec<PsbtVoutDto>,
    pub inputs: Vec<PsbtInputDto>,
    /// Total in − total out, when every input's UTXO is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fee_sat: Option<u64>,
    /// Every input final — ready to extract.
    pub complete: bool,
}

/// Whether one PSBT input is final (finalized witness or scriptSig).
fn input_is_final(input: &bitcoin::psbt::Input) -> bool {
    input.final_script_witness.is_some() || input.final_script_sig.is_some()
}

/// The spent output of one PSBT input, when the PSBT carries it.
fn input_utxo(psbt: &Psbt, index: usize) -> Option<bitcoin::TxOut> {
    let input = &psbt.inputs[index];
    if let Some(wu) = &input.witness_utxo {
        return Some(wu.clone());
    }
    let prev = input.non_witness_utxo.as_ref()?;
    let vout = psbt.unsigned_tx.input[index].previous_output.vout as usize;
    prev.output.get(vout).cloned()
}

/// Decode a PSBT for display (client-side `decodepsbt`).
pub fn decode(network: WalletNetwork, psbt_base64: &str) -> Result<PsbtDecodeDto, String> {
    let psbt = parse_psbt(psbt_base64)?;
    let tx = &psbt.unsigned_tx;

    let vin = tx
        .input
        .iter()
        .map(|i| PsbtVinDto {
            txid: i.previous_output.txid.to_string(),
            vout: i.previous_output.vout,
            sequence: i.sequence.0,
        })
        .collect();
    let vout = tx
        .output
        .iter()
        .enumerate()
        .map(|(n, o)| PsbtVoutDto {
            n: n as u32,
            value_sat: o.value.to_sat(),
            address: spk_to_address(network, &o.script_pubkey),
            script_hex: o.script_pubkey.to_hex_string(),
            op_return: o.script_pubkey.is_op_return(),
        })
        .collect();
    let inputs: Vec<PsbtInputDto> = psbt
        .inputs
        .iter()
        .enumerate()
        .map(|(index, input)| {
            let utxo = input_utxo(&psbt, index);
            PsbtInputDto {
                index: index as u32,
                has_witness_utxo: input.witness_utxo.is_some(),
                has_non_witness_utxo: input.non_witness_utxo.is_some(),
                utxo_value_sat: utxo.as_ref().map(|u| u.value.to_sat()),
                utxo_address: utxo
                    .as_ref()
                    .and_then(|u| spk_to_address(network, &u.script_pubkey)),
                partial_sigs: input.partial_sigs.len() as u32,
                is_final: input_is_final(input),
            }
        })
        .collect();

    let complete = inputs.iter().all(|i| i.is_final) && !inputs.is_empty();
    Ok(PsbtDecodeDto {
        txid: tx.compute_txid().to_string(),
        version: tx.version.0,
        locktime: tx.lock_time.to_consensus_u32(),
        vin,
        vout,
        inputs,
        fee_sat: psbt.fee().ok().map(|f| f.to_sat()),
        complete,
    })
}

// ============================================================================
// Analyze
// ============================================================================

/// Per-input analysis (client-side `analyzepsbt`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtAnalyzeInputDto {
    pub index: u32,
    pub has_utxo: bool,
    pub is_final: bool,
    /// What this input needs next: `signer` | `finalizer` | `extractor`.
    pub next: &'static str,
}

/// `btcx_psbt_analyze` result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtAnalyzeDto {
    pub inputs: Vec<PsbtAnalyzeInputDto>,
    /// What the PSBT as a whole needs next:
    /// `updater` | `signer` | `finalizer` | `extractor`.
    pub next: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fee_sat: Option<u64>,
    /// Extractable-transaction vsize — only when every input is final.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_vsize: Option<u64>,
    /// fee / vsize, when both are known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_fee_rate_sat_vb: Option<f64>,
}

/// Analyze a PSBT's signing progress (client-side `analyzepsbt`).
pub fn analyze(psbt_base64: &str) -> Result<PsbtAnalyzeDto, String> {
    let psbt = parse_psbt(psbt_base64)?;
    let inputs: Vec<PsbtAnalyzeInputDto> = psbt
        .inputs
        .iter()
        .enumerate()
        .map(|(index, input)| {
            let is_final = input_is_final(input);
            let has_utxo = input_utxo(&psbt, index).is_some();
            let next = if is_final {
                "extractor"
            } else if !input.partial_sigs.is_empty() {
                // Has signatures but is not final — likely just needs the
                // finalizer (multisig thresholds can still need more).
                "finalizer"
            } else {
                "signer"
            };
            PsbtAnalyzeInputDto {
                index: index as u32,
                has_utxo,
                is_final,
                next,
            }
        })
        .collect();

    let next = if inputs.is_empty() {
        "updater"
    } else if inputs.iter().all(|i| i.is_final) {
        "extractor"
    } else if inputs.iter().any(|i| !i.has_utxo) {
        "updater"
    } else if inputs.iter().any(|i| i.next == "signer") {
        "signer"
    } else {
        "finalizer"
    };

    let fee_sat = psbt.fee().ok().map(|f| f.to_sat());
    // Extractable → exact vsize. Otherwise ESTIMATE it: unsigned weight plus
    // the standard satisfaction weight of every still-open input (P2WPKH
    // ~108 WU, P2TR key-path ~66 WU) — so the review shows a fee rate
    // before signing, not just after finalize.
    let estimated_vsize = if next == "extractor" {
        psbt.clone().extract_tx().ok().map(|tx| tx.vsize() as u64)
    } else {
        let tx = &psbt.unsigned_tx;
        let mut wu = tx.weight().to_wu();
        let mut known = !tx.input.is_empty();
        let mut any_witness = false;
        for (i, inp) in psbt.inputs.iter().enumerate() {
            if let Some(w) = &inp.final_script_witness {
                any_witness = true;
                wu += w.size() as u64;
            } else {
                match input_utxo(&psbt, i).map(|u| u.script_pubkey.clone()) {
                    Some(spk) if spk.is_p2wpkh() => {
                        any_witness = true;
                        wu += 108;
                    }
                    Some(spk) if spk.is_p2tr() => {
                        any_witness = true;
                        wu += 66;
                    }
                    _ => known = false,
                }
            }
        }
        if any_witness {
            wu += 2; // segwit marker + flag
        }
        known.then(|| wu.div_ceil(4))
    };
    let estimated_fee_rate_sat_vb = match (fee_sat, estimated_vsize) {
        (Some(fee), Some(vsize)) if vsize > 0 => Some(fee as f64 / vsize as f64),
        _ => None,
    };
    Ok(PsbtAnalyzeDto {
        inputs,
        next,
        fee_sat,
        estimated_vsize,
        estimated_fee_rate_sat_vb,
    })
}

// ============================================================================
// Sign / Finalize / Combine
// ============================================================================

/// `btcx_psbt_wallet_process` / `btcx_psbt_finalize` result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtProcessDto {
    /// The (possibly further-signed) PSBT, base64.
    pub psbt: String,
    /// Raw transaction hex — only when every input is final.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hex: Option<String>,
    /// Every input final.
    pub complete: bool,
}

/// Sign a PSBT with the open wallet (client-side `walletprocesspsbt`):
/// wallet-owned inputs gain signatures (and finalize when bdk can), foreign
/// inputs pass through untouched.
pub fn wallet_process(
    state: &SharedBtcxWalletState,
    psbt_base64: &str,
) -> Result<PsbtProcessDto, String> {
    let mut psbt = parse_psbt(psbt_base64)?;
    state.with_entry(|entry| {
        // trust_witness_utxo: imported PSBTs typically carry witness_utxo
        // only (no full prevout tx) — Core's walletprocesspsbt signs these
        // too. Foreign inputs are left untouched (sign() returns false).
        let options = SignOptions {
            trust_witness_utxo: true,
            ..Default::default()
        };
        entry
            .wallet
            .sign(&mut psbt, options)
            .map(|_| ())
            .map_err(|e| format!("signing: {e}"))
    })?;
    Ok(process_result(psbt))
}

/// Finalize a PSBT (client-side `finalizepsbt`): bdk finalizes the inputs
/// it can (wallet-owned, fully signed); already-final inputs stay final.
/// When everything is final the raw transaction hex is included.
pub fn finalize(
    state: &SharedBtcxWalletState,
    psbt_base64: &str,
) -> Result<PsbtProcessDto, String> {
    let mut psbt = parse_psbt(psbt_base64)?;
    state.with_entry(|entry| {
        let options = SignOptions {
            trust_witness_utxo: true,
            ..Default::default()
        };
        entry
            .wallet
            .finalize_psbt(&mut psbt, options)
            .map(|_| ())
            .map_err(|e| format!("finalizing: {e}"))
    })?;
    Ok(process_result(psbt))
}

fn process_result(psbt: Psbt) -> PsbtProcessDto {
    let complete = !psbt.inputs.is_empty() && psbt.inputs.iter().all(input_is_final);
    let hex = if complete {
        psbt.clone()
            .extract_tx()
            .ok()
            .map(|tx| bitcoin::consensus::encode::serialize_hex(&tx))
    } else {
        None
    };
    PsbtProcessDto {
        psbt: psbt.to_string(),
        hex,
        complete,
    }
}

/// Combine several PSBTs of the SAME transaction (client-side
/// `combinepsbt`) — merges signatures collected in parallel.
pub fn combine(psbts: &[String]) -> Result<String, String> {
    let mut iter = psbts.iter();
    let first = iter
        .next()
        .ok_or_else(|| "Give at least one PSBT".to_string())?;
    let mut combined = parse_psbt(first)?;
    for other in iter {
        combined
            .combine(parse_psbt(other)?)
            .map_err(|e| format!("Combining PSBTs: {e}"))?;
    }
    Ok(combined.to_string())
}

// ============================================================================
// Compose (walletcreatefundedpsbt) & UTXOs
// ============================================================================

/// One recipient of a composed PSBT.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtRecipient {
    pub address: String,
    pub amount_sat: u64,
}

/// Advanced compose options (all optional) — the client-side counterparts
/// of Core's `walletcreatefundedpsbt` options the Builder exposes. Custom
/// change is deliberately absent: bdk derives change from the internal
/// keychain and has no custom-change hook (issue #209).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsbtComposeOptions {
    /// Manual coin control: spend EXACTLY these outpoints ("txid:vout").
    #[serde(default)]
    pub utxos: Option<Vec<String>>,
    /// OP_RETURN payload (hex, max 80 bytes) added as a 0-value data output.
    #[serde(default)]
    pub data_hex: Option<String>,
    /// Absolute locktime (consensus u32: height < 500e6, else unix time).
    #[serde(default)]
    pub locktime: Option<u32>,
    /// Take the fee out of this output (index into `outputs`) instead of
    /// adding it on top — Core's `subtractFeeFromOutputs`.
    #[serde(default)]
    pub subtract_fee_output: Option<usize>,
}

/// Compose a funded, UNSIGNED PSBT paying `outputs` (client-side
/// `walletcreatefundedpsbt`): the wallet coin-selects, adds change, and
/// signals RBF; signing is a separate step (`wallet_process`).
pub fn create_funded_psbt(
    state: &SharedBtcxWalletState,
    outputs: &[PsbtRecipient],
    fee_rate_sat_vb: Option<f64>,
    options: Option<PsbtComposeOptions>,
) -> Result<String, String> {
    if outputs.is_empty() {
        return Err("Give at least one recipient".to_string());
    }
    let options = options.unwrap_or_default();
    if let Some(i) = options.subtract_fee_output {
        if i >= outputs.len() {
            return Err(format!("subtractFeeOutput {i} is out of range"));
        }
    }
    let manual_utxos: Option<Vec<bitcoin::OutPoint>> = options
        .utxos
        .as_ref()
        .map(|list| {
            list.iter()
                .map(|s| bitcoin::OutPoint::from_str(s).map_err(|e| format!("{s}: {e}")))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    let push_data: Option<bitcoin::script::PushBytesBuf> = options
        .data_hex
        .as_deref()
        .filter(|h| !h.trim().is_empty())
        .map(|h| {
            let bytes = hex_decode(h.trim()).map_err(|e| format!("OP_RETURN data: {e}"))?;
            if bytes.len() > 80 {
                return Err(format!(
                    "OP_RETURN data is {} bytes — the standardness limit is 80",
                    bytes.len()
                ));
            }
            bitcoin::script::PushBytesBuf::try_from(bytes)
                .map_err(|e| format!("OP_RETURN data: {e}"))
        })
        .transpose()?;
    let locktime = options
        .locktime
        .map(bitcoin::absolute::LockTime::from_consensus);
    let backend = state.backend()?;
    let params = state.get_config().network.params();
    let fee = match fee_rate_sat_vb {
        Some(rate) => SendFee::RatePerKvb((rate * 1000.0).round().max(0.0) as u64),
        None => SendFee::Target(6),
    };
    let feerate_kvb = backend
        .chain()
        .resolve_send_fee(fee)
        .map_err(|e| format!("{e:#}"))?;
    let feerate = bitcoin::FeeRate::from_sat_per_kwu((feerate_kvb + 2) / 4);

    #[allow(clippy::type_complexity)]
    let spks: Vec<(ScriptBuf, u64)> = outputs
        .iter()
        .map(|o| {
            params
                .parse_address(o.address.trim())
                .map(|spk| (spk, o.amount_sat))
                .map_err(|e| format!("{}: {e:#}", o.address))
        })
        .collect::<Result<_, _>>()?;

    state.ensure_first_sync()?;
    let psbt = state.with_entry(|entry| {
        // subtract_fee_output carries DRAIN semantics: the builder UI only
        // sets it via MAX ("everything left"), so the target output receives
        // whatever the funding set holds beyond the other outputs and the
        // fee. The typed amount is display-only in that case — building at
        // full amount + fee can never fund (that WAS the bug: 249.99999889
        // available of 249.99999999 needed).
        let mut builder = entry.wallet.build_tx();
        builder
            .ordering(TxOrdering::Shuffle)
            .fee_rate(feerate)
            // 0xFFFFFFFD: signals RBF AND (being < 0xFFFFFFFE) leaves an
            // absolute locktime enforceable despite the constant's name.
            .set_exact_sequence(Sequence::ENABLE_RBF_NO_LOCKTIME);
        if let Some(lt) = locktime {
            builder.nlocktime(lt);
        }
        if let Some(data) = &push_data {
            builder.add_data(data);
        }
        match (&manual_utxos, options.subtract_fee_output) {
            (Some(outpoints), _) => {
                builder
                    .add_utxos(outpoints)
                    .map_err(|e| format!("coin selection: {e}"))?;
                builder.manually_selected_only();
            }
            // Auto coins + MAX: the target drains the WHOLE wallet (minus
            // the other outputs and fee) — spend everything.
            (None, Some(_)) => {
                builder.drain_wallet();
            }
            (None, None) => {}
        }
        for (i, (spk, amount_sat)) in spks.iter().enumerate() {
            if options.subtract_fee_output == Some(i) {
                builder.drain_to(spk.clone());
            } else {
                builder.add_recipient(spk.clone(), Amount::from_sat(*amount_sat));
            }
        }
        let psbt = builder
            .finish()
            .map_err(|e| format!("building the transaction: {e}"))?;
        // Persist so the coin selection's reveal of a change address
        // survives; the UTXOs stay spendable until a signed tx broadcasts.
        entry
            .wallet
            .persist(&mut entry.conn)
            .map_err(|e| format!("persisting wallet: {e}"))?;
        Ok(psbt)
    })?;
    Ok(psbt.to_string())
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if !s.len().is_multiple_of(2) {
        return Err("odd-length hex".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

/// One spendable wallet UTXO (`btcx_wallet_utxos`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletUtxoDto {
    pub txid: String,
    pub vout: u32,
    pub amount_sat: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    pub confirmations: u32,
    /// External (receive) or internal (change) keychain.
    pub is_change: bool,
    /// The address' public key is revealed on-chain — an output at this script
    /// has already been spent, so the address appeared as a tx input. For
    /// P2WPKH the coins are then guarded only by the pubkey, not its hash; the
    /// coins view surfaces this as "Public key known".
    pub exposed: bool,
}

/// The wallet's unspent outputs, from the background-synced cache.
pub fn wallet_utxos(state: &SharedBtcxWalletState) -> Result<Vec<WalletUtxoDto>, String> {
    let network = state.get_config().network;
    state.with_entry(|entry| {
        let tip = entry.wallet.latest_checkpoint().height();
        // Scripts whose pubkey is revealed on-chain: any output the wallet owns
        // at the script has been spent (so it appeared as a tx input). All
        // coins currently at such a script are pubkey-exposed.
        let exposed_scripts: std::collections::HashSet<_> = entry
            .wallet
            .list_output()
            .filter(|o| o.is_spent)
            .map(|o| o.txout.script_pubkey.clone())
            .collect();
        Ok(entry
            .wallet
            .list_unspent()
            .map(|utxo| {
                let confirmations = match utxo.chain_position.confirmation_height_upper_bound() {
                    Some(height) if height <= tip => tip - height + 1,
                    _ => 0,
                };
                WalletUtxoDto {
                    txid: utxo.outpoint.txid.to_string(),
                    vout: utxo.outpoint.vout,
                    amount_sat: utxo.txout.value.to_sat(),
                    address: spk_to_address(network, &utxo.txout.script_pubkey),
                    confirmations,
                    is_change: utxo.keychain == bdk_wallet::KeychainKind::Internal,
                    exposed: exposed_scripts.contains(&utxo.txout.script_pubkey),
                }
            })
            .collect())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combine_rejects_empty_and_bad_input() {
        assert!(combine(&[]).is_err());
        assert!(combine(&["not-a-psbt".to_string()]).is_err());
    }

    #[test]
    fn decode_rejects_garbage() {
        assert!(decode(WalletNetwork::Regtest, "garbage").is_err());
        assert!(analyze("garbage").is_err());
    }

    #[test]
    fn spk_rendering_uses_chain_hrp() {
        use bitcoin::hashes::Hash;
        let spk = ScriptBuf::new_p2wpkh(&bitcoin::WPubkeyHash::from_byte_array([7u8; 20]));
        let mainnet = spk_to_address(WalletNetwork::Mainnet, &spk).unwrap();
        let regtest = spk_to_address(WalletNetwork::Regtest, &spk).unwrap();
        assert!(mainnet.starts_with("pocx1q"), "{mainnet}");
        assert!(regtest.starts_with("rpocx1q"), "{regtest}");
        // OP_RETURN and unknown scripts have no address form.
        assert_eq!(
            spk_to_address(WalletNetwork::Mainnet, &ScriptBuf::new()),
            None
        );
    }
}
