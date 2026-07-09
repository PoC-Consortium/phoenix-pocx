//! Wallet open + restore-time descriptor probing
//!
//! `open_wallet` mirrors `wallet_btcx::WalletManager::open`, but takes the
//! descriptor policy (purpose family + BIP32 coin type) EXPLICITLY instead
//! of resolving the coin type from the registry. That is what lets a
//! restore open a legacy Phoenix branch: legacy desktop seeds derive at
//! coin type 0' while new wallets use the BTCX coin type
//! (`keys_btcx::COIN_BTCX`), and `WalletManager` can only express the
//! registry's coin type.
//!
//! ## Restore probing
//!
//! On restore we do NOT know which branch the seed's history lives on, so
//! the candidates are probed in order — first hit wins, none = fresh
//! default:
//!
//! 1. BIP-84 / BTCX coin type (the current standard)
//! 2. BIP-86 / BTCX coin type
//! 3. BIP-84 / coin type 0' (legacy Phoenix desktop derivation)
//! 4. BIP-86 / coin type 0'
//!
//! Implementation choice: instead of opening four temporary bdk wallets
//! and full-scanning each (4 × STOP_GAP windows of chain fetches plus four
//! throwaway sqlite stores), each candidate derives its first
//! [`PROBE_ADDRESSES`] external addresses and asks the Electrum server for
//! their script histories in ONE batched `histories` call — cheap, no
//! temporary state, and `electrum-btcx`'s later first sync (STOP_GAP = 25
//! exceeds the probe's 20) rediscovers everything the probe saw. The
//! candidate ordering and
//! selection logic is factored into [`pick_restore_policy`] with the
//! history lookup injected, so it is unit-testable without a server.

use anyhow::{anyhow, Context, Result};
use bdk_wallet::rusqlite::Connection;
use bdk_wallet::{KeychainKind, Wallet};
use bitcoin::bip32::ChildNumber;
use bitcoin::{BlockHash, ScriptBuf};
use std::path::Path;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use electrum_btcx::{ElectrumBackend, WalletEntry, WalletHandle};
use keys_btcx::{WalletSeed, COIN_BTCX};
use params_btcx::params::ChainParams;

use super::config::{DescriptorKindCfg, DescriptorPolicy};

/// External addresses checked per restore-probe candidate. Must stay below
/// `electrum_btcx::STOP_GAP` (25) so the wallet's first full sync is
/// guaranteed to re-find any history the probe found.
pub const PROBE_ADDRESSES: u32 = 20;

/// Open (or create) the bdk wallet store at `db_path`, deriving its
/// descriptors from `seed` at the `policy` branch. Modeled on
/// `wallet_btcx::WalletManager::open` (including its honor checks: the
/// stored descriptors AND the coin's genesis hash must match, so a store
/// created from another seed/branch refuses to load rather than silently
/// mixing keys), with the coin type explicit for legacy-branch restores.
pub fn open_wallet(
    db_path: &Path,
    params: &'static ChainParams,
    seed: &WalletSeed,
    policy: DescriptorPolicy,
) -> Result<WalletHandle> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let mut conn = Connection::open(db_path)
        .with_context(|| format!("opening wallet db {}", db_path.display()))?;

    let (external, internal) = seed.wallet_descriptors(policy.kind.kind(), policy.coin_type)?;
    let genesis = BlockHash::from_str(params.genesis_hash)
        .context("coin genesis hash is not a block hash")?;

    let loaded = Wallet::load()
        .descriptor(KeychainKind::External, Some(external.clone()))
        .descriptor(KeychainKind::Internal, Some(internal.clone()))
        .extract_keys()
        .check_genesis_hash(genesis)
        .load_wallet(&mut conn)
        .map_err(|e| anyhow!("loading wallet db {}: {e}", db_path.display()))?;
    let wallet = match loaded {
        Some(wallet) => wallet,
        None => Wallet::create(external, internal)
            // Constant: the bitcoin::Network handed to bdk only affects
            // xprv serialization and bdk's own (unused) address strings —
            // the real chain binding is the genesis-hash checkpoint. See
            // the wallet-btcx module docs.
            .network(bitcoin::Network::Bitcoin)
            .genesis_hash(genesis)
            .create_wallet(&mut conn)
            .map_err(|e| anyhow!("creating wallet db {}: {e}", db_path.display()))?,
    };

    Ok(Arc::new(Mutex::new(WalletEntry { wallet, conn })))
}

