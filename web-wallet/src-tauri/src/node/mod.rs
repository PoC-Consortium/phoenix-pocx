//! Node management module for Phoenix PoCX Wallet
//!
//! This module provides the ability to download, manage, and run
//! a Bitcoin-PoCX node directly from the wallet.
//!
//! ## Features
//!
//! - **Managed Mode**: Download, verify, and run bitcoind automatically
//! - **External Mode**: Connect to user's existing node via RPC
//! - **Process Management**: Start, stop, restart, and monitor the daemon
//! - **Update Checking**: Check GitHub releases for new versions
//! - **Hash Verification**: Verify downloaded binaries via SHA256
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │                    node module                           │
//! ├─────────────────────────────────────────────────────────┤
//! │  commands.rs   - Tauri command handlers                  │
//! │  config.rs     - Configuration types and persistence     │
//! │  state.rs      - Shared runtime state                    │
//! │  manager.rs    - Process lifecycle (start/stop/restart)  │
//! │  downloader.rs - GitHub API and file download            │
//! │  hasher.rs     - SHA256 verification                     │
//! │  extractor.rs  - Archive extraction (zip/tar.gz)         │
//! └─────────────────────────────────────────────────────────┘
//! ```

pub mod commands;
pub mod config;
pub mod downloader;
pub mod extractor;
pub mod hasher;
pub mod manager;
pub mod rpc;
pub mod state;

// Re-export key types for convenience
pub use config::{NodeConfig, NodeMode};
pub use manager::NodeManager;
pub use state::{create_node_state, NodeState, SharedNodeState};
