# BTCX Infrastructure Migration Plan

*Created 2026-07-09. Owner: Johnny. Status tracking: check boxes per gate.*

Goal: move from per-app silos to a shared component architecture, delivering the
killer product — **one-click Android wallet + mining (off-store APK)** — plus
wallet-only Android/iOS flavors, with one maintained wallet stack across all apps.

## Naming convention (decided 2026-07-09)

Three tiers:

1. **`pocx*` — consensus framework, chain-family-agnostic.** Proof-of-capacity
   plotting/mining/deadline math: `pocx_miner`, `pocx_plotter`, `pocx_address`,
   plot format. PoCX could in principle sit on non-Bitcoin bases, so nothing
   Bitcoin-family carries the pocx name.
2. **`<thing>-btcx` — Bitcoin-family infrastructure for the BTCX chain** (suffix
   pattern, matching `electrs-btcx` / `bindex-btcx`): `params-btcx`, `keys-btcx`,
   `electrum-btcx`, `wallet-btcx`, repo `btcx`. Family and instance collapse:
   BTCX is the only bitcoin-pocx chain. `wallet-btcx` also speaks vanilla BTC
   (swap counterparty) via the registry.
3. **Frozen legacy (never rename):** bech32 HRP `pocx`, SLIP-44 value
   `0x504F4358`, Android applicationId `org.pocx.phoenix`, `bitcoin-pocx` node
   repo, network magic. In prose: bare "PoCX" only for the framework; the chain
   is "Bitcoin PoCX" or "BTCX".

## Target state

- **`btcx`** (new workspace repo): `params-btcx` (chain constants, registry,
  header hashing, address encode/parse), `keys-btcx` (BIP39/descriptors, coin
  type `0x504F4358` = 1347371864), `seedstore` (scrypt+ChaCha passphrase;
  keyring behind desktop feature; Android Keystore later), `electrum-btcx`
  (connection manager: server list/failover, scripthash subs, PoCX header
  hashing, BDK sync worker), `wallet-btcx` (BDK v2 wallet: send/receive/history/
  RBF/sweep/PSBT, sqlite; swap primitives behind `swap-support` feature).
- **trading repo (Satchel/pact)**: libswap keeps only swap logic (HTLC, MuSig2,
  pact-proto, Nostr), consumes btcx via git dependency.
- **Phoenix**: desktop unchanged (Core-RPC wallet); Android gains the nodeless
  stack via ~10 Tauri commands + slim mobile wallet UI; mining-only mode becomes
  mobile mode (wallet + mining).
- **electrs-btcx**: 2–3 public instances beside pool nodes; server list shipped
  in apps (user-overridable).
- SLIP-44: PR https://github.com/satoshilabs/slips/pull/2033 (BTCX / 1347371864).

## Per-app bill of materials

| Component | Phoenix Desktop | Phoenix Mobile | Wallet-only (Android/iOS) | Satchel | pactd/cli |
|---|---|---|---|---|---|
| params-btcx / keys-btcx / seedstore | later | yes | yes | yes | yes |
| electrum-btcx / wallet-btcx | later (nodeless mode) | yes | yes | yes (swap-support) | yes (swap-support) |
| libswap (swaps) | — | later | later | yes | yes |
| pocx_miner / pocx_plotter | yes | yes | — | — | — |
| Managed node + TS Core-RPC + full wallet UI | yes | — | — | — | — |
| Slim mobile wallet UI (new, ~4 screens) | — | yes | yes | — | — |
| Android plugins (foreground-service, storage) | — | yes | Android only | — | — |

## Phases and gates

### Phase 0 — Decisions & groundwork (mostly done)
- [x] Strategy: integrate into Phoenix, no spinoff
- [x] Coin type 0x504F4358 official; SLIP-44 PR #2033 submitted (watch for merge)
- [x] Naming convention (above); electrs-btcx + bindex-btcx renamed
- [ ] **P2TR acceptance check**: pools, esplora-pocx, node handle taproot
      addresses cleanly (Satchel wallet is P2TR-only). Do before Phase 3.
- [ ] Pick trading-repo freeze commit for extraction (after a stable rc tag)

