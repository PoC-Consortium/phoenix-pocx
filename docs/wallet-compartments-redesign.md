# Wallet Compartments Redesign

**Status:** IMPLEMENTED (all phases) 2026-07-16 — pending live verification against regtest/electrs
**Date:** 2026-07-15 (v1), 2026-07-16 (v2 — scoped down after review)
**Scope:** Nodeless / remote (BDK + Electrum) wallet model only — desktop **and** mobile. Core-managed/external node mode is out of scope.

---

## Problem

Today, one named remote-mode wallet = one `DescriptorPolicy { kind, coin_type }` = one BDK store. The other derivation branches of the same seed surface as **separate top-level sibling wallets** (`-v31`, `-v30`) with a thicket of supporting UI: "Upgrade to v31", coin-type badges, and the restore-time create-both prompt. The segwit/taproot × v30/v31 story reads as a mess in the wallet selector.

## Key realization

The sibling wallets **already exist**. Restore-probing already enumerates exactly the four branches (`manager.rs` `probe_candidates` — store-less, one batched Electrum `histories` call per branch); `migrate_v30` already creates a `-v31` sibling over the same seed; `rescan_legacy` already creates a `-v30` counterpart. So this redesign is **a structured display of the wallet selector** — grouping + deleting friction. Not new wallet machinery.

## Model

A **compartment is an ordinary individual wallet.** Nothing about the open-wallet experience changes: home/balance, Send, Receive, History, Coins, and Assignments all stay scoped to the single open wallet exactly as today. There is **no cross-compartment spending, no merged history, and no summed balance anywhere in the app** — with one exception: the **wallet selector**, the screen where the user picks a compartment, shows the group's per-compartment balances and their sum.

One **WalletName** = one seed = a **group**, rendered as one collapsible row in the selector. Opening it reveals up to four **compartments** ("pockets"):

| | SegWit (BIP84) | Taproot (BIP86) |
|---|---|---|
| **Current** (coin `0x504F4358`) | `sw` | `tr` |
| **Legacy / v30** (coin `0'`) | `sw` · v30 | `tr` · v30 |

**Network-aware:** mainnet has up to 4 compartments; **testnet/regtest have only 2** — coin type is `1'` for both eras there, so the v30/v31 axis collapses. The UI must not render 4 empty pockets on testnet.

"Legacy" = the old **derivation era** (coin type `0'`), still segwit/taproot scripts — not old *address types*. True `pkh` / `sh(wpkh)` legacy only arrives via descriptor **import**; those wallets have no seed and stay single-compartment (a singleton group = a plain row, visually identical to today).

## Decisions

1. **Grouping — explicit `group` field, maintained in tandem. No xpub/seed fingerprinting.**
   `WalletMeta` gains `group: String`. Migration is easy in practice: **users today have a single wallet per mnemonic**, so nearly every wallet becomes a singleton group (`group` = own name). The only folding needed is for the few who ran upgrade/rescan and hold machine-generated suffix pairs (`<base>` / `<base>-v31` / `<base>-v30`, incl. the `-2`,`-3` collision tails); anything else stays a singleton. From then on the field is authoritative — no name parsing ever again. **Rename and delete operate on the whole group** (tandem): renaming a group renames all its compartments' display identity; deleting a group trashes all compartment dirs. There are no per-compartment rename/delete operations. This keeps unrelated same-named seeds from ever being co-grouped, without reading xpubs.
2. **Sync model — balance snapshots + one-shot sync, selector-only.** The open wallet is always live (unchanged single-runtime model). Each compartment gets a persisted `balance_snapshot: Option<{ sat, height, at }>` in `WalletMeta`, written (a) by the sync emitter for the live compartment on each `btcx-wallet:sync`, and (b) by a sequential one-shot sync of the group's other materialized compartments when the group is expanded in the selector. **No changes to the pinned `btcx` crates.** Snapshots exist purely to paint the selector; nothing else consumes them.
3. **Visibility — current SegWit + Taproot always; a v30 pocket only when materialized (i.e. funded when last checked).** Most users see 2 pockets; in a year, new users never see v30 at all. There is **no automatic legacy probing** — late-arriving v30 funds (old published addresses, pool payouts to a v30 forging address) are discovered via the retained manual rescan (see Rules).
4. **Terminology — v30 = legacy (coin `0'`), v31 = current (BTCX `0x504F4358`). No v32.** Current pockets shown as plain "SegWit"/"Taproot"; old-era pockets tagged "v30". Unify the badge key (desktop currently says "v30", mobile says "legacy" — one key, one text).

## Rules

