//! Tauri callback implementations for plotter and miner progress events
//!
//! This module provides callback implementations that emit Tauri events
//! to the frontend for real-time progress updates.

use pocx_miner::MinerCallback;
use pocx_plotter::PlotterCallback;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

use super::state::{add_deadline, DeadlineEntry, DeadlineUpdateResult, SharedMiningState};

/// Event payload for plotter started
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotterStartedEvent {
    pub total_warps: u64,
    pub resume_offset: u64,
}

/// Event payload for hashing progress
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HashingProgressEvent {
    pub warps_delta: u64,
}

/// Event payload for writing progress
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingProgressEvent {
    pub warps_delta: u64,
}

/// Event payload for plotter complete
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotterCompleteEvent {
    pub total_warps: u64,
    pub duration_ms: u64,
}

/// Event payload for plotter error
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotterErrorEvent {
    pub error: String,
}

/// Tauri-based plotter callback that emits events to the frontend
pub struct TauriPlotterCallback<R: Runtime> {
    app_handle: AppHandle<R>,
}

impl<R: Runtime> TauriPlotterCallback<R> {
    /// Create a new Tauri plotter callback
    pub fn new(app_handle: AppHandle<R>) -> Self {
        Self { app_handle }
    }

    /// Create and register the callback globally
    pub fn register(app_handle: AppHandle<R>) -> Arc<Self> {
        let callback = Arc::new(Self::new(app_handle));
        pocx_plotter::set_plotter_callback(callback.clone());
        callback
    }
}

impl<R: Runtime> PlotterCallback for TauriPlotterCallback<R> {
    fn on_started(&self, total_warps: u64, resume_offset: u64) {
        let _ = self.app_handle.emit(
            "plotter:started",
            PlotterStartedEvent {
                total_warps,
                resume_offset,
            },
        );
    }

    fn on_hashing_progress(&self, warps_delta: u64) {
        let _ = self.app_handle.emit(
            "plotter:hashing-progress",
            HashingProgressEvent { warps_delta },
        );
    }

    fn on_writing_progress(&self, warps_delta: u64) {
        let _ = self.app_handle.emit(
            "plotter:writing-progress",
            WritingProgressEvent { warps_delta },
        );
    }

    fn on_complete(&self, total_warps: u64, duration_ms: u64) {
        let _ = self.app_handle.emit(
            "plotter:complete",
            PlotterCompleteEvent {
                total_warps,
                duration_ms,
            },
        );
    }

    fn on_error(&self, error: &str) {
        let _ = self.app_handle.emit(
            "plotter:error",
            PlotterErrorEvent {
                error: error.to_string(),
            },
        );
    }
}

// ============================================================================
// Miner Callback Implementation
// ============================================================================

/// Event payload for miner started
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerStartedEvent {
    pub chains: Vec<String>,
    pub version: String,
}

/// Event payload for capacity loaded
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityLoadedEvent {
    pub drives: u32,
    pub total_warps: u64,
    pub capacity_tib: f64,
}

/// Event payload for new block
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBlockEvent {
    pub chain: String,
    pub height: u64,
    pub base_target: u64,
    pub gen_sig: String,
    pub network_capacity: String,
    pub compression_range: String,
    pub scoop: u64,
}

/// Event payload for queue update
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueUpdateEvent {
    pub queue: Vec<QueueItemEvent>,
}

/// Queue item in the queue update event
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItemEvent {
    pub position: u32,
    pub chain: String,
    pub height: u64,
    pub progress_percent: f64,
}

/// Event payload for scan started
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStartedEvent {
    pub chain: String,
    pub height: u64,
    pub total_warps: u64,
    pub resuming: bool,
}

/// Event payload for scan progress
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
    pub warps_delta: u64,
}

/// Event payload for scan status change
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ScanStatusEvent {
    Finished {
        #[serde(rename = "durationSecs")]
        duration_secs: f64,
    },
    Paused {
        #[serde(rename = "progressPercent")]
        progress_percent: f64,
    },
    Interrupted {
        #[serde(rename = "progressPercent")]
        progress_percent: f64,
    },
}

/// Event payload for deadline accepted
/// Account is pre-converted to bech32 format (no frontend IPC needed)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadlineAcceptedEvent {
    pub chain: String,
    pub account: String,          // bech32 format (pre-converted)
    pub height: u64,
    pub nonce: u64,
    pub quality_raw: u64,
    pub compression: u8,
    pub poc_time: u64,
    pub gensig: String,           // For fork detection
    pub is_best_for_block: bool,  // True if this is best deadline for this height
    pub base_target: u64,         // Block's base target
}

/// Event payload for deadline retry
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadlineRetryEvent {
    pub chain: String,
    pub account: String,
    pub height: u64,
    pub nonce: u64,
    pub compression: u8,
    pub reason: String,
}