/// The restore-probe candidates, in probe order (see module docs).
pub fn probe_candidates() -> [DescriptorPolicy; 4] {
    [
        DescriptorPolicy {
            kind: DescriptorKindCfg::Bip84,
            coin_type: COIN_BTCX,
        },
        DescriptorPolicy {
            kind: DescriptorKindCfg::Bip86,
            coin_type: COIN_BTCX,
        },
        DescriptorPolicy {
            kind: DescriptorKindCfg::Bip84,
            coin_type: 0,
        },
        DescriptorPolicy {
            kind: DescriptorKindCfg::Bip86,
            coin_type: 0,
        },
    ]
}

/// The first `count` EXTERNAL (receive) scriptPubKeys of the candidate
/// branch: `m/purpose'/coin_type'/0'/0/i`. P2WPKH for BIP-84, P2TR
/// (BIP-341 tweaked key-spend) for BIP-86 — exactly what bdk derives from
/// the same descriptors.
pub fn candidate_spks(
    seed: &WalletSeed,
    policy: DescriptorPolicy,
    count: u32,
) -> Result<Vec<ScriptBuf>> {
    let secp = seed.secp();
    let account = seed.wallet_account_xpriv(policy.kind.kind(), policy.coin_type)?;
    let external = account.derive_priv(secp, &[ChildNumber::from_normal_idx(0)?])?;
    let mut spks = Vec::with_capacity(count as usize);
    for i in 0..count {
        let child = external.derive_priv(secp, &[ChildNumber::from_normal_idx(i)?])?;
        let pubkey = child.private_key.public_key(secp);
        let spk = match policy.kind {
            DescriptorKindCfg::Bip84 => {
                let pk = bitcoin::PublicKey::new(pubkey);
                ScriptBuf::new_p2wpkh(&pk.wpubkey_hash().context("derived key is compressed")?)
            }
            DescriptorKindCfg::Bip86 => {
                let (xonly, _) = pubkey.x_only_public_key();
                ScriptBuf::new_p2tr(secp, xonly, None)
            }
        };
        spks.push(spk);
    }
    Ok(spks)
}

/// Pick the descriptor policy a restored seed should open with: the FIRST
/// candidate `has_history` reports transaction history for; when none has
/// any, the fresh-wallet default (BIP-84 / BTCX coin type). The history
/// lookup is injected so this ordering logic tests without a server.
pub fn pick_restore_policy(
    candidates: &[DescriptorPolicy],
    mut has_history: impl FnMut(DescriptorPolicy) -> Result<bool>,
) -> Result<DescriptorPolicy> {
    for &candidate in candidates {
        if has_history(candidate)? {
            return Ok(candidate);
        }
    }
    Ok(DescriptorPolicy::default())
}