- **Open-wallet surfaces are untouched.** Home shows the open compartment's balance (with today's spendable/pending/immature breakdown); Send spends its UTXOs; Receive derives its addresses; History/Coins show its data. No scope labels needed because scope never changes.
- **Selector:** tapping a group expands the compartment strip (snapshot balances + Σ header, per-pocket "as of" staleness from `snapshot.at`, non-blocking spinners while the one-shot sync refreshes). Tapping a compartment opens it (runtime switch, as today). Opening a group cold (e.g. after restore) defaults to the **current SegWit** compartment; thereafter, last-active per group.
- **Receive** is hidden inside v30 compartments — **v30 pockets are spend-only.** "Recover old funds" becomes: selector → v30 pocket → Send. (A prefilled "move to SegWit" self-send helper is a possible later nicety, not in scope.)
- **Legacy discovery stays manual:** the "Check for older (v30) funds" danger-zone card is **kept** (settings, as today), repurposed — a hit now materializes the v30 compartment(s) *inside the group* instead of creating a loose top-level sibling. Run rarely, by choice; no background probing.
- **Assignments** stay gated to segwit compartments (a plot account is a segwit-v0 witness program) — no coin-type gate: any segwit pocket (current or v30) can create/revoke, exactly as today. Empty-state copy must say "switch to the SegWit pocket" (not "wallet"), ideally with a one-tap switch.
- **Descriptor-imported / single-address** wallets are singleton groups and render as a normal single row.
- New-wallet creation must not collide with group naming: reject names that would land inside an existing group.

## What gets deleted / kept

**Deleted:** `btcx_wallet_migrate_v30`, the "Upgrade to v31" button/badge/dialog (remote path), the create-both / kind-choice prompt in restore, the per-row kind + v30 badges in the flat lists — all replaced by the compartment strip.

**Kept:** `btcx_wallet_rescan_legacy` (repurposed as above, still danger-zone, still manual). The Core-managed seed-reentry upgrade dialog (out of scope).

---

## Implementation plan

### Phase 1 — Backend: grouping + snapshots (Rust, one PR)

- `WalletMeta`: add `group: String` and `balance_snapshot: Option<{ sat, height, at }>`. Compartment role derives from the existing `policy` (kind × coin_type vs `btcx_coin_type(network)`).
- Sync emitter writes the snapshot for the live compartment on each `btcx-wallet:sync`.
- New `btcx_wallet_group_sync(group)` command: sequential one-shot sync of the group's other **materialized** compartments → persist snapshots → return the grouped summary (per-pocket + Σ). One-shot syncs open a temporary second `bdk::Wallet` against the compartment's existing sqlite (structurally unblocked; see risk notes for the locking rule).
- New `btcx_wallet_list_grouped` command (group rows + compartments + Σ, snapshot-sourced, no store opens). **The existing flat `btcx_wallet_list` stays untouched** until both UIs are migrated — Phase 1 must not break the current UI.
- Config migration: assign `group` per Decision 1 — trivially, since almost all wallets are singletons; fold only machine-suffix pairs. Idempotent and abort-safe, mirroring the existing layout migration. **Back up `btcx_wallet_config.json` first.** No directory renames.
- Group-tandem plumbing: rename/delete commands become group-scoped.
- Rust unit tests: migration (incl. ambiguous-name → singleton), grouping, snapshot math, group rename/delete.

### Phase 2 — Materialize instead of buttons (Rust)

- Create/restore registers the current SegWit + Taproot compartments in one group, plus any v30 pocket the probe found history on. (This also fixes the current desktop/mobile inconsistency — desktop create today never offers a kind choice.)
- Existing seed groups missing a current-era compartment (e.g. no taproot sibling): materialize it silently on the first occasion the seed is readable (open/unlock) — never prompt.
- `rescan_legacy` re-targeted: a hit materializes the v30 compartment inside the group.
- `migrate_v30` stays **fully functional** (not a no-op) until both UIs are off it — a button that fake-succeeds is worse than one that works. It is deleted in Phase 5.

### Phase 3 — Mobile UI (primary remote surface)

- Selector (settings card + toolbar switcher): one collapsible **group row** (name, Σ, lock/active markers) → **compartment strip** (SegWit + Taproot cards, snapshot balances + staleness, Σ header; v30 card only when materialized). Strip renders instantly from persisted snapshots; group-sync refreshes non-blocking.
- Toolbar switcher lists **groups only**; pocket switching lives in the strip. No two-level menus.
- SegWit card carries the "can receive mining rewards" hint (today buried in the create-flow radio).
- Delete: v30/kind badges, "Upgrade to v31" menu item, create-both prompt in restore. Keep: danger-zone rescan card.
- Assignment empty-state copy → pocket wording + one-tap switch.

### Phase 4 — Desktop remote UI

- Same grouping in wallet-select + settings `isRemote()` branches. Note: wallet-select is a shared mat-table (`status/name/balance/encryption/action`) fed by `walletManager.getWalletSummaries()` — remote grouping needs expandable rows or a remote-specific list; budget for it. Core-managed mode untouched.

### Phase 5 — Cleanup

- Delete `btcx_wallet_migrate_v30`, the flat-list dependency (if fully migrated), dead i18n keys; seed new locale keys (English fallback per convention).

### Implementation notes (as built, 2026-07-16)

