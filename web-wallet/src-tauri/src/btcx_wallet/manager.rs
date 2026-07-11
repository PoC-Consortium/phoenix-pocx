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
//! ALL candidates are probed and every branch with history is collected;
//! the branch that is OPENED is the first hit in priority order (none =
//! fresh default), and the full hit list travels back to the UI so it can
//! tell the user when history also exists elsewhere:
//!
//! 1. BIP-84 / BTCX coin type (the current standard)
//! 2. BIP-86 / BTCX coin type
//! 3. BIP-84 / coin type 0' (legacy Phoenix desktop derivation)
//! 4. BIP-86 / coin type 0'
//!
//! (The Electrum surface exposes script histories but no batched balance
//! call, so ties between several hit branches are broken by this priority
//! order rather than by confirmed balance.)
//!
//! Implementation choice: instead of opening four temporary bdk wallets
//! and full-scanning each (4 × STOP_GAP windows of chain fetches plus four
//! throwaway sqlite stores), each candidate derives its first
//! [`PROBE_EXTERNAL_ADDRESSES`] external and [`PROBE_INTERNAL_ADDRESSES`]
//! internal (change) addresses and asks the Electrum server for their
//! script histories in ONE batched `histories` call — cheap and without
//! temporary state. The external probe deliberately looks DEEPER than the
//! first sync's gap scan (`electrum_btcx::STOP_GAP` = 25): a hit beyond
//! the gap window would be invisible to that scan, so [`ensure_probe_reach`]
//! pre-reveals addresses through the deepest hits, putting them on the
//! sync's revealed-spks path instead. The probing and selection logic is
//! factored into [`probe_branch_hits`] / [`select_restore_policy`] with
//! the history lookup injected, so it is unit-testable without a server.

use anyhow::{anyhow, Context, Result};
use bdk_wallet::rusqlite::Connection;
use bdk_wallet::{KeychainKind, Wallet};
use bitcoin::bip32::ChildNumber;
use bitcoin::{BlockHash, ScriptBuf};
use serde::Serialize;
use std::path::Path;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use electrum_btcx::{ElectrumBackend, WalletEntry, WalletHandle, STOP_GAP};
use keys_btcx::{WalletSeed, COIN_BTCX};
use params_btcx::params::ChainParams;

use super::config::{DescriptorKindCfg, DescriptorPolicy};

/// External (receive) addresses checked per restore-probe candidate.
/// Deliberately DEEPER than `electrum_btcx::STOP_GAP` (25) — hits beyond
/// the gap window are made reachable via [`ensure_probe_reach`].
pub const PROBE_EXTERNAL_ADDRESSES: u32 = 50;

/// Internal (change) addresses checked per restore-probe candidate. Change
/// indices never outrun receive usage by much, so the gap-scan width is
/// enough here.
pub const PROBE_INTERNAL_ADDRESSES: u32 = 25;

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
    let kind = policy
        .kind
        .kind()
        .ok_or_else(|| anyhow!("legacy wallets have no seed-derivation branch"))?;
    let (external, internal) = seed.wallet_descriptors(kind, policy.coin_type)?;
    // Constant for seed wallets: the bitcoin::Network handed to bdk only
    // affects xprv serialization and bdk's own (unused) address strings —
    // the real chain binding is the genesis-hash checkpoint. See the
    // wallet-btcx module docs.
    open_wallet_with_descriptors(
        db_path,
        params,
        &external,
        &internal,
        bitcoin::Network::Bitcoin,
    )
}

/// Open (or create) the bdk wallet store at `db_path` directly from a
/// stored PRIVATE descriptor pair (a descriptor-imported wallet — it has no
/// seed). Same honor checks as [`open_wallet`]: the stored descriptors AND
/// the coin's genesis hash must match, so a store created from other
/// descriptors refuses to load rather than silently mixing keys.
/// `bdk_network` must match the pair's key serialization (xprv → Bitcoin,
/// tprv → Testnet; see `descriptors::bdk_network`) — the chain binding is
/// still the genesis hash.
pub fn open_wallet_from_descriptors(
    db_path: &Path,
    params: &'static ChainParams,
    external: &str,
    internal: &str,
    bdk_network: bitcoin::Network,
) -> Result<WalletHandle> {
    open_wallet_with_descriptors(db_path, params, external, internal, bdk_network)
}

