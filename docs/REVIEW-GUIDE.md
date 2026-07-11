# BTCX Migration — Review Guide (P1–P6)

*Prepared 2026-07-09. Everything below is merged to master (or noted otherwise).
This review IS gate M5: if the phone walkthrough works, the killer product
exists.*

## What was shipped today

| Piece | Where | State |
|---|---|---|
| SLIP-44 coin type 1347371864 (BTCX) | satoshilabs/slips#2033 | submitted, awaiting upstream |
| electrs-btcx + bindex-btcx (renamed, CI fixed, wording) | own repos | merged, release v0.11.1-btcx.1 published (10 artifacts) |
| `btcx` workspace (params/keys/seedstore/electrum/wallet) | github.com/PoC-Consortium/btcx @ f1e2168 | merged, 47 tests, CI ubuntu+windows |
| Satchel on btcx crates (−5,203 LOC) + BIP-84 default | satchel#141, #142 | merged, full E2E green (20 swap + adaptor + 4 nodeless) |
| Phoenix nodeless wallet backend (16 commands) | phoenix#112 | merged; live regtest send/receive proven |
| Mobile mode + wallet UI (6 screens, 26 locales) | phoenix#113 | merged |
| One-click wallet→mining flow | phoenix#115 | merged |
| Wallet-only flavor, desktop nodeless, Electrum broadcast | phoenix#116 | merged; live broadcast smoke proven |
| BTCX wording sweep (UI) | phoenix#117 | merged |
| APK artifact rename (Miner dropped) | phoenix#114 | merged |

Local test rig still running (throwaway, safe to kill):
- regtest pocx-bitcoind: REST/RPC 127.0.0.1:18443 (cookie in
  `electrum\electrs\testkit\regtest-data\regtest\.cookie`), miner wallet funded
- electrs (hidden window): tcp://127.0.0.1:60401, logs at
  `electrum\electrs\testkit\electrs-regtest.log`
- Regtest gotcha: `setmocktime(now)` before `generatetoaddress`, else forging
  stalls.

## Track A — Desktop walkthrough (30 min, `npm run tauri:dev` on master)

1. **Regression first (most important):** normal desktop launch → your usual
   wallet + node + mining flows. Desktop code paths are claimed byte-identical;
   verify nothing feels different. The nodeless toggle is default-OFF.
2. **Desktop nodeless = your remote node mode (#119)** — the #116
   experimental toggle was superseded by your own work; the full desktop
   pages now run over the WalletBackend seam. Review your remote mode per
   its own session's notes (memory: project-remote-electrum-mode — open
   gaps listed there: send/assignment cross-check, PSBT advanced options
   error in remote, delete-wallet UI undecided). Regtest rig usable:
   server `tcp://127.0.0.1:60401`, fund via miner wallet on :18443.
3. **Electrum broadcast (Transaction Builder):** with ≥1 server configured,
   the formerly-disabled Electrum radio is selectable. Build a PSBT, sign,
   broadcast via Electrum — no node wallet needed. With no server configured
   it stays disabled with an updated hint.
