# Handbook source revision

This file records the exact wallet revision the handbook content reflects. Keep
it accurate: it is the anchor that makes future updates a *delta* (diff the app
between this commit and the new HEAD) instead of a full re-read.

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Based-on commit  | `a77c853` (origin/master)                   |
| Short SHA        | `a77c853`                                   |
| App version      | `2.1.2` (`web-wallet/package.json`)          |
| Synced on        | 2026-07-14                                   |

## How to update the handbook against a newer wallet

1. Note the new target: `git rev-parse HEAD` (and the app version in
   `web-wallet/package.json`).
2. Diff the wallet's user-facing surface between the based-on commit and the
   target, e.g.:

   ```sh
   git log --oneline a77c853..HEAD
   git diff a77c853..HEAD -- web-wallet/src/assets/locales/en.json
   git diff a77c853..HEAD -- web-wallet/src/app
   ```

   `en.json` is the fastest signal: added/changed keys map almost one-to-one to
   user-visible label, hint, and feature changes.
3. Apply the documentation deltas to the affected chapters, retake any
   screenshots whose UI changed, and bump `metadata.yaml`'s `date:`.
4. Update the table above to the new commit, SHA, version, and date.

## History

| Synced on  | Based-on  | Version | Notes                                              |
|------------|-----------|---------|----------------------------------------------------|
| 2026-07-14 | `a77c853` | 2.1.2   | Delta over `d7a65bf`. **v30→v31 wallet upgrade / network-aware BTCX coin type** (#153/#154/#156): new ch05 section *Upgrading an older (v30) wallet*, rewritten coin-type note (mainnet = BTCX coin type / v31; testnet+regtest = `1'`; upgrade is mainnet-only, opt-in); Core wallets use a re-enter-phrase dialog, nodeless/Android upgrade in place (sibling, original kept + v30-badged). ch12 gains **Check for older (v30) funds** in the remote panel; ch25b notes the in-place remote upgrade; ch23 gains the mobile **Upgrade to v31** row action. FAQ: coin-type answer updated + new v30-badge question. Glossary: new *v30 / v31 wallet* entry + updated *Coin type*. ch23 mobile Coins page redescribed as a **stacked-card layout** (#159; temp debug panel #157 removed, reload fix #155). README gains a coin-type/upgrade bullet. App version unchanged at 2.1.2. **Screenshots not yet captured** — new: v30 badge + upgrade button on the wallet selector, the Core upgrade dialog, mobile Coins stacked-card layout (replaces any old mobile Coins shot); optional: Settings *Check for older (v30) funds*, mobile *Upgrade to v31* menu. **All screenshots from the two prior syncs are also still outstanding** (see the delta and 2.1.0 rows). |
| 2026-07-13 | `d7a65bf` | 2.1.2   | Delta sync over 2.1.0. ch09 gains **Speed up (CPFP)** for stuck incoming payments, **Export CSV**, and a new **Balance details** (coins-by-address) section; ch06 toolbar Node icon is now a green/amber/red traffic-light with peer count (managed + external), plus a Balance-details map entry. ch08 documents payment-URI parsing on the recipient field, 3-decimal fee display + Custom min 0.1 / step 0.001, and the remote-mode high-fee guard (preset > 200 sat/vB, acknowledge to send). ch25b ties the high-fee guard into the Electrum trust model. ch05 notes Enter-to-accept on phrase entry. ch20 clarifies the Effective-Capacity sparkline is a live trailing-window that resets on restart. ch23 gains the mobile Balance-details shortcut. New FAQ entries (CPFP, CSV export, Balance details) and glossary entries (CPFP, Payment URI). Product rename to "Phoenix Wallet" (#151) was display-only — handbook already used "Phoenix". **Screenshots not yet captured** — new: Balance details, CPFP dialog, high-fee warning; refresh: Receive (QR+URI), Send/fee-bump (3-decimal), toolbar node traffic-light, mining sparkline. **Still outstanding from 2.1.0: remote-mode and Android-wallet screenshots.** |
| 2026-07-11 | `6dd9a77` | 2.1.0   | Remote (Electrum/nodeless) node mode — new Chapter 26; full rewrite of ch23 (Android is now a wallet + miner); ch04/ch12 gain the remote node mode; ch05 gains BTCX coin type + restore branch report + a nodeless note; ch06 remote toolbar/nav surfaces; ch08 Electrum broadcast is now live and remote compose limits; ch02/ch03 Android no longer mining-only. New FAQ entries (remote mode, do-I-need-a-node, phone wallet, change-address balance, coin type, imports, no cloud backup) and glossary entries (Coin type, Derivation branch, Electrum server, Remote mode, SegWit, Taproot, Nodeless; Descriptor/WIF updated). Part V renumbered 26–29 → 27–30. Screenshots for remote mode and the rebuilt Android wallet not yet captured. |
| 2026-07-03 | `5e6a96c` | 2.0.5   | Added the Transaction Builder (PSBT) to ch08 and the multisig wallet wizard to ch05; tour, glossary, and FAQ updates; Android swap-aware memory note. New screenshots captured (3 for the multisig wizard, 4 for the Transaction Builder). |
| 2026-06-22 | `9e4854c` | 2.0.3   | First recorded revision. See `UPDATE-NOTES-2026-06.md`. |
| (original) | `4c48855` | 2.0     | Initial handbook authoring (no revision was recorded). |