/// The shared open/create core of [`open_wallet`] and
/// [`open_wallet_from_descriptors`].
fn open_wallet_with_descriptors(
    db_path: &Path,
    params: &'static ChainParams,
    external: &str,
    internal: &str,
    bdk_network: bitcoin::Network,
) -> Result<WalletHandle> {
    let (external, internal) = (external.to_string(), internal.to_string());
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let mut conn = Connection::open(db_path)
        .with_context(|| format!("opening wallet db {}", db_path.display()))?;

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
        None => Wallet::create(external.clone(), internal.clone())
            .network(bdk_network)
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

/// The first `count` scriptPubKeys of one keychain (`change` 0 = external
/// / receive, 1 = internal / change) of the candidate branch:
/// `m/purpose'/coin_type'/0'/change/i`. P2WPKH for BIP-84, P2TR (BIP-341
/// tweaked key-spend) for BIP-86 — exactly what bdk derives from the same
/// descriptors.
pub fn candidate_spks(
    seed: &WalletSeed,
    policy: DescriptorPolicy,
    change: u32,
    count: u32,
) -> Result<Vec<ScriptBuf>> {
    let secp = seed.secp();
    let kind = policy
        .kind
        .kind()
        .ok_or_else(|| anyhow!("legacy wallets are never a restore-probe candidate"))?;
    let account = seed.wallet_account_xpriv(kind, policy.coin_type)?;
    let keychain = account.derive_priv(secp, &[ChildNumber::from_normal_idx(change)?])?;
    let mut spks = Vec::with_capacity(count as usize);
    for i in 0..count {
        let child = keychain.derive_priv(secp, &[ChildNumber::from_normal_idx(i)?])?;
        let pubkey = child.private_key.public_key(secp);
        let spk = match kind {
            keys_btcx::DescriptorKind::Bip84 => {
                let pk = bitcoin::PublicKey::new(pubkey);
                ScriptBuf::new_p2wpkh(&pk.wpubkey_hash().context("derived key is compressed")?)
            }
            keys_btcx::DescriptorKind::Bip86 => {
                let (xonly, _) = pubkey.x_only_public_key();
                ScriptBuf::new_p2tr(secp, xonly, None)
            }
        };
        spks.push(spk);
    }
    Ok(spks)
}

/// One probed branch that HAS transaction history, with the deepest used
/// index per keychain — what [`ensure_probe_reach`] needs to make the
/// wallet's sync see everything the probe saw. Serialized into the restore
/// response so the UI can report every branch that holds history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchHit {
    pub policy: DescriptorPolicy,
    /// Deepest external (receive) index with history, if any.
    pub deepest_external: Option<u32>,
    /// Deepest internal (change) index with history, if any.
    pub deepest_internal: Option<u32>,
}

/// Fold one candidate's per-address history flags into a [`BranchHit`]
/// (`None` when neither keychain has any history). Pure — the testable
/// core of the probe.
pub fn branch_hit(
    policy: DescriptorPolicy,
    external_used: &[bool],
    internal_used: &[bool],
) -> Option<BranchHit> {
    let deepest = |used: &[bool]| used.iter().rposition(|&u| u).map(|i| i as u32);
    let (deepest_external, deepest_internal) = (deepest(external_used), deepest(internal_used));
    if deepest_external.is_none() && deepest_internal.is_none() {
        return None;
    }
    Some(BranchHit {
        policy,
        deepest_external,
        deepest_internal,
    })
}

/// Probe EVERY candidate and collect the branches with history, preserving
/// candidate priority order. `probe` returns the per-address history flags
/// of one candidate (external, internal); it is injected so the collection
/// logic tests without a server. Errors propagate — a dead server must
/// fail the restore honestly, not silently report "no history".
pub fn probe_branch_hits(
    candidates: &[DescriptorPolicy],
    mut probe: impl FnMut(DescriptorPolicy) -> Result<(Vec<bool>, Vec<bool>)>,
) -> Result<Vec<BranchHit>> {
    let mut hits = Vec::new();
    for &candidate in candidates {
        let (external, internal) = probe(candidate)?;
        if let Some(hit) = branch_hit(candidate, &external, &internal) {
            hits.push(hit);
        }
    }
    Ok(hits)
}

/// Pick the branch a restored seed opens with from the collected hits
/// (candidate priority order): the first hit, or the fresh-wallet default
/// (BIP-84 / BTCX coin type) when no branch has history. The second value
/// is the honest "fresh" verdict for the UI.
pub fn select_restore_policy(hits: &[BranchHit]) -> (DescriptorPolicy, bool) {
    match hits.first() {
        Some(hit) => (hit.policy, false),
        None => (DescriptorPolicy::default(), true),
    }
}

