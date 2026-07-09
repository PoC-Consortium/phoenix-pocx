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
//!   per-network descriptor policy, active flag.
//! - `btcx-wallet/seed.mnemonic` — the seed, never plaintext (see
//!   `seedstore`). ONE seed serves every network.
//! - `btcx-wallet/<network>/wallet/btcx.sqlite` — the per-network bdk
//!   wallet store.

pub mod commands;
pub mod config;
pub mod manager;
pub mod state;

pub use config::BtcxWalletConfig;
pub use state::{create_btcx_wallet_state, BtcxWalletState, SharedBtcxWalletState};
