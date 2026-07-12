# Phoenix PoCX Wallet 2.1.0

The biggest release since 2.0: Phoenix now runs **without a local node**, and
**Android becomes a full wallet** — not just a miner.

## Headline features

### Remote (Electrum) mode — run without a full node
A third node mode alongside *managed* and *external*: **remote**. Phoenix
keeps a local wallet (BDK) and syncs over Electrum servers you configure — no
bitcoind required. Every desktop page works in this mode: send, receive,
history, fee control, and — client-side, needing no node — **forging
assignments** and the **Transaction Builder / PSBT** flow. Ships with a
default BTCX Electrum server so it works out of the box.

### Android: a full wallet, not just a miner
Android used to be mining-only. Now it's a complete wallet **plus** mining:
- **One-click mine-to-your-own-wallet**: create a wallet on first launch and
  the mining setup uses *your* address automatically — no more copy-pasting.
- Full send / receive / transaction history / contacts / forging assignments,
  in a Phoenix-styled mobile UI with a navigation drawer.
- Runs entirely nodeless over Electrum.

### Multiple named wallets
Create, name, switch, rename, and delete multiple wallets (desktop and
Android). Delete is trash-based and recoverable from your seed.

### More ways to get your wallet in
- **Create** — new wallets use a 24-word recovery phrase.
- **Restore** — checks segwit-v0 and taproot branches (and legacy paths) so
  funds are found wherever they are; offers to open both when a seed has
  history on more than one.
- **Import a descriptor** — paste one or two descriptors (`wpkh`/`tr`); the
  change branch is derived for you.
- **Import a `wpkh(WIF)` single-address wallet** — for vanity/plot addresses;
  change returns to the same address, and it can mine and assign.

### Registered coin type
BTCX now has a registered **SLIP-44 coin type (1347371864)**. New wallets
derive at it; restore still finds funds on older (coin-type-0) paths, so
existing seeds keep working with nothing to do.

## Security
- **Android backups disabled** — the seed can never reach Google Drive or a
  device-transfer; your recovery phrase is the sole backup.
- **Electrum server verification** — the wallet checks a server is on the
  right chain before trusting it, and refuses to sync history from a pruned
  server rather than falsely reporting a wallet as empty.
- **Abnormal-fee guard** — an extra confirmation if a server reports an
  unusually high fee.
- A full adversarial security audit of the wallet stack was completed for
  this release; see `docs/SECURITY-AUDIT-2026-07.md`.

## Also in this release (previously unreleased since 2.0.4)
- **Transaction Builder (PSBT)** — compose, sign, coordinate, and broadcast
  partially-signed transactions; broadcast via a local node or Electrum.
- **N-of-M multisig wallet wizard**.
- Handbook updates and full localization across 25 languages.

## Under the hood
The wallet engine was extracted into a shared, reusable Rust stack (the
`btcx` crates — chain params, keys, seed storage, Electrum client, BDK
wallet) so desktop, Android, and the Satchel swap app share one audited
implementation. Faster transaction loading for large wallets. Numerous UI
refinements across eight iteration rounds.

---
*Draft build for team QA. Not for public distribution until validated.*
