//! Mining module for Phoenix PoCX Wallet
//!
//! This module provides integration between the Tauri frontend and the
//! pocx_miner and pocx_plotter libraries.

pub mod callback;
pub mod commands;
pub mod devices;
pub mod drives;
pub mod plotter;
pub mod state;

// Re-export command handlers for registration
pub use commands::*;

// Re-export plotter runtime
pub use plotter::{create_plotter_runtime, SharedPlotterRuntime};
