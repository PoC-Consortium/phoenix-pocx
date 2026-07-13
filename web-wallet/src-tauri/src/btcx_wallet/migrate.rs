//! One-time v30 → v31 wallet auto-migration (decision core)
//!
//! Phoenix desktop's legacy (v30) seeds derive at BIP32 coin type `0'`,
//! while the current standard (v31) derives at the BTCX coin type
//! (`keys_btcx::COIN_BTCX` = `0x504F4358`). A restored seed can therefore
//! carry history on BOTH branches, but a single wallet only opens ONE
//! policy. This migration gives a v30 wallet its v31 counterpart (and vice
//! versa when the legacy branch holds funds) as SEPARATE named wallets over
//! the SAME stored seed, so nothing is stranded on an invisible branch.
//!
//! This module is the PURE decision half: [`plan_v30_migration`] maps the
//! open wallet's policy, the restore-style branch probe, and the seed's
//! already-existing counterpart wallets onto a [`V30MigrationPlan`]. The
//! command layer (`commands::migrate_v30_impl`) executes the plan (name
//! resolution, seed re-derivation, `import_into_named_wallet`, flag
//! setting) — none of which lives here, so the trigger table is unit-tested
//! without a wallet, a seed or an Electrum server.

use super::config::DescriptorPolicy;
use super::manager::BranchHit;
use keys_btcx::COIN_BTCX;

/// A v31 wallet: derived at the BTCX coin type.
fn is_v31(policy: &DescriptorPolicy) -> bool {
    policy.coin_type == COIN_BTCX
}

/// A v30 (legacy Phoenix) wallet: derived at BIP32 coin type `0'`.
fn is_v30(policy: &DescriptorPolicy) -> bool {
    policy.coin_type == 0
}

/// What the one-time v30↔v31 migration should do for the OPEN wallet's seed.
///
/// The decision is over three inputs: the open wallet's own policy, the
/// restore-style branch probe of its seed, and the policies of the seed's
/// already-registered counterpart wallets (the active wallet plus, by name,
/// its `<base>` / `<base>-v30` sibling). Names and policy values the command
/// needs to CREATE a wallet are resolved there — this only says WHICH branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum V30MigrationPlan {
    /// Nothing to create — either both counterparts already exist, the
    /// legacy branch carries no funds, or the wallet is on neither coin
    /// type. The command still records the migration as done.
    Noop,
    /// The open wallet is a legacy v30 wallet with no v31 counterpart yet.
    /// Create the v31 wallet on `policy` under the clean base name, move the
    /// legacy wallet to the `-v30` name, and make the v31 wallet active.
    CreateV31 { policy: DescriptorPolicy },
    /// The open wallet is a v31 wallet, has no v30 counterpart, and the
    /// seed's legacy (coin type `0'`) branch DOES hold history: create the
    /// `-v30` counterpart on `policy` (the highest-priority legacy hit),
    /// leaving the v31 wallet active.
    CreateV30Legacy { policy: DescriptorPolicy },
}