4. **Restore probing:** restore a legacy Phoenix desktop seed (coin-0) in the
   nodeless wallet — it should detect the legacy branch and report which one
   (84'/86' × BTCX/0'). This is the least-live-tested path: probe logic is
   unit-tested, but no real legacy history existed on regtest.
5. **Wallet-only flavor preview:** relaunch with `--wallet-only` → app lands
   on /wallet, no mining/node anywhere. This is what iOS will be.
6. **Wizard save (gate REMOVED per your decision, PR #120):** saving with an
   arbitrary/foreign plotting address must be ACCEPTED — plotting for
   others is a supported flow. No validation on save anymore.
7. **Coin-type addendum (#118):** create a NEW desktop wallet → descriptors
   derive at `…/1347371864'/…` (84'+86' only; 44'/49' no longer generated
   for new seeds). Restore an OLD desktop seed → funds appear + branch
   report ("Funds found on: legacy desktop (84'/0')…"); restore a MOBILE
   seed on desktop → funds appear (the gap you spotted). No checkbox — your
   option A: legacy branches are silently pre-checked via scantxoutset and
   imported ONLY if they hold coins, inactive, so they drain via change.
   Note: on mainnet that pre-check adds a one-time UTXO-set scan (tens of
   seconds) to restores. On mobile: restore shows the explicit "no history —
   starting fresh" verdict with a working "Scan again" (reprobe) button;
   probe now checks 50+25 addresses on ALL branches and reports multi-branch
   hits. Full matrix: desktop new = POCX, mobile = 84'/POCX, Satchel =
   86'/POCX separate island (no scanning, per-coin registry types — its BTC
   wallet at 86'/0' is correct, that IS Bitcoin), Core internals = POCX from
   v31 (bitcoin-pocx#9). Eyeball items from the PR: reprobe deletes the
   fresh-default sqlite when switching branches (guarded); desktop restore
   ends on an in-card success panel now.

## Track B — Phone walkthrough (the M5 script)

APK: run "Android Build (Test)" artifacts from master (triggered after #117
merged — artifact `Phoenix-PoCX-Android-ARM64-test`).

1. Fresh install (or clear app data) → app launches in **mobile mode**:
   Mining | Wallet bottom nav, mining is the landing tab.
2. Mining setup wizard → address step → "Use wallet address" now live:
   with no seed it offers **Create wallet** → onboarding (write down 12 words,
   confirm 3, optional passphrase) → returns to the wizard → address
   auto-selected and filled. **Zero pasting. That's the product.**
3. Wallet tab: for server config on a phone, the regtest electrs must be
   reachable over LAN — it currently binds 127.0.0.1 only; ask and I rebind
   to 0.0.0.0 (or test mainnet once your public servers exist).
4. Time it: fresh install → mining to self-held key. Target < 5 min.
5. Also check: existing-user path — an installation with mining already
   configured must see zero changes to its flow.

## Track C — Satchel smoke (15 min; refactor was E2E-verified, this is belt+braces)

Satchel master (`26f9fe5`) now builds libswap on the btcx crates (−5,203 LOC)
and defaults the (still unused) nodeless wallet to BIP-84. All swap E2E suites
passed post-refactor; what automation can't judge:

1. Build and launch the Satchel app from master; **unlock your real seed** —
   the seed-store internals moved to the `seedstore` crate and some error
   strings changed ("create or import one first" instead of "run `pact init`
   first"); make sure unlock/passphrase behavior feels identical.
2. **Your live BTC/LTC nodeless wallets** (btc.sqlite / ltc.sqlite, BIP-86):
   after #143 they open exactly as before — verify balances/history render
   and a sync completes. (#142 had flipped the default to BIP-84 on the
   wrong premise that no wallet stores existed — it would have refused to
   open yours with a descriptor-mismatch error; caught during this review
   prep and reverted outright in #143 before any BIP-84 store was created.
   Taproot stays the Satchel default per your decision; Phoenix mobile keeps
   BIP-84 because mining account ids are 20-byte v0 witness programs.)
3. Board loads, offers render, server-health indicators live — the Electrum
   connection manager now comes from `electrum-btcx` (same code, new home).
4. If you have a small mainnet swap planned anyway, do it on the new build
   rather than the old one — that's the ultimate consumption test. Otherwise
   a regtest swap via the harness/playground is equivalent coverage to what
   CI already proved.
5. NOT changed and needs no testing: swap protocols, keys/derivation for the
   pact tree (m/7228'), Nostr transport, Core-RPC node mode.

## Collected judgment calls & flagged risks (from all phase reports)

1. **`vendor/bdk_chain/` patch** in phoenix (rusqlite req bumped for the
   links=sqlite3 conflict with tauri-plugin-sql/diesel). Works; must be
   remembered on every future bdk upgrade.
2. **Address handout in the wizard**: one `newAddress()` per wizard session,
   persisted on save; repeated pre-save visits reveal ≤20 addresses (all
   wallet-owned, then recycling). After save, the address shows under the
   "Custom address" radio on revisit (desktop-precedent behavior) — eyeball
   the UX.
3. **Non-English translations** of ~70 new keys (56 mwallet_ + setup_/psbt_
   additions) are model-written following each locale's terminology — native
   skim recommended (de especially, since you'll read it anyway).
4. **Electrum broadcast error classification** rests on a `tip()` probe; a
   server dying mid-broadcast reads as "rejected" with a transport message.
5. **Seed error strings** in Satchel changed slightly with seedstore
   (e.g. no more "run `pact init` first").
6. **`PACT_DISABLE_KEYRING=1`** added to libswap unit-test env so Windows test
   runs don't write real Credential Manager entries.
7. Phoenix CI **doesn't run `cargo test`** (a broken test on master proved it);
   #112 fixed the test — consider adding the job.
8. Wallet-only mode leaves `/settings` URL-reachable (unlinked) — matches
   existing mobile behavior, left alone.
9. The Electrum `server.version` client string is still `"satchel"` (wire
   value, lives in electrum-btcx) — make it per-app before public servers
   log meaningful stats.
10. Restore-probe against REAL legacy on-chain history never ran live (see
    Track A #4).

## Deliberately NOT done (post-review queue)

- **Public electrs instances** — yours (nodes need v31+ for /rest/blockpart;
  note: your managed mainnet node already runs `-rest`). Then: ship default
  server list (btcx-params or app config), enforce/encourage ≥2 servers.
- **iOS** — requires macOS/Xcode (Tauri iOS); the wallet-only flavor is the
  app, scaffolding is config work on a Mac.
- **Handbook/docs wording sweep** (6b covered app UI only).
- **Swaps on mobile** (libswap link) — parked.
- **SLIP-44 #2033** — watch for maintainer feedback.
- Android Keystore seed wrap (passphrase-scrypt shipped for v1).

## If review finds problems

Each phase is a separate squash commit on phoenix master (#112–#117), so
targeted fixes are easy; the btcx crates are tagged by rev (f1e2168) and the
extraction is bisectable per-crate. File issues or just list findings — the
session memory carries full context for follow-up sessions.
