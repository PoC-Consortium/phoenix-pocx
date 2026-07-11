# iOS Bring-Up Handoff

For a fresh Claude session on a **Mac** to take Phoenix from "wallet-ready"
to "running on iOS" and ultimately TestFlight. Written from the Windows dev
machine, so **this file (in the repo) is the source of truth** — the prior
sessions' auto-memory is machine-local and will NOT be present on the Mac.
Read `docs/MIGRATION-PLAN.md` and `CLAUDE.md` first for architecture.

## Current state (what's done vs not)

**Done and iOS-ready (no rewrite):**
- Whole app = Angular 21 + Rust via **Tauri 2** (targets iOS natively).
- **Wallet-only flavor** already exists: cargo feature `wallet-only` in
  `web-wallet/src-tauri/Cargo.toml`; on Android it makes `get_launch_mode()`
  return `"wallet-mobile"`. Desktop has a `--wallet-only` CLI flag too.
- The nodeless wallet stack (btcx crates, `src-tauri/src/btcx_wallet/`) is
  pure Rust + Electrum; no platform-specific wallet code.
- Mobile UI (`features/mobile-wallet/`) is responsive and touch-built.

**NOT started (this is the iOS work):**
1. `get_launch_mode()` in `src-tauri/src/lib.rs` (~line 253) has **no iOS
   branch** — it would fall through to DESKTOP mode. iOS must hard-return
   `"wallet-mobile"` (iOS = wallet-only always; no mining, Apple bans it and
   the plot/foreground machinery is Android-only). Add
   `#[cfg(target_os = "ios")]` returning `"wallet-mobile"`.
2. `tauri ios init` has never run — no Xcode project exists yet.
3. iOS `#[cfg]` audit: the Android-only plugins (`tauri-plugin-android-fs`,
   the custom `storage-permission` / `foreground-service` in
   `src-tauri/plugins/`) and Android deps must be excluded on iOS; check the
   `[target.'cfg(target_os=...)']` blocks in Cargo.toml mirror Android's
   pattern for iOS. rustls/TLS: same class of fix Android needed (electrum
   dials ssl); verify the TLS provider builds for the iOS target.
4. Identity decisions (below) — needed before a real bundle.

## The no-registration ladder (do this first, no Apple account needed)

1. **Simulator** — needs only Xcode (free Apple ID to download it):
   `npm ci` in web-wallet, then `npm run tauri ios init` (or
   `cargo tauri ios init`), then `cargo tauri ios dev` to boot in the iOS
   Simulator. Point wallet settings at the live server
   `ssl://electrs.bitcoin-po.cx:50002` (mainnet, baked default) or the
   owner's regtest over LAN. **This is the "it runs on iOS" milestone.**
2. **Personal iPhone** — sign into Xcode with any *free* Apple ID
   ("Personal Team" provisioning), `cargo tauri ios dev --host` onto the
   cabled device. Limits: install **expires after 7 days** (one redeploy
   resets), 3 sideloaded apps/device, no push entitlements (we use none).
   This gives the owner the app on a real iPhone with zero paid enrollment.

Everything above is achievable in one Mac session. TestFlight/store needs the
paid org account (below) and is a later, separate step.

## Verify gates (same as every phoenix change)
`npm run build` (prod), `npm run lint`, `npm run test:ci`; `cargo build`
(and for iOS, the target build via tauri). Do NOT touch the CSP in
tauri.conf.json — narrowing it breaks Tauri IPC (documented burn; see
SECURITY.md / memory). Mobile UI can't be driven headless — screenshot the
simulator instead.

## Pending identity decisions (ask the owner; needed before store, not before simulator)
- **Bundle ID**: proposal `org.pocx.wallet` (distinct from the miner's
  `org.pocx.phoenix` — must be installable alongside it; store identity is
  permanent).
- **Display name**: e.g. "BTCX Wallet".
- **App icon**: needs a source asset.
- These are shared with the Play wallet-only build — decide once for both.

## TestFlight / store phase (later; Apple-gated)
- **Apple Developer Program, ORG enrollment** — Apple rule 3.1.5: crypto
  wallet apps must be submitted by org-enrolled accounts, not individuals.
  Needs a D-U-N-S number for the legal entity (start early — days of Apple
  latency; the same D-U-N-S serves Google Play org enrollment).
- Interactive Xcode sign-in + an App Store Connect API key → automatable
  archive/export/upload. Add an `iOS Build` GitHub workflow (macOS runners)
  so later builds don't need the physical Mac.
- Store submission (review, screenshots, privacy — trivial for us: no data
  collection, seed never leaves device, no cloud backup) is its own step
  with Apple-review risk; TestFlight itself is low-drama.

## Data-safety / philosophy facts for any store form
- No data collection, no analytics, no cloud/backup of any kind (Android
  `allowBackup=false`; seed is the sole recovery path — owner's firm rule).
- Non-custodial; keys never leave the device.