/// Decide the migration for the open wallet's seed — the pure trigger table.
///
/// - both counterparts already registered → [`V30MigrationPlan::Noop`];
/// - only the v30 wallet exists (open wallet on coin type `0'`) → create the
///   v31 counterpart at the SAME kind / `COIN_BTCX` ([`V30MigrationPlan::CreateV31`]);
/// - only the v31 wallet exists (open wallet on `COIN_BTCX`) → create the
///   legacy v30 counterpart ONLY if the seed's coin-0' branch has history
///   ([`V30MigrationPlan::CreateV30Legacy`], highest-priority legacy hit),
///   else [`V30MigrationPlan::Noop`].
pub fn plan_v30_migration(
    active_policy: DescriptorPolicy,
    hits: &[BranchHit],
    existing_policies: &[DescriptorPolicy],
) -> V30MigrationPlan {
    let has_v31 = existing_policies.iter().any(is_v31);
    let has_v30 = existing_policies.iter().any(is_v30);

    // Both branches already have their own named wallet — done.
    if has_v31 && has_v30 {
        return V30MigrationPlan::Noop;
    }

    // Only the legacy v30 wallet exists: give the seed its v31 wallet
    // unconditionally (v31 is the branch the user should be defaulting to,
    // whether or not it already has on-chain history).
    if is_v30(&active_policy) && !has_v31 {
        return V30MigrationPlan::CreateV31 {
            // Preserve the wallet's address type (BIP-84 wpkh vs BIP-86
            // taproot); only the coin type moves to COIN_BTCX. A taproot v30
            // wallet must migrate to a taproot v31 wallet, not segwit.
            policy: DescriptorPolicy {
                kind: active_policy.kind,
                coin_type: COIN_BTCX,
            },
        };
    }

    // Only the v31 wallet exists: recover legacy funds by creating the v30
    // counterpart, but ONLY when the coin-0' branch actually holds history —
    // never manufacture an empty legacy wallet. The first coin-0' hit wins
    // (probe/candidate priority: BIP-84 before BIP-86).
    if is_v31(&active_policy) && !has_v30 {
        if let Some(hit) = hits.iter().find(|h| is_v30(&h.policy)) {
            return V30MigrationPlan::CreateV30Legacy { policy: hit.policy };
        }
    }

    V30MigrationPlan::Noop
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::btcx_wallet::config::DescriptorKindCfg;

    fn policy(kind: DescriptorKindCfg, coin_type: u32) -> DescriptorPolicy {
        DescriptorPolicy { kind, coin_type }
    }

    fn hit(policy: DescriptorPolicy) -> BranchHit {
        BranchHit {
            policy,
            deepest_external: Some(0),
            deepest_internal: None,
        }
    }

    const V31: DescriptorPolicy = DescriptorPolicy {
        kind: DescriptorKindCfg::Bip84,
        coin_type: COIN_BTCX,
    };
    const V30: DescriptorPolicy = DescriptorPolicy {
        kind: DescriptorKindCfg::Bip84,
        coin_type: 0,
    };

    #[test]
    fn both_counterparts_exist_is_noop() {
        // v30 active, but both wallets already registered → nothing to do,
        // regardless of what the probe reports.
        let plan = plan_v30_migration(V30, &[hit(V30), hit(V31)], &[V30, V31]);
        assert_eq!(plan, V30MigrationPlan::Noop);
        // Same verdict with the v31 wallet active.
        let plan = plan_v30_migration(V31, &[hit(V31), hit(V30)], &[V31, V30]);
        assert_eq!(plan, V30MigrationPlan::Noop);
    }

    #[test]
    fn only_v30_creates_the_v31_counterpart() {
        // The classic upgrade: the seed only has its legacy v30 wallet. The
        // v31 wallet is created at BIP-84 / COIN_BTCX even when the v31
        // branch itself has no history yet (only the v30 branch is a hit).
        let plan = plan_v30_migration(V30, &[hit(V30)], &[V30]);
        assert_eq!(plan, V30MigrationPlan::CreateV31 { policy: V31 });

        // No probe hits anywhere (a never-synced legacy wallet) still gets
        // its v31 counterpart — v31 creation does not depend on history.
        let plan = plan_v30_migration(V30, &[], &[V30]);
        assert_eq!(plan, V30MigrationPlan::CreateV31 { policy: V31 });

        // A BIP-86 (taproot) legacy wallet migrates to a BIP-86 v31 wallet —
        // the address type is preserved, only the coin type moves to BTCX.
        let v30_tr = policy(DescriptorKindCfg::Bip86, 0);
        let v31_tr = policy(DescriptorKindCfg::Bip86, COIN_BTCX);
        let plan = plan_v30_migration(v30_tr, &[hit(v30_tr)], &[v30_tr]);
        assert_eq!(plan, V30MigrationPlan::CreateV31 { policy: v31_tr });
    }

    #[test]
    fn only_v31_with_legacy_history_creates_the_v30_counterpart() {
        // The v31 wallet is open, no v30 sibling, and the seed's coin-0'
        // branch holds history → recover it as the v30 counterpart.
        let plan = plan_v30_migration(V31, &[hit(V31), hit(V30)], &[V31]);
        assert_eq!(plan, V30MigrationPlan::CreateV30Legacy { policy: V30 });
    }

    #[test]
    fn only_v31_without_legacy_history_is_noop() {
        // v31 open, no v30 sibling, and the probe finds NO coin-0' history →
        // never manufacture an empty legacy wallet.
        let plan = plan_v30_migration(V31, &[hit(V31)], &[V31]);
        assert_eq!(plan, V30MigrationPlan::Noop);
        // Not even when the probe is completely empty.
        let plan = plan_v30_migration(V31, &[], &[V31]);
        assert_eq!(plan, V30MigrationPlan::Noop);
    }

    #[test]
    fn legacy_hit_selection_prefers_bip84_over_bip86() {
        // Two coin-0' hits: the BIP-84 branch (candidate priority) is chosen
        // for the recovered v30 wallet.
        let v30_wpkh = policy(DescriptorKindCfg::Bip84, 0);
        let v30_tr = policy(DescriptorKindCfg::Bip86, 0);
        let plan = plan_v30_migration(V31, &[hit(v30_wpkh), hit(v30_tr)], &[V31]);
        assert_eq!(plan, V30MigrationPlan::CreateV30Legacy { policy: v30_wpkh });

        // Only a BIP-86 legacy hit present → that one is recovered.
        let plan = plan_v30_migration(V31, &[hit(v30_tr)], &[V31]);
        assert_eq!(plan, V30MigrationPlan::CreateV30Legacy { policy: v30_tr });
    }

    #[test]
    fn does_not_re_create_an_existing_counterpart() {
        // v31 open, the v30 sibling ALREADY exists, and the legacy branch
        // has history: no duplicate is created (has_v30 short-circuits).
        let plan = plan_v30_migration(V31, &[hit(V31), hit(V30)], &[V31, V30]);
        assert_eq!(plan, V30MigrationPlan::Noop);

        // v30 open, the v31 sibling already exists: no duplicate v31.
        let plan = plan_v30_migration(V30, &[hit(V30)], &[V30, V31]);
        assert_eq!(plan, V30MigrationPlan::Noop);
    }

    #[test]
    fn wallet_on_neither_coin_type_is_noop() {
        // A wallet on some other coin type (defensive — the command already
        // scopes migration to seed wallets) triggers nothing.
        let other = policy(DescriptorKindCfg::Bip84, 42);
        let plan = plan_v30_migration(other, &[hit(other)], &[other]);
        assert_eq!(plan, V30MigrationPlan::Noop);
    }
}
