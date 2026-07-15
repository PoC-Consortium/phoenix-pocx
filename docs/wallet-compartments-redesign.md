# Wallet Compartments Redesign

**Status:** Planned (not yet implemented)
**Date:** 2026-07-15
**Scope:** Nodeless / remote (BDK + Electrum) wallet model only — desktop **and** mobile. Core-managed/external node mode is out of scope.

---

## Problem

Today, one named remote-mode wallet = one `DescriptorPolicy { kind, coin_type }` = one BDK store. The other derivation branches of the same seed surface as **separate top-level sibling wallets** (`-v31`, `-v30`, `-segwit`, `-taproot`) with a thicket of supporting UI: "Upgrade to v31", "recover/rescan old funds", a create-both/kind-choice prompt, and coin-type badges. The segwit/taproot × v30/v31 story reads as a mess.

## Key realization

The sibling wallets **already exist**. Restore-probing already enumerates exactly the four branches (`manager.rs` `probe_candidates`); `migrate_v30` already creates a `-v31` sibling over the same seed; `rescan_legacy` already creates a `-v30` counterpart. So this redesign is **grouping + balance aggregation + deleting friction**, not new wallet machinery.

## Model

One **WalletName** = one seed = a **group**. Opening it reveals up to four **compartments** ("pockets"):

| | SegWit (BIP84) | Taproot (BIP86) |
|---|---|---|
| **Current** (coin `0x504F4358`) | `sw` | `tr` |
| **Legacy / v30** (coin `0'`) | `sw` · v30 | `tr` · v30 |

Each compartment has its own balance; the group row shows the **sum**.

**Network-aware:** mainnet has up to 4 compartments; **testnet/regtest have only 2** — coin type is `1'` for both eras there, so the v30/v31 axis collapses. The UI must not render 4 empty pockets on testnet.

"Legacy" = the old **derivation era** (coin type `0'`), still segwit/taproot scripts — not old *address types*. True `pkh` / `sh(wpkh)` legacy only arrives via descriptor **import**; those wallets have no seed and stay single-compartment.

## Decisions

1. **Sync model — balance snapshots + one-shot sync on group-open.** The active pocket is always live (unchanged single-runtime model). Non-active pockets show a persisted `balance_snapshot`, refreshed by a quick sequential one-shot sync when the group opens. **No changes to the pinned `btcx` crates** (`electrum-btcx` / `wallet-btcx`). Non-active balances may be slightly stale — acceptable for an overview.
2. **Visibility — current SegWit + Taproot always; a v30 pocket only when funded.** Most users see 2 pockets; legacy appears only when relevant.
3. **Terminology — v30 = legacy (coin `0'`), v31 = current (BTCX `0x504F4358`). No v32.** Current pockets shown as plain "SegWit"/"Taproot"; old-era pockets tagged "v30".

## Rules

- **Receive** defaults to the current SegWit pocket (Taproot if that pocket is selected). **v30 pockets are spend-only** — no receiving into coin `0'`. "Recover old funds" becomes: open wallet → tap the v30 pocket → Send.
- **Send** operates on the active pocket's UTXOs. Switching pocket for a spend pays a runtime reopen (balances stay instant via snapshots). Cross-pocket coin-control in one tx is not possible with separate BDK stores — and not needed (sequential sends drain each pocket).
- **Assignments / mining** stay gated to segwit pockets (a plot account is a segwit-v0 witness program), as today.
- **Descriptor-imported / single-address** wallets stay single-compartment and render as a normal single row.

## What gets deleted

`btcx_wallet_migrate_v30`, `btcx_wallet_rescan_legacy`, the v30 badge, "Upgrade to v31", the recover/rescan-legacy card, the create-both / kind-choice prompt, and the per-row kind badges — replaced by the compartment strip.

---

## Implementation plan

### Phase 1 — Backend: grouping + snapshots (Rust, one PR)