- Compartment name suffixes: `-v31` (current SegWit sibling of a v30 group — the pre-existing convention the group migration recognizes), `-taproot`, `-v30`, `-taproot-v30`; collisions get `-2`… tails.
- Restore's PRIMARY compartment is always current-era (kind param defaults SegWit); legacy hits materialize as pockets — restore never opens a coin-0' branch as the primary anymore. Reprobe no longer branch-switches; it materializes and applies probe reach.
- `register_sibling_wallet` creates the sibling's bdk store UP FRONT (applying probe reach) so group sync can open it without the seed; it never touches the runtime or selection (no close/reopen churn on create/restore).
- Materialize-on-open runs from select/resume/reprobe/rescan; passphrase-encrypted seeds defer PERMANENTLY (a sibling can't inherit the wrap) — their groups stay as-is until a fresh restore.
- The flat `btcx_wallet_list` stays (still consumed for name lists); grouped consumers use `btcx_wallet_list_grouped`.
- Old-path `migrate_v30` deleted same-day (both UIs migrated in the same change-set — the "keep functional" transitional stage was never shipped).
- v30 badge: era badge (`wallet_legacy_badge` = "v30", coin type) is distinct from the kind badge (`mwallet_legacy_badge` = "legacy", imported pkh scripts) — both kept.
- **Live-review revisions (2026-07-16, superseding the Σ decision):** NO summed balance anywhere — a balance always names ONE pocket (the open/selected one live, others by snapshot). Desktop wallet-select: one row per group, stable name, a "Pocket" column with a radio-dropdown (selection while unloaded only arms Load; while loaded it switches immediately), single Load/Unload button. `walletManager` surfaces GROUP ids in remote mode (loaded list, summaries, active wallet); `loadWallet(group)` resolves to the last-selected pocket, `loadRemotePocket(name)` loads an exact one. Mobile group headers show no balance (pocket rows carry them). The grouped DTO's `totalSat`/`complete` remain but are display-unused.

## Risk notes

- Money-critical (seeds, balances) → Phase 1 ships behind unchanged behavior and is independently testable before any UI moves.
- **SQLite / Windows file-lock (PR #156 lesson):** a one-shot group-sync holds a compartment's sqlite open; a user tapping that compartment mid-sync would collide. Serialize `group_sync` and `open_runtime` behind one lock; group-sync skips/yields the compartment being opened. Never rename a live wallet's directory. *(Phase 1 finding: a closed wallet's SyncWorker can outlive `close_runtime` while blocked in a connect attempt, holding the sqlite for up to the OS connect timeout — rename/delete now wait on a weak-handle release marker, `wait_wallet_released`, before moving directories.)*
- Snapshot staleness only affects the *selector's* displayed numbers; the open wallet is always live, and spends always operate on a freshly-synced runtime. Stale pockets are marked ("as of …"), never silently summed as fresh; a materialized pocket with no snapshot yet renders the Σ as pending rather than under-reporting.
- Regrouping is a config rewrite (wallet dirs untouched) — reversible in principle, but back up `btcx_wallet_config.json` before the migration.
- Accepted trade-off: with no automatic legacy probing, v30 funds arriving *after* the last rescan stay invisible until the user runs the danger-zone check again. Deliberate — rescan is rare and user-paced.

---

## Reference: current implementation (as of planning)

- Registry: `web-wallet/src-tauri/src/btcx_wallet/config.rs` — `BtcxWalletConfig.wallets: net → name → WalletMeta`, `DescriptorPolicy { kind, coin_type }`, `DescriptorKindCfg` (Bip84/Bip86/Legacy). No seed/xpub identity in config; sibling linkage today is name-suffix only (`commands.rs` `base_name`/`counterpart_names`).
- Coin type: `params_btcx::registry::btcx_coin_type(network)` — mainnet `0x504F4358`, testnet/regtest `1'`. `keys_btcx::COIN_BTCX = 0x504F4358`.
- Runtime: `state.rs` — single `WalletRuntime` (BDK handle + `SyncWorker` + `btcx-wallet:sync` emitter), one open wallet at a time. Sync event carries height/health, **no balance** — UIs pull balances separately.
- Open / restore-probe: `manager.rs` — descriptor-explicit open; `probe_candidates` enumerates BIP84/BTCX, BIP86/BTCX, then (mainnet) BIP84/0', BIP86/0'; 75 spks per branch, one batched `histories` call, no temp stores.
- v30→v31 + rescan: `commands.rs` §375–710 — `migrate_v30_impl` (creates `-v31` sibling), `rescan_legacy_impl` (creates `-v30` counterpart). Neither moves funds. Assignment gate `ensure_segwit_wallet` checks `kind` only — unchanged by this redesign.
- Flat list: `btcx_wallet_list` returns per-wallet meta + `balance_sat` **only for the open wallet** (no store opens for others) — why snapshots are needed for the strip.
- Frontend service: `web-wallet/src/app/core/services/btcx-wallet.service.ts` — `wallets`, `descriptorPolicy`, `select`, `migrateV30`, `rescanLegacy`, `upgradeV30`, balance signal (single aggregate for the open wallet).
- UI: `features/mobile-wallet/` (layout switcher, `pages/settings` CRUD + upgrade/rescan), desktop `features/auth/pages/wallet-select` + `features/settings`. Badge keys today: `wallet_legacy_badge`="v30" (desktop) vs `mwallet_legacy_badge`="legacy" (mobile).