/// Pick the branch for a restore that FORCES a descriptor family (the
/// mobile "create both wallets" flow): the first hit of that family in
/// candidate priority order (so a BTCX-coin-type hit wins over a legacy
/// coin-0 one), or the family's fresh default at the BTCX coin type when
/// no probed branch of it has history. The second value is the honest
/// "fresh" verdict — scoped to the forced family, not to the whole probe.
pub fn select_restore_policy_for_kind(
    hits: &[BranchHit],
    kind: DescriptorKindCfg,
) -> (DescriptorPolicy, bool) {
    match hits.iter().find(|hit| hit.policy.kind == kind) {
        Some(hit) => (hit.policy, false),
        None => (
            DescriptorPolicy {
                kind,
                coin_type: COIN_BTCX,
            },
            true,
        ),
    }
}

/// Electrum-backed probe over ALL candidates: per candidate, ONE batched
/// scripthash-history call covering the first
/// [`PROBE_EXTERNAL_ADDRESSES`] external plus [`PROBE_INTERNAL_ADDRESSES`]
/// internal addresses.
pub fn probe_all_branches(seed: &WalletSeed, chain: &ElectrumBackend) -> Result<Vec<BranchHit>> {
    probe_branch_hits(&probe_candidates(), |candidate| {
        let mut spks = candidate_spks(seed, candidate, 0, PROBE_EXTERNAL_ADDRESSES)?;
        spks.extend(candidate_spks(
            seed,
            candidate,
            1,
            PROBE_INTERNAL_ADDRESSES,
        )?);
        let histories = chain.histories(&spks)?;
        let mut used: Vec<bool> = histories.iter().map(|h| !h.is_empty()).collect();
        let internal = used.split_off(PROBE_EXTERNAL_ADDRESSES as usize);
        Ok((used, internal))
    })
}

