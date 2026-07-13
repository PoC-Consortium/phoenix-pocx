# Phoenix Wallet 2.1.1

A quick fix release on top of 2.1.0.

## Fixed
- **Wallet creation was blocked** — on the recovery-phrase confirmation step, the **Next** button stayed disabled even after the words were entered correctly, so new wallets couldn't be created. Fixed. (If you're on 2.1.0, please update.)

## Improved
- **Faster phrase entry** — when typing your recovery phrase, pressing **Enter** now accepts the highlighted autocomplete suggestion and jumps to the next word.

Everything else is unchanged from 2.1.0 — see those notes for the full feature set (remote/Electrum mode, full Android wallet, multi-wallet, PSBT builder, multisig, and more).
