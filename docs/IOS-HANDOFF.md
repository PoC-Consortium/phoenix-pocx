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

**Done in the 2026-07-17 Mac session (all verify gates green):**
1. ~~`get_launch_mode()` iOS branch~~ — DONE: iOS hard-returns
   `"wallet-mobile"` (no cargo feature needed). Also added: `get_platform()`
   returns `"ios"`, `app_data_dir()` iOS branch (sandbox
   `dirs::data_dir()`), and the three "desktop only" `not(android)` gates
   (menu creation, window title, `on_menu_event`) corrected to
   `#[cfg(desktop)]` so they don't fire on iOS.
2. ~~`tauri ios init`~~ — DONE: `gen/apple/phoenix-pocx.xcodeproj`
   generates cleanly (gen/ is gitignored, regenerate-fresh model like
   Android). Init writes the DEFAULT Tauri icons into `Assets.xcassets` —
   the phoenix icon set is committed in `src-tauri/ios-icons/` (generated
   via `npx tauri icon` from `icons/icon.png`) and must be copied into
   `gen/apple/Assets.xcassets/AppIcon.appiconset/` after every init; the
   CI workflow does this (same pattern as `android-icons/`).
   Note: init works WITHOUT Xcode; only compiling needs it.
3. ~~iOS `#[cfg]` audit~~ — DONE: Android plugins were already scoped to
   the Android Cargo target block (not deps on iOS); added an iOS target
   block with rustls-tls reqwest mirroring Android; frontend
   `PlatformService` gained `'ios'`/`isIos`/`isMobile`,
   `AppModeService.isMobile` now set for iOS, `platform-ios` body class +
   safe-area CSS (top inset shared with Android, bottom inset for the home
   indicator). electrum-btcx TLS on the actual iOS target is UNVERIFIED
   until the first Xcode compile.
4. `.github/workflows/ios-build-test.yml` — unsigned simulator build on a
   macOS runner (no Apple account needed), mirroring android-build-test.

**2026-07-18: THE SIMULATOR MILESTONE IS DONE.** The wallet boots on the
iPhone 17 Pro simulator (iOS 26.5) in wallet-mobile mode. The working
build recipe (also what the CI workflow runs):
`npx tauri ios build --debug --target aarch64-sim` → .app lands in
`src-tauri/gen/apple/build/arm64-sim/`; install/launch/screenshot via
`xcrun simctl install/launch/io`. Do NOT invoke xcodebuild directly — the
Xcode project's Rust build phase needs the Tauri CLI's build server and
dies with a missing `*-server-addr` file otherwise.
`pocx_plotfile` Apple fix upstreamed: PoC-Consortium/pocx#76 — once
merged+released, drop `vendor/pocx_plotfile` and the `[patch.crates-io]`
entry.

**Still open:**
1. Exercise the wallet flows on iOS (create/restore against Electrum,
   send/receive) — only the boot is verified so far.
2. Personal-iPhone sideload (free Apple ID) — next ladder rung.
3. Identity decisions (below) — needed before a real bundle.
4. Store-phase: App Store icon must have NO alpha channel (current icons
   are transparent PNGs — flatten onto a background for the 1024 marketing
   icon when that time comes).

## Xcode 26 simulator-runtime gotchas (2026-07-18 session)

- Building from the Xcode GUI (needed for physical-device deploys with a
  Personal Team): the "Build Rust Code" phase fails with `npm: command
  not found` because GUI Xcode doesn't inherit the shell PATH. Fix
  applied to the generated project (gen/apple project.yml + pbxproj):
  prepend `export PATH="/opt/homebrew/bin:$PATH"; ` to the script. Must
  be re-applied after a fresh `tauri ios init` (gen/ is not committed).
- Device dev-run recipe: `npx tauri ios dev --open --host <mac-lan-ip>
  --config '{"build":{"beforeDevCommand":"npm run start -- --host
  0.0.0.0"}}'` (ng serve binds localhost only by default and tauri waits
  forever on the LAN URL), then select Personal Team under Signing &
  Capabilities and hit Run.

- Xcode 26.6 ships SDK 26.5.1 (23F81a) but the ONLY downloadable iOS 26.5
  simulator runtime is build **23F77** — that mismatch is fine; do not try
  `-buildVersion 23F81a` (Apple: "not available for download").
- Don't run `xcodebuild -downloadPlatform iOS` while Xcode's UI Components
  download is also running — the second registration errors with
  "Duplicate of <uuid>" and can leave the runtime unregistered.
- If `simctl runtime list` shows the image Ready but `simctl list
  runtimes` is empty: run `xcrun simctl runtime scan-and-mount`. Do NOT
  kill CoreSimulatorService or delete the image (deleting also purges the
  8.5 GB asset and forces a full re-download).
- `pocx_plotfile 1.0.5` doesn't compile for iOS (`O_DIRECT` gated on
  "not macOS" instead of "not Apple") — vendored fixed copy at
  `src-tauri/vendor/pocx_plotfile` via `[patch.crates-io]`; upstream the
  `target_vendor = "apple"` gates to the pocx crates, then drop the vendor
  copy.

## Mac machine state (as of 2026-07-17)

Installed: rustup targets `aarch64-apple-ios` + `aarch64-apple-ios-sim`,
CocoaPods 1.17 (brew), mas, libimobiledevice, npm deps, generated
`gen/apple`. **NOT installed: Xcode** — only Command Line Tools are
present, so there is no iOS SDK and nothing can compile yet. Install it
with `mas install 497799835` (needs sudo + App Store sign-in) or from the
App Store app, then:
`sudo xcode-select -s /Applications/Xcode.app` ·
`sudo xcodebuild -license accept` · `xcodebuild -runFirstLaunch` (installs
the iOS platform/simulators; or Xcode ▸ Settings ▸ Components). Then
`cd web-wallet && npx tauri ios dev` boots the Simulator.

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