/// Event payload for deadline rejected
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadlineRejectedEvent {
    pub chain: String,
    pub account: String,
    pub height: u64,
    pub nonce: u64,
    pub compression: u8,
    pub code: i32,
    pub message: String,
}

/// Tauri-based miner callback that emits events to the frontend
/// and persists deadline data to the shared mining state
pub struct TauriMinerCallback<R: Runtime> {
    app_handle: AppHandle<R>,
    state: SharedMiningState,
    /// Cache for hex → bech32 address conversion (typically 1-10 entries)
    bech32_cache: Mutex<HashMap<String, String>>,
}

impl<R: Runtime> TauriMinerCallback<R> {
    /// Create a new Tauri miner callback
    pub fn new(app_handle: AppHandle<R>, state: SharedMiningState) -> Self {
        Self {
            app_handle,
            state,
            bech32_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Create and register the callback globally
    pub fn register(app_handle: AppHandle<R>, state: SharedMiningState) -> Arc<Self> {
        let callback = Arc::new(Self::new(app_handle, state));
        match pocx_miner::set_miner_callback(callback.clone()) {
            Ok(_) => log::info!("Miner callback registered successfully"),
            Err(_) => log::warn!("Miner callback registration failed (callback may already be set)"),
        }
        callback
    }

    /// Convert hex account to bech32 with caching
    /// Uses the network from the mining config
    fn hex_to_bech32_cached(&self, hex_account: &str) -> String {
        // Check cache first
        if let Ok(cache) = self.bech32_cache.lock() {
            if let Some(cached) = cache.get(hex_account) {
                return cached.clone();
            }
        }

        // Get network from config
        let network = if let Ok(state) = self.state.lock() {
            state.config.wallet_network.clone()
        } else {
            "testnet".to_string()
        };

        // Determine HRP from network
        let hrp = match network.to_lowercase().as_str() {
            "mainnet" => "pocx",
            "testnet" => "tpocx",
            "regtest" => "rpocx",
            _ => "tpocx", // Default to testnet
        };

        // Parse hex and encode to bech32
        let bech32 = match hex::decode(hex_account) {
            Ok(payload) => {
                let network_id = pocx_address::NetworkId::Bech32(hrp.to_string());
                match pocx_address::encode_address(&payload, network_id) {
                    Ok(address) => address,
                    Err(_) => hex_account.to_string(), // Fallback to hex
                }
            }
            Err(_) => hex_account.to_string(), // Fallback to hex
        };

        // Cache the result
        if let Ok(mut cache) = self.bech32_cache.lock() {
            cache.insert(hex_account.to_string(), bech32.clone());
        }

        bech32
    }
}

impl<R: Runtime> MinerCallback for TauriMinerCallback<R> {
    fn on_started(&self, info: &pocx_miner::MinerStartedInfo) {
        log::info!("Miner callback: started - version={}, chains={:?}", info.version, info.chains);

        let _ = self.app_handle.emit(
            "miner:started",
            MinerStartedEvent {
                chains: info.chains.clone(),
                version: info.version.clone(),
            },
        );
    }

    fn on_capacity_loaded(&self, info: &pocx_miner::CapacityInfo) {
        let _ = self.app_handle.emit(
            "miner:capacity-loaded",
            CapacityLoadedEvent {
                drives: info.drives,
                total_warps: info.total_warps,
                capacity_tib: info.capacity_tib,
            },
        );
    }

    fn on_new_block(&self, block: &pocx_miner::BlockInfo) {
        let _ = self.app_handle.emit(
            "miner:new-block",
            NewBlockEvent {
                chain: block.chain.clone(),
                height: block.height,
                base_target: block.base_target,
                gen_sig: block.gen_sig.clone(),
                network_capacity: block.network_capacity.clone(),
                compression_range: block.compression_range.clone(),
                scoop: block.scoop,
            },
        );
    }

    fn on_queue_updated(&self, queue: &[pocx_miner::QueueItem]) {
        let items: Vec<QueueItemEvent> = queue
            .iter()
            .map(|q| QueueItemEvent {
                position: q.position,
                chain: q.chain.clone(),
                height: q.height,
                progress_percent: q.progress_percent,
            })
            .collect();
        let _ = self.app_handle.emit("miner:queue-updated", QueueUpdateEvent { queue: items });
    }

    fn on_idle(&self) {
        let _ = self.app_handle.emit("miner:idle", ());
    }

    fn on_scan_started(&self, info: &pocx_miner::ScanStartedInfo) {
        let _ = self.app_handle.emit(
            "miner:scan-started",
            ScanStartedEvent {
                chain: info.chain.clone(),
                height: info.height,
                total_warps: info.total_warps,
                resuming: info.resuming,
            },
        );
    }

    fn on_scan_progress(&self, warps_delta: u64) {
        let _ = self
            .app_handle
            .emit("miner:scan-progress", ScanProgressEvent { warps_delta });
    }

    fn on_scan_status(&self, chain: &str, height: u64, status: &pocx_miner::ScanStatus) {
        let event = match status {
            pocx_miner::ScanStatus::Finished { duration_secs } => {
                ScanStatusEvent::Finished {
                    duration_secs: *duration_secs,
                }
            }
            pocx_miner::ScanStatus::Paused { progress_percent } => {
                ScanStatusEvent::Paused {
                    progress_percent: *progress_percent,
                }
            }
            pocx_miner::ScanStatus::Interrupted { progress_percent } => {
                ScanStatusEvent::Interrupted {
                    progress_percent: *progress_percent,
                }
            }
            _ => return, // Scanning/Resuming are handled by scan_started
        };

        #[derive(Clone, Serialize)]
        #[serde(rename_all = "camelCase")]
        struct ScanStatusPayload {
            chain: String,
            height: u64,
            #[serde(flatten)]
            status: ScanStatusEvent,
        }

        let _ = self.app_handle.emit(
            "miner:scan-status",
            ScanStatusPayload {
                chain: chain.to_string(),
                height,
                status: event,
            },
        );
    }

    fn on_deadline_accepted(&self, deadline: &pocx_miner::AcceptedDeadline) {
        // Use poc_time as deadline value (lower is better, cap at reasonable max)
        let poc_time = if deadline.poc_time < 86400 {
            deadline.poc_time
        } else {
            u64::MAX
        };

        // Look up base_target and gensig from current block for this chain
        let (base_target, gensig) = if let Ok(state) = self.state.lock() {
            state.current_block
                .get(&deadline.chain)
                .map(|b| (b.base_target, b.generation_signature.clone()))
                .unwrap_or((0, String::new()))
        } else {
            (0, String::new())
        };

        // Convert account to bech32 using cache (no frontend IPC needed)
        let account_bech32 = self.hex_to_bech32_cached(&deadline.account);

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let entry = DeadlineEntry {
            id: timestamp,
            chain_name: deadline.chain.clone(),
            account: account_bech32.clone(),
            height: deadline.height,
            nonce: deadline.nonce,
            deadline: poc_time,
            quality_raw: deadline.quality_raw,
            base_target,
            submitted: true,
            timestamp,
            gensig: gensig.clone(),
        };

        // Add to state and check if it was an improvement
        let update_result = add_deadline(&self.state, entry);

        // Only emit event if this deadline was actually an update (best for block)
        let is_best_for_block = update_result != DeadlineUpdateResult::NotImproved;

        if is_best_for_block {
            log::info!(
                "Miner callback: deadline accepted (best for block) - chain={}, height={}, poc_time={}",
                deadline.chain, deadline.height, poc_time
            );

            let _ = self.app_handle.emit(
                "miner:deadline-accepted",
                DeadlineAcceptedEvent {
                    chain: deadline.chain.clone(),
                    account: account_bech32,
                    height: deadline.height,
                    nonce: deadline.nonce,
                    quality_raw: deadline.quality_raw,
                    compression: deadline.compression,
                    poc_time,
                    gensig,
                    is_best_for_block: true,
                    base_target,
                },
            );
        } else {
            log::debug!(
                "Miner callback: deadline skipped (not best) - chain={}, height={}, poc_time={}",
                deadline.chain, deadline.height, poc_time
            );
        }
    }

    fn on_deadline_retry(&self, deadline: &pocx_miner::AcceptedDeadline, reason: &str) {
        log::info!(
            "Miner callback: deadline retry - chain={}, height={}, reason={}",
            deadline.chain, deadline.height, reason
        );

        let _ = self.app_handle.emit(
            "miner:deadline-retry",
            DeadlineRetryEvent {
                chain: deadline.chain.clone(),
                account: deadline.account.clone(),
                height: deadline.height,
                nonce: deadline.nonce,
                compression: deadline.compression,
                reason: reason.to_string(),
            },
        );
    }

    fn on_deadline_rejected(&self, deadline: &pocx_miner::AcceptedDeadline, code: i32, message: &str) {
        log::warn!(
            "Miner callback: deadline rejected - chain={}, height={}, code={}, message={}",
            deadline.chain, deadline.height, code, message
        );

        let _ = self.app_handle.emit(
            "miner:deadline-rejected",
            DeadlineRejectedEvent {
                chain: deadline.chain.clone(),
                account: deadline.account.clone(),
                height: deadline.height,
                nonce: deadline.nonce,
                compression: deadline.compression,
                code,
                message: message.to_string(),
            },
        );
    }

    fn on_hdd_wakeup(&self) {
        let _ = self.app_handle.emit("miner:hdd-wakeup", ());
    }

    fn on_stopped(&self) {
        let _ = self.app_handle.emit("miner:stopped", ());
    }
}
