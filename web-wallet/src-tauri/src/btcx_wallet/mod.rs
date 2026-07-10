//! Nodeless BTCX wallet module for Phoenix PoCX Wallet
//!
//! A self-contained on-chain wallet that needs NO local bitcoind: a BIP39
//! seed stored encrypted-at-rest (`seedstore`), a bdk wallet derived at the
//! BTCX coin type (`keys-btcx` + `wallet-btcx`), synced over Electrum
//! (`electrum-btcx`) with Bitcoin-PoCX's 286-byte headers handled by
//! `params-btcx`.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    btcx_wallet module                        │
//! ├─────────────────────────────────────────────────────────────┤
//! │  commands.rs - Tauri command handlers (btcx_wallet_*)        │
//! │  config.rs   - btcx_wallet_config.json persistence,          │
//! │                network → ChainParams mapping                 │
//! │  state.rs    - SharedBtcxWalletState: SeedStore, Electrum    │
//! │                pool, wallet runtime (handle + sync worker),  │
//! │                `btcx-wallet:sync` event emitter              │
//! │  manager.rs  - descriptor-explicit wallet open + the         │
//! │                restore-time descriptor probing               │
//! └─────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Data layout (all under the app data dir)
//!
//! - `btcx_wallet_config.json` — network, per-network Electrum servers,
//!   the named-wallet registry (per-wallet descriptor policy), the active
//!   wallet per network, active flag.
//! - `btcx-wallet/<network>/<name>/seed.mnemonic` — one seed PER named
//!   wallet, never plaintext (see `seedstore`).
//! - `btcx-wallet/<network>/<name>/wallet/btcx.sqlite` — that wallet's bdk
//!   store.
//! - `btcx-wallet/<network>/.trash/<name>-<ts>/` — deleted wallets are
//!   moved here, never removed.
//!
//! The pre-multi-wallet layout (ONE root seed at `btcx-wallet/seed.mnemonic`
//! shared by per-network stores at `btcx-wallet/<network>/wallet/`) is
//! migrated on startup — each network's store becomes its `default` wallet
//! (see `config::migrate_legacy_layout_at`).

pub mod assignments;
pub mod commands;
pub mod config;
pub mod manager;
pub mod psbt;
pub mod state;

pub use config::BtcxWalletConfig;
pub use state::{create_btcx_wallet_state, BtcxWalletState, SharedBtcxWalletState};