### Phase 1 — Extraction: btcx ← DONE 2026-07-09 except owner merge
- [x] Workspace github.com/PoC-Consortium/btcx (5 crates, 47 tests, CI green
      ubuntu+windows, merged f1e2168); dual DescriptorKind Bip84/Bip86.
      FINAL descriptor policy: Phoenix mobile = BIP-84 (mining account_id
      is a 20-byte v0 program, non-negotiable for one-click); Satchel
      nodeless = BIP-86 taproot (owner preference; live BTC/LTC BIP-86
      stores exist). Satchel #142 (brief Bip84 flip) reverted in #143
      before any Bip84 store was created.
- [ ] **Owner merge: satchel PR #141** (consumption; −5,155/+310 in libswap;
      4/4 CI checks; E2E green locally: 20 swap + adaptor + 4 nodeless
      scenarios). Review notes in the PR: renames adopted at call sites,
      PACT_DISABLE_KEYRING in unit tests, seed error strings reworded.
- Note for Phase 2: nodeless stack needs a node with the blockpart REST
  endpoint (v31+, bitcoin PR #33657) — pool nodes must run that.
Move from `trading/pact/libswap` into workspace crates, renaming as they land
(`POCX_MAINNET`→`BTCX_MAINNET`, `COIN_POCX`→`COIN_BTCX`; values unchanged):

| Crate | Source (libswap) |
|---|---|
| params-btcx | params.rs, registry.rs (+ address encode/parse) |
| keys-btcx | keys.rs (BIP-86 wallet paths; m/7228' pact purpose stays in libswap) |
| seedstore | store.rs |
| electrum-btcx | Electrum half of chain.rs + wallet_worker.rs |
| wallet-btcx | wallet_bdk.rs; swap primitives behind `swap-support` feature |

Existing ~150 unit tests move with the code. Work happens on branches /
worktrees, never on master / the user's working tree.

**Gate M1:** trading repo consumes btcx as git dep; libswap contains only
swap logic; all unit tests + regtest swap E2E harness pass; a Satchel rc built
from it behaves identically.

### Phase 2 — Public Electrum infrastructure (~1 week, parallel to Phase 1)
- [x] First release tagged: v0.11.1-btcx.1 (release workflow builds
      electrs-btcx-* for linux x86_64/aarch64 gnu+musl and windows)
- [x] Full stack validated locally on regtest (2026-07-09): v31
      pocx-bitcoind (from satchel harness bin) + electrs-btcx from HEAD;
      check-node PASS, Electrum server.version/headers/scripthash-balance
      all correct. Stack left running: REST :18443, Electrum :60401.
      PoCX regtest mining needs setmocktime before generatetoaddress.
- [ ] Johnny: deploy 2–3 public instances beside pool nodes (nodes must be
      v31+ for /rest/blockpart) — may take a while; local stack unblocks
      Phase 3/4 meanwhile
- [ ] Server-list format shipped in apps (with user-editable custom server)

**Gate M2:** phone on mobile data queries scripthash balance/history from 2+
public servers; instances hold tip sync for a week.

### Phase 3 — Phoenix wallet backend — IMPLEMENTED 2026-07-09, PR #112 open
- [x] `src-tauri/src/btcx_wallet/` (config/state/manager/commands), 16 Tauri
      commands + `btcx-wallet:sync` event; btcx crates as git deps @ f1e2168
- [x] BIP-84/BTCX for new wallets; restore probes [84/BTCX, 86/BTCX, 84/0',
      86/0'] via batched Electrum scripthash histories (20 spks < STOP_GAP);
      winning policy persisted per network
- [x] **Gate M3 regtest evidence**: live smoke — fresh seed → rpocx1q addr →
      sync vs local electrs → received 0.5 BTCX exact → sent 0.1 back over
      Electrum broadcast, balances/fees exact. 27 unit tests.
- [ ] Owner merge PR #112 (github.com/PoC-Consortium/phoenix-pocx/pull/112)
- [ ] Manual Android CI run on the branch before Phase 4 builds on it
      (rustls/aws-lc NDK toolchain is the one plausible snag)
- Mainnet half of M3 waits on Phase 2 public servers (mainnet server list
  defaults empty; custom URLs supported)
- NOTE: `vendor/bdk_chain/` patch (rusqlite bumped to libsqlite3-sys 0.30.1)
  resolves the links=sqlite3 conflict with tauri-plugin-sql/diesel —
  remember when bumping bdk
- Pre-existing broken test on master fixed (node config default-network
  test; CI never runs cargo test — consider adding it)

### Phase 4 — Mobile mode + slim wallet UI — IMPLEMENTED 2026-07-09, PR #113
- [x] Launch mode `mobile` on Android (wallet + mining bottom nav); desktop
      byte-identical; new mobileWalletGuard; mining stays default landing
- [x] `features/mobile-wallet/`: onboarding (create w/ 3-word verify,
      restore w/ probe-branch display), home/balance+sync, receive+QR,
      send (review step, fee presets+custom), history, settings (server
      editor, lock when encrypted). BtcxWalletService (signals, lazy init)
- [x] 56 `mwallet_*` keys × 26 locale files; no renames, sweep separate
- [x] Gates: prod build, lint, format, 39/39 tests, cargo clippy — clean.
      NOT verified: visual/interactive (owner live-iterates via tauri:dev)
- [ ] Owner review/merge PR #113; visual polish pass in tauri:dev
- [ ] Gate M4 proper: APK on a real phone, send/receive via servers (can
      test today against local regtest stack: settings → network regtest →
      server tcp://127.0.0.1:60401 — desktop dev build works too)
- [ ] PoCX→BTCX wording sweep (separate PR, after #113 to avoid conflicts)

**Gate M4:** APK on a real phone does send/receive/history via public servers.

### Phase 5 — One-click killer flow — MERGED 2026-07-09 (#115, f42501a)
- [x] "Use wallet address" live on mobile (BtcxWalletService.newAddress();
      one address per wizard session, persisted on save; burn bounded ≤20,
      all wallet-owned); locked→inline unlock; no seed→"Create wallet"
- [x] returnTo chaining /wallet/create ↔ /miner/setup (sanitized);
      first-run nudge in wizard + "mine to this wallet" card on wallet home;
      custom address stays first-class; configured miners unchanged
- [ ] **Gate M5 verification is the OWNER REVIEW**: fresh device → APK →
      create seed → mine to own key, zero pasting

### Phase 6 — Flavors & follow-ons
- [x] 6a MERGED (#116, c81477f): `wallet-only` cargo feature + `--wallet-only`
      CLI → wallet-mobile mode (future iOS/wallet-only app); desktop
      nodeless wallet behind default-OFF experimental settings toggle;
      **Electrum broadcast live in Transaction Builder** (chain-only, no
      seed/node needed; live regtest broadcast smoke passed); plotting-
      address guard in wizard saveAndStart
- [x] 6b: PoCX→BTCX UI wording sweep (merged #117)
- [x] 6c ADDENDUM — MERGED (#118, 37dcfce): FINAL derivation matrix —
      new desktop wallets at POCX type (all networks), desktop restore
      imports BOTH branch sets (legacy 0'/1' four purposes + POCX 84'/86')
      into Core with post-restore branch report; mobile probe hardened
      (depth 50 ext + 25 int, all-candidates, honest empty verdict with
      rescan retry); restore UX = **option A, Johnny 2026-07-09: NO
      checkbox** — silent scan of all branches, post-restore branch report;
      desktop pre-checks legacy branches via scantxoutset and imports them
      ONLY if they hold coins (active=false, so legacy drains via change
      into the POCX branch; fresh/mobile/Satchel/drained seeds get clean
      modern-only wallets). Accepted trade-off: drained-but-historied
      legacy branches aren't imported (no old-tx display).
      Satchel = separate island (86'/POCX, no bridging, by design). Rationale: coin-0 nodeless wallets would create PUBLIC
      on-chain cross-chain key linkage for seed reusers; desktop
      restore-both makes wrong-branch restores impossible without asking
      users derivation questions.
- [ ] Core (bitcoin-pocx) new-wallet derivation → POCX type, baked into
      **v31** (owner decision; v31 = the single modern-BTCX line, same as
      the /rest/blockpart requirement): issue bitcoin-pocx#9
- [ ] iOS build — BLOCKED on macOS/Xcode hardware (Tauri iOS requires it);
      the wallet-only flavor is the iOS app minus scaffolding
- [ ] Handbook/docs wording sweep (out of 6b scope)
- [ ] **Mobile multi-wallet (round 3, Johnny 2026-07-10: GO)** — supersedes
      sweep-on-restore as the multi-branch answer. UI-only feature: the
      #119 named-wallet backend (list/select/close/delete, per-name dirs,
      one-open-at-a-time) is already there; mobile just stops hiding it.
      Desktop-parity UX (always check Phoenix desktop for look&feel):
      wallet switcher on home header like desktop's selector; create =
      optional name + BIP-84 default with taproot advanced choice; restore
      with multi-branch probe hits offers "create both wallets" (same
      mnemonic, 84' + 86' as two named wallets — complete modern-descriptor
      coverage; only 84/86 exist beyond legacy). Delete UI: inherit
      whatever desktop decides (btcx_wallet_delete is trash-based, desktop
      UI undecided). Sweep-on-restore demoted to optional later convenience.
- [ ] **Watch-only wallets (nodeless)** — future feature (Johnny 2026-07-11):
      xpub-descriptor wallets in the btcx stack. v1 descriptor import
      deliberately rejects them; v2 needs: watch-only source variant, send/
      sign/assignment gating across mobile + desktop remote (capability
      seam), receive/balance/history work as-is, PSBT flows become the
      spend path (build unsigned → sign elsewhere). Scope notes in the
      descriptor-import PR report.
- [ ] libswap on mobile (phone swaps) — parked post-review

**Gate M5 (= the product):** factory-reset phone → installing APK → mining to a
self-held key in under ~5 minutes, zero address pasting. Ship + announce.

## Dependency graph

```
P0 ──► P1 extraction ──► P3 phoenix backend ──► P4 mobile UI ──► P5 one-click ──► P6
 └────► P2 electrs deploy ───────┘ (M3 needs M2 servers)      (P4 UI mockable in P3)
```

Critical path P1→P3→P4→P5, ~4–6 focused weeks. P2 fully parallel.

## Frozen-decisions register (early choices that are expensive/impossible to move)

Write every new one down HERE at the moment it's made. Lesson of 2026-07-09:
the coin-type-0 mnemonic era (caught, remediated via restore-both + v31 Core
switch) and the #142 near-miss (doc said "never shipped", disk said
otherwise — verify reality, not intent).

| Decision | Frozen level | Cost / status |
|---|---|---|
| Mining identity = 20-byte v0 account_id | consensus | permanent; v0 is a fine answer; taproot-native mining would be a fork |
| bech32 HRP `pocx` (coin ticker BTCX) | consensus | cosmetic forever |
| Genesis/magic/ports | consensus | none |
| Coin type 0' mnemonics (pre-v31 Phoenix desktop) | user backups | remediated: restore-both w/ scantxoutset pre-check; Core→POCX in v31 (#9) |
| SLIP-44 0x504F4358 (name says POCX, coin says BTCX) | registry | cosmetic |
| org.pocx.phoenix applicationId | app identity | rename = new app; never touch |
| Electrum client string "satchel" (electrum-btcx) | wire habit | fix before public servers (make per-app) |
| Nodeless testnet wallets at POCX type (not 1') | convention | HW-testnet footnote; deliberate uniformity |
| Wallet DB `<coin>.sqlite` (no kind in name) | file layout | migration only if dual-instance ever revived |
| PACTSEEDv1/v2 seed format | file format | versioned by design — the good example |
| Satchel pact purpose m/7228' | derivation | unregistered purpose; collision risk negligible |

## Risks
1. **Extraction vs trading-repo velocity** (top risk) → freeze commit + gate M1
   requires swap E2E green before anything builds on the crates.
2. **P2TR acceptance** → checked in P0 before it can poison downstream.
3. **Electrum server privacy** (server sees scripthashes) → accepted v1;
   distinct coin type kills cross-chain linkage; custom-server override.
4. **No Android Keystore v1** → passphrase-scrypt shippable; keystore is an
   upgrade, not a redesign.