- `WalletMeta`: add `group: String` and `balance_snapshot: Option<{ sat, height, at }>`. Compartment role derives from the existing `policy`.
- The sync emitter writes the snapshot for the live compartment on each `btcx-wallet:sync`.
- New `btcx_wallet_group_sync` command: sequential one-shot sync of the group's other **funded** compartments → persist snapshots → return the grouped summary (per-pocket + summed).
- `btcx_wallet_list` returns **grouped** summaries (group row + compartments + Σ), snapshot-sourced (no store opens for the row).
- Config migration: fold existing `-v31` / `-v30` / `-segwit` / `-taproot` siblings into groups by stripped base name; imported / single-address → singleton group. Idempotent and abort-safe, mirroring the existing layout migration. **Back up `btcx_wallet_config.json` first.**
- Old commands kept alive this phase (no UI break).
- Rust unit tests for migration, grouping, and snapshot math.

### Phase 2 — Materialize instead of buttons (Rust)

- Create/restore registers the current SegWit + Taproot compartments, plus any v30 pocket the probe found history on.
- Retire the `btcx_wallet_migrate_v30` / `btcx_wallet_rescan_legacy` paths (keep as no-ops until the UI is off them).

### Phase 3 — Mobile UI (primary remote surface)

- List: one collapsible **group row** (name, Σ balance, lock/active markers).
- Group view: **compartment strip** — SegWit + Taproot cards with snapshot balances + a Σ header; the v30 card appears only when funded.
- Receive defaults to current SegWit (Taproot if selected); v30 pockets are spend-only.
- Send picks the active pocket; switching pocket for a spend pays a runtime reopen (balances stay instant).
- Delete: v30 badge, "Upgrade to v31", recover/rescan card, create-both prompt.

### Phase 4 — Desktop remote UI

- Same grouping in the wallet-select + settings `isRemote()` branches. Leave Core-managed mode's seed-reentry upgrade dialog untouched (out of scope).

### Phase 5 — Cleanup

- Remove dead commands + i18n once both surfaces are migrated.

## Risk notes

- Money-critical (seeds, balances) → Phase 1 ships behind unchanged behavior and is independently testable before any UI moves.
- Snapshot staleness only affects non-active pockets' *displayed* balance; the active pocket is always live, and spends always operate on a freshly-synced runtime.
- Regrouping is a config rewrite (wallet dirs untouched) — reversible in principle, but back up `btcx_wallet_config.json` before the migration.

---

## Reference: current implementation (as of planning)

- Registry: `web-wallet/src-tauri/src/btcx_wallet/config.rs` — `BtcxWalletConfig.wallets: net → name → WalletMeta`, `DescriptorPolicy { kind, coin_type }`, `DescriptorKindCfg` (Bip84/Bip86/Legacy).
- Coin type: `params_btcx::registry::btcx_coin_type(network)` — mainnet `0x504F4358`, testnet/regtest `1'`. `keys_btcx::COIN_BTCX = 0x504F4358`.
- Runtime: `state.rs` — single `WalletRuntime` (BDK handle + `SyncWorker` + `btcx-wallet:sync` emitter), one open wallet at a time.
- Open / restore-probe: `manager.rs` — descriptor-explicit open; `probe_candidates` enumerates BIP84/BTCX, BIP86/BTCX, then (mainnet) BIP84/0', BIP86/0'.
- v30→v31 + rescan: `commands.rs` §375–710 — `migrate_v30_impl` (creates `-v31` sibling), `rescan_legacy_impl` (creates `-v30` counterpart).
- Frontend service: `web-wallet/src/app/core/services/btcx-wallet.service.ts` — `wallets`, `descriptorPolicy`, `select`, `migrateV30`, `rescanLegacy`, `upgradeV30`, balance signal (single aggregate, no per-script split).
- UI: `features/mobile-wallet/` (layout switcher, `pages/settings` CRUD + upgrade/rescan), desktop `features/auth/pages/wallet-select` + `features/settings`.
