# Handbook source revision

This file records the exact wallet revision the handbook content reflects. Keep
it accurate: it is the anchor that makes future updates a *delta* (diff the app
between this commit and the new HEAD) instead of a full re-read.

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Based-on commit  | `6dd9a77` (origin/master)                   |
| Short SHA        | `6dd9a77`                                   |
| App version      | `2.1.0` (`package.json` still reads `2.0.5` — version bump pending) |
| Synced on        | 2026-07-11                                   |

## How to update the handbook against a newer wallet

1. Note the new target: `git rev-parse HEAD` (and the app version in
   `web-wallet/package.json`).
2. Diff the wallet's user-facing surface between the based-on commit and the
   target, e.g.:

   ```sh
   git log --oneline 9e4854c..HEAD
   git diff 9e4854c..HEAD -- web-wallet/src/assets/locales/en.json
   git diff 9e4854c..HEAD -- web-wallet/src/app
   ```

   `en.json` is the fastest signal: added/changed keys map almost one-to-one to
   user-visible label, hint, and feature changes.
3. Apply the documentation deltas to the affected chapters, retake any
   screenshots whose UI changed, and bump `metadata.yaml`'s `date:`.
4. Update the table above to the new commit, SHA, version, and date.

## History

| Synced on  | Based-on  | Version | Notes                                              |
|------------|-----------|---------|----------------------------------------------------|
| 2026-07-11 | `6dd9a77` | 2.1.0   | Remote (Electrum/nodeless) node mode — new Chapter 26; full rewrite of ch23 (Android is now a wallet + miner); ch04/ch12 gain the remote node mode; ch05 gains BTCX coin type + restore branch report + a nodeless note; ch06 remote toolbar/nav surfaces; ch08 Electrum broadcast is now live and remote compose limits; ch02/ch03 Android no longer mining-only. New FAQ entries (remote mode, do-I-need-a-node, phone wallet, change-address balance, coin type, imports, no cloud backup) and glossary entries (Coin type, Derivation branch, Electrum server, Remote mode, SegWit, Taproot, Nodeless; Descriptor/WIF updated). Part V renumbered 26–29 → 27–30. Screenshots for remote mode and the rebuilt Android wallet not yet captured. |
| 2026-07-03 | `5e6a96c` | 2.0.5   | Added the Transaction Builder (PSBT) to ch08 and the multisig wallet wizard to ch05; tour, glossary, and FAQ updates; Android swap-aware memory note. New screenshots captured (3 for the multisig wizard, 4 for the Transaction Builder). |
| 2026-06-22 | `9e4854c` | 2.0.3   | First recorded revision. See `UPDATE-NOTES-2026-06.md`. |
| (original) | `4c48855` | 2.0     | Initial handbook authoring (no revision was recorded). |