/// Electrum-backed restore probe: one batched scripthash-history call per
/// candidate over its first [`PROBE_ADDRESSES`] external addresses.
pub fn probe_restore_policy(
    seed: &WalletSeed,
    chain: &ElectrumBackend,
) -> Result<DescriptorPolicy> {
    pick_restore_policy(&probe_candidates(), |candidate| {
        let spks = candidate_spks(seed, candidate, PROBE_ADDRESSES)?;
        let histories = chain.histories(&spks)?;
        Ok(histories.iter().any(|h| !h.is_empty()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    /// The standard BIP39 test mnemonic (public test vectors).
    const TEST_MNEMONIC: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn seed() -> WalletSeed {
        WalletSeed::from_mnemonic(TEST_MNEMONIC, "").unwrap()
    }

    fn policy(kind: DescriptorKindCfg, coin_type: u32) -> DescriptorPolicy {
        DescriptorPolicy { kind, coin_type }
    }

    #[test]
    fn probe_candidate_ordering() {
        // New-standard branches first, legacy Phoenix coin-0 branches after
        // — the order decides which history a mixed seed restores to.
        assert_eq!(
            probe_candidates(),
            [
                policy(DescriptorKindCfg::Bip84, COIN_BTCX),
                policy(DescriptorKindCfg::Bip86, COIN_BTCX),
                policy(DescriptorKindCfg::Bip84, 0),
                policy(DescriptorKindCfg::Bip86, 0),
            ]
        );
    }

    #[test]
    #[allow(clippy::assertions_on_constants)] // the guard IS the point
    fn probe_stays_within_first_sync_reach() {
        assert!(
            electrum_btcx::STOP_GAP > PROBE_ADDRESSES,
            "the wallet's first full scan must re-find anything the probe found"
        );
    }

    #[test]
    fn pick_restore_policy_takes_first_hit_and_stops() {
        let mut probed = Vec::new();
        let picked = pick_restore_policy(&probe_candidates(), |cand| {
            probed.push(cand);
            // History only on the legacy BIP-84/coin-0 branch (candidate 3).
            Ok(cand == policy(DescriptorKindCfg::Bip84, 0))
        })
        .unwrap();
        assert_eq!(picked, policy(DescriptorKindCfg::Bip84, 0));
        assert_eq!(probed.len(), 3, "probing stops at the first hit");
    }

    #[test]
    fn pick_restore_policy_defaults_to_fresh_bip84_btcx() {
        let picked = pick_restore_policy(&probe_candidates(), |_| Ok(false)).unwrap();
        assert_eq!(picked, DescriptorPolicy::default());
        assert_eq!(picked, policy(DescriptorKindCfg::Bip84, COIN_BTCX));
    }

    #[test]
    fn pick_restore_policy_propagates_probe_errors() {
        // A dead server must fail the restore honestly, not silently open
        // a fresh wallet over a seed that may have history elsewhere.
        let result = pick_restore_policy(&probe_candidates(), |_| {
            anyhow::bail!("electrum unreachable")
        });
        assert!(result.is_err());
    }

    #[test]
    fn candidate_spks_match_published_bip_vectors() {
        // BIP-84 m/84'/0'/0'/0/0 of the standard test mnemonic:
        // bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu. Deriving at coin
        // type 0 reproduces the published vector's scriptPubKey exactly.
        let spks = candidate_spks(&seed(), policy(DescriptorKindCfg::Bip84, 0), 2).unwrap();
        let vector = bitcoin::Address::from_str("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")
            .unwrap()
            .require_network(bitcoin::Network::Bitcoin)
            .unwrap()
            .script_pubkey();
        assert_eq!(spks[0], vector);

        // BIP-86 m/86'/0'/0'/0/0 published vector.
        let spks = candidate_spks(&seed(), policy(DescriptorKindCfg::Bip86, 0), 1).unwrap();
        let vector = bitcoin::Address::from_str(
            "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
        )
        .unwrap()
        .require_network(bitcoin::Network::Bitcoin)
        .unwrap()
        .script_pubkey();
        assert_eq!(spks[0], vector);
    }

    #[test]
    fn candidate_spks_are_disjoint_across_candidates() {
        let all: Vec<Vec<ScriptBuf>> = probe_candidates()
            .into_iter()
            .map(|c| candidate_spks(&seed(), c, PROBE_ADDRESSES).unwrap())
            .collect();
        let flat: Vec<&ScriptBuf> = all.iter().flatten().collect();
        let distinct: std::collections::HashSet<_> = flat.iter().collect();
        assert_eq!(
            flat.len(),
            distinct.len(),
            "every candidate derives its own address space"
        );
        for spks in &all {
            assert_eq!(spks.len(), PROBE_ADDRESSES as usize);
        }
    }

    #[test]
    fn open_wallet_creates_persists_and_refuses_wrong_branch() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("wallet").join("btcx.sqlite");
        let params = super::super::config::WalletNetwork::Regtest.params();

        let handle = open_wallet(&db, params, &seed(), DescriptorPolicy::default()).unwrap();
        {
            let mut guard = handle.lock().unwrap();
            let entry = &mut *guard;
            let addr = entry
                .wallet
                .reveal_next_address(bdk_wallet::KeychainKind::External);
            assert_eq!(addr.index, 0);
            entry.wallet.persist(&mut entry.conn).unwrap();
        }
        drop(handle);

        // Reopening with the SAME policy resumes the store (index survived).
        let handle = open_wallet(&db, params, &seed(), DescriptorPolicy::default()).unwrap();
        {
            let entry = handle.lock().unwrap();
            assert_eq!(
                entry
                    .wallet
                    .derivation_index(bdk_wallet::KeychainKind::External),
                Some(0)
            );
        }
        drop(handle);

        // A different branch (legacy coin-0) must refuse the load, not mix keys.
        let err = open_wallet(&db, params, &seed(), policy(DescriptorKindCfg::Bip84, 0));
        assert!(err.is_err(), "descriptor mismatch must fail the load");
    }
}
