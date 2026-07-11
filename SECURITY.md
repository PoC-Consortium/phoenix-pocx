# Security Model — Phoenix PoCX Wallet

This document describes the wallet's threat model and the guarantees it does
and does not make. It is intended to be factual: read it before trusting the
wallet with meaningful funds.

## Hot-wallet model (read this first)

Phoenix is a **hot wallet**. In nodeless / remote (Electrum) mode the signing
keys live on the same device as the UI and are derived from a locally stored
seed.

- **An unlocked wallet is spendable by anything that controls the UI.** While
  a wallet is open, the backend will build, sign, and broadcast transactions
  on request. A no-passphrase wallet is effectively always "unlocked": its
  seed is readable at rest (see below), so anything able to drive the
  application — a compromised webview, malware with your user's file access,
  someone at your unlocked device — can spend your funds.
- **A passphrase is strongly recommended.** A passphrase-encrypted seed
  (scrypt N=2^15, r=8, p=1 + ChaCha20-Poly1305, per-seed salt/nonce, AEAD,
  atomic write, fail-closed) is not readable while locked. Lock the wallet
  when you are not using it. The passphrase is the only thing standing between
  a compromised device and your funds.
- **There is no seed-export path.** No IPC command returns stored key material
  (seed, mnemonic, derived keys, or descriptors). This is deliberate: it means
  a compromised webview cannot *exfiltrate* your seed — it can only *spend
  while the wallet is unlocked*. Do not add a seed-export IPC command without
  revisiting this model.

### Seed at rest, by platform

| Platform | No-passphrase seed at rest | With passphrase |
|----------|----------------------------|-----------------|
| Desktop (Win/mac/Linux) | Encrypted with an OS-keystore-held key | Passphrase-encrypted (AEAD) |
| Android | **Obfuscation only** — the unwrap key is in the app binary | Passphrase-encrypted (AEAD) |

On Android, a no-passphrase seed is **not** meaningfully encrypted at rest
(the key is recoverable from the shipped binary). Backing the Android
no-passphrase seed with the Android Keystore is the planned fix; until then,
**use a passphrase on Android** if the device is not otherwise trusted.

### Android backup exclusion

The seed and wallet database live in the app's private files. The release
builds ship with `android:allowBackup="false"` **and**
`android:dataExtractionRules` that exclude every app file from both the
Android 12+ cloud-backup and device-transfer paths, so wallet material cannot
leave the device through Google Auto Backup or device-to-device migration. CI
asserts these are present on every Android build (a template regression fails
the build rather than silently reshipping backups).

## Network / server trust

Electrum and Bitcoin Core RPC traffic goes through the **Rust backend**, never
the webview. The wallet treats remote servers as untrusted transport:

- **Chain verification.** Before a wallet syncs (on open) and before restore
  probing, the backend verifies the elected Electrum server serves the
  expected chain (genesis-hash match) and is **not pruned**. A pruned or
  wrong-chain server is rejected: on restore it fails hard (rather than
  reporting a funded seed as "fresh"), and on normal open it falls over to a
  healthy configured server, surfacing a connection error only when no server
  can be verified.
- **Fee sanity.** Fee-rate presets come from server estimates. A preset that
  resolves above a sane ceiling (200 sat/vB; this chain's floor is ~1 sat/vB)
  requires an explicit extra confirmation in the review step, so a faulty or
  hostile server cannot silently inflate the fee you pay. A hard cap in the
  signing crate is the backstop.
- **Known amplifier.** Accept-any-certificate TLS on Electrum connections
  turns "malicious server" into "any on-path network attacker". Prefer trusted
  servers on trusted networks.
- **Known limitation.** The wallet does not yet verify merkle-inclusion / PoW
  proofs for received transactions, so a lying server could fabricate a
  *confirmed receive* in the UI. This cannot cause outbound theft (spends are
  signed locally and validated before broadcast), but do not treat an
  unconfirmed-looking receive from an untrusted server as settled.

## Content Security Policy (CSP)

The desktop app is a Tauri 2 webview that loads **only bundled local assets**
and communicates with the Rust backend over Tauri IPC. It makes **no requests
to remote web origins** — all Electrum and RPC traffic is initiated by Rust,
not the webview.

The Tauri CSP (`web-wallet/src-tauri/tauri.conf.json` → `app.security.csp`) is
currently unset (`null`). Tauri v2 injects IPC-specific allowances only into a
non-null policy; a from-scratch CSP that omits the `ipc:` /
`http://ipc.localhost` connect-src origins (or that sets a restrictive
`default-src` without them) **breaks backend IPC** — the app stops
functioning. A prior tightening attempt hit exactly this failure.

Because that risk cannot be validated without an on-device Tauri run,
**tightening the CSP is deferred to on-device verification** rather than
shipped blind. When it is done, it must be **additive and IPC-safe**: keep the
IPC connect-src origins Tauri needs, and prefer directives that do not touch
the script/connect/style paths the app relies on (e.g. `object-src 'none'`,
`base-uri 'self'`, `frame-ancestors 'none'`), each verified against a real
production build with working IPC before merge.

## Reporting

Report suspected vulnerabilities privately to the maintainer rather than via a
public issue.