/// Make sure the opened wallet's sync can see every hit the probe saw.
///
/// A fresh store's first sync is a gap scan that stops after
/// `electrum_btcx::STOP_GAP` consecutive unused addresses — a probe hit at
/// index >= STOP_GAP sits beyond it. When the winning branch has such a
/// deep hit, reveal addresses through the deepest hits (and at least
/// through the gap window, preserving the scan's minimum coverage) so the
/// sync takes its revealed-spks path over them instead. Shallow hits leave
/// the store untouched: the normal gap scan finds them AND keeps probing
/// past the probe's own depth.
pub fn ensure_probe_reach(entry: &mut WalletEntry, hit: &BranchHit) -> Result<()> {
    let deepest = hit
        .deepest_external
        .max(hit.deepest_internal)
        .unwrap_or_default();
    if deepest < STOP_GAP {
        return Ok(());
    }
    let floor = STOP_GAP - 1;
    let reveal_to = |deep: Option<u32>| deep.unwrap_or_default().max(floor);
    let _ = entry
        .wallet
        .reveal_addresses_to(KeychainKind::External, reveal_to(hit.deepest_external));
    let _ = entry
        .wallet
        .reveal_addresses_to(KeychainKind::Internal, reveal_to(hit.deepest_internal));
    entry
        .wallet
        .persist(&mut entry.conn)
        .context("persisting revealed probe reach")?;
    Ok(())
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
    fn probe_depth_vs_first_sync_reach() {
        // Internal hits must stay within the fresh-store gap scan (no
        // reveal-through happens for a branch whose only deep index is
        // internal but below STOP_GAP).
        assert!(
            PROBE_INTERNAL_ADDRESSES <= STOP_GAP,
            "internal probe hits must be re-findable by the first gap scan"
        );
        // The external probe intentionally exceeds the gap window — that is
        // exactly what ensure_probe_reach compensates for. If this stops
        // holding, ensure_probe_reach becomes dead code (remove it).
        assert!(
            PROBE_EXTERNAL_ADDRESSES > STOP_GAP,
            "external probe is expected to out-range the gap scan"
        );
    }

    fn no_use(count: u32) -> Vec<bool> {
        vec![false; count as usize]
    }

    fn used_at(count: u32, indices: &[u32]) -> Vec<bool> {
        let mut used = no_use(count);
        for &i in indices {
            used[i as usize] = true;
        }
        used
    }

    #[test]
    fn probe_collects_every_hit_in_priority_order() {
        // History on the legacy BIP-84/coin-0 branch AND the BIP-86/BTCX
        // branch: both are collected, priority order preserved, and the
        // selection opens the higher-priority BIP-86/BTCX branch.
        let hits = probe_branch_hits(&probe_candidates(), |cand| {
            let external = if cand == policy(DescriptorKindCfg::Bip84, 0) {
                used_at(PROBE_EXTERNAL_ADDRESSES, &[3])
            } else if cand == policy(DescriptorKindCfg::Bip86, COIN_BTCX) {
                used_at(PROBE_EXTERNAL_ADDRESSES, &[0, 7])
            } else {
                no_use(PROBE_EXTERNAL_ADDRESSES)
            };
            Ok((external, no_use(PROBE_INTERNAL_ADDRESSES)))
        })
        .unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].policy, policy(DescriptorKindCfg::Bip86, COIN_BTCX));
        assert_eq!(hits[0].deepest_external, Some(7));
        assert_eq!(hits[1].policy, policy(DescriptorKindCfg::Bip84, 0));
        assert_eq!(hits[1].deepest_external, Some(3));

        let (selected, fresh) = select_restore_policy(&hits);
        assert_eq!(selected, policy(DescriptorKindCfg::Bip86, COIN_BTCX));
        assert!(!fresh);
    }

    #[test]
    fn probe_detects_change_only_history() {
        // A swept / change-only wallet: history exclusively on the internal
        // keychain still counts as a hit.
        let hits = probe_branch_hits(&probe_candidates(), |cand| {
            let internal = if cand == policy(DescriptorKindCfg::Bip84, 0) {
                used_at(PROBE_INTERNAL_ADDRESSES, &[2])
            } else {
                no_use(PROBE_INTERNAL_ADDRESSES)
            };
            Ok((no_use(PROBE_EXTERNAL_ADDRESSES), internal))
        })
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].policy, policy(DescriptorKindCfg::Bip84, 0));
        assert_eq!(hits[0].deepest_external, None);
        assert_eq!(hits[0].deepest_internal, Some(2));
    }

    #[test]
    fn select_restore_policy_for_kind_forces_the_family() {
        // Hits on BIP-84/BTCX and BIP-86/coin-0: forcing BIP-86 must pick
        // the taproot hit (even though it is lower priority overall), and
        // forcing BIP-84 keeps the winner.
        let hit = |policy| BranchHit {
            policy,
            deepest_external: Some(0),
            deepest_internal: None,
        };
        let hits = [
            hit(policy(DescriptorKindCfg::Bip84, COIN_BTCX)),
            hit(policy(DescriptorKindCfg::Bip86, 0)),
        ];

        let (selected, fresh) = select_restore_policy_for_kind(&hits, DescriptorKindCfg::Bip86);
        assert_eq!(selected, policy(DescriptorKindCfg::Bip86, 0));
        assert!(!fresh);

        let (selected, fresh) = select_restore_policy_for_kind(&hits, DescriptorKindCfg::Bip84);
        assert_eq!(selected, policy(DescriptorKindCfg::Bip84, COIN_BTCX));
        assert!(!fresh);

        // Within a family, candidate priority order breaks ties: the
        // BTCX-coin-type branch wins over the legacy coin-0 one.
        let hits = [
            hit(policy(DescriptorKindCfg::Bip86, COIN_BTCX)),
            hit(policy(DescriptorKindCfg::Bip86, 0)),
        ];
        let (selected, fresh) = select_restore_policy_for_kind(&hits, DescriptorKindCfg::Bip86);
        assert_eq!(selected, policy(DescriptorKindCfg::Bip86, COIN_BTCX));
        assert!(!fresh);

        // No hit of the forced family anywhere: fresh default of THAT
        // family at the BTCX coin type, with an honest fresh verdict.
        let hits = [hit(policy(DescriptorKindCfg::Bip84, COIN_BTCX))];
        let (selected, fresh) = select_restore_policy_for_kind(&hits, DescriptorKindCfg::Bip86);
        assert_eq!(selected, policy(DescriptorKindCfg::Bip86, COIN_BTCX));
        assert!(fresh);
    }

    #[test]
    fn select_restore_policy_defaults_to_fresh_bip84_btcx() {
        let (selected, fresh) = select_restore_policy(&[]);
        assert!(fresh, "no hits anywhere is an honest fresh verdict");
        assert_eq!(selected, DescriptorPolicy::default());
        assert_eq!(selected, policy(DescriptorKindCfg::Bip84, COIN_BTCX));
    }

    #[test]
    fn probe_branch_hits_propagates_probe_errors() {
        // A dead server must fail the restore honestly, not silently open
        // a fresh wallet over a seed that may have history elsewhere.
        let result = probe_branch_hits(&probe_candidates(), |_| {
            anyhow::bail!("electrum unreachable")
        });
        assert!(result.is_err());
    }

    #[test]
    fn candidate_spks_match_published_bip_vectors() {
        // BIP-84 m/84'/0'/0'/0/0 of the standard test mnemonic:
        // bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu. Deriving at coin
        // type 0 reproduces the published vector's scriptPubKey exactly.
        let spks = candidate_spks(&seed(), policy(DescriptorKindCfg::Bip84, 0), 0, 2).unwrap();
        let vector = bitcoin::Address::from_str("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")
            .unwrap()
            .require_network(bitcoin::Network::Bitcoin)
            .unwrap()
            .script_pubkey();
        assert_eq!(spks[0], vector);

        // BIP-84 m/84'/0'/0'/1/0 published CHANGE vector.
        let spks = candidate_spks(&seed(), policy(DescriptorKindCfg::Bip84, 0), 1, 1).unwrap();
        let vector = bitcoin::Address::from_str("bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el")
            .unwrap()
            .require_network(bitcoin::Network::Bitcoin)
            .unwrap()
            .script_pubkey();
        assert_eq!(spks[0], vector);

        // BIP-86 m/86'/0'/0'/0/0 published vector.
        let spks = candidate_spks(&seed(), policy(DescriptorKindCfg::Bip86, 0), 0, 1).unwrap();
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
    fn candidate_spks_are_disjoint_across_candidates_and_keychains() {
        let all: Vec<Vec<ScriptBuf>> = probe_candidates()
            .into_iter()
            .flat_map(|c| {
                [
                    candidate_spks(&seed(), c, 0, PROBE_EXTERNAL_ADDRESSES).unwrap(),
                    candidate_spks(&seed(), c, 1, PROBE_INTERNAL_ADDRESSES).unwrap(),
                ]
            })
            .collect();
        let flat: Vec<&ScriptBuf> = all.iter().flatten().collect();
        let distinct: std::collections::HashSet<_> = flat.iter().collect();
        assert_eq!(
            flat.len(),
            distinct.len(),
            "every candidate keychain derives its own address space"
        );
    }

    #[test]
    fn ensure_probe_reach_reveals_only_beyond_gap_hits() {
        let dir = tempfile::tempdir().unwrap();
        let params = super::super::config::WalletNetwork::Regtest.params();

        // Shallow hit: the store stays fresh so the first sync's gap scan
        // runs (it covers the hit AND keeps probing past the probe depth).
        let db = dir.path().join("shallow").join("btcx.sqlite");
        let handle = open_wallet(&db, params, &seed(), DescriptorPolicy::default()).unwrap();
        let shallow = BranchHit {
            policy: DescriptorPolicy::default(),
            deepest_external: Some(STOP_GAP - 1),
            deepest_internal: None,
        };
        {
            let mut guard = handle.lock().unwrap();
            ensure_probe_reach(&mut guard, &shallow).unwrap();
            assert_eq!(
                guard.wallet.derivation_index(KeychainKind::External),
                None,
                "shallow hits must leave the store fresh (gap scan intact)"
            );
        }

        // Deep hit: revealed through the hit (external) and through the gap
        // window floor (internal), persisted.
        let db = dir.path().join("deep").join("btcx.sqlite");
        let handle = open_wallet(&db, params, &seed(), DescriptorPolicy::default()).unwrap();
        let deep = BranchHit {
            policy: DescriptorPolicy::default(),
            deepest_external: Some(40),
            deepest_internal: Some(3),
        };
        {
            let mut guard = handle.lock().unwrap();
            ensure_probe_reach(&mut guard, &deep).unwrap();
            assert_eq!(
                guard.wallet.derivation_index(KeychainKind::External),
                Some(40)
            );
            assert_eq!(
                guard.wallet.derivation_index(KeychainKind::Internal),
                Some(STOP_GAP - 1)
            );
        }
        drop(handle);
        // Survives a reopen (persisted, not just in-memory).
        let handle = open_wallet(&db, params, &seed(), DescriptorPolicy::default()).unwrap();
        let guard = handle.lock().unwrap();
        assert_eq!(
            guard.wallet.derivation_index(KeychainKind::External),
            Some(40)
        );
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
