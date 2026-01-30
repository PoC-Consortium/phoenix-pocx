//! Tauri callback implementation for aggregator events
//!
//! This module provides a callback implementation that emits Tauri events
//! to the frontend for real-time aggregator updates.

use pocx_aggregator::AggregatorCallback;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

use super::state::{AggregatorStatus, SharedAggregatorState};

/// Tauri-based aggregator callback that emits events to the frontend
pub struct TauriAggregatorCallback<R: Runtime> {
    app_handle: AppHandle<R>,
    state: SharedAggregatorState,
}

impl<R: Runtime> TauriAggregatorCallback<R> {
    pub fn new(app_handle: AppHandle<R>, state: SharedAggregatorState) -> Self {
        Self { app_handle, state }
    }

    /// Create and register the callback globally
    pub fn register(app_handle: AppHandle<R>, state: SharedAggregatorState) {
        let callback = Arc::new(Self::new(app_handle, state));
        match pocx_aggregator::set_aggregator_callback(callback) {
            Ok(_) => log::info!("Aggregator callback registered successfully"),
            Err(_) => log::warn!("Aggregator callback already registered (OnceLock)"),
        }
    }
}

impl<R: Runtime> AggregatorCallback for TauriAggregatorCallback<R> {
    fn on_started(&self, info: &pocx_aggregator::AggregatorStartedInfo) {
        log::info!(
            "Aggregator started: listening on {}, upstream={}",
            info.listen_address, info.upstream_name
        );

        // Update state
        if let Ok(mut state) = self.state.lock() {
            state.status = AggregatorStatus::Running {
                listen_address: info.listen_address.clone(),
            };
        }

        // pocx_aggregator types already have #[serde(rename_all = "camelCase")]
        let _ = self.app_handle.emit("aggregator:started", info);
    }

    fn on_new_block(&self, block: &pocx_aggregator::BlockUpdate) {
        let _ = self.app_handle.emit("aggregator:new-block", block);
    }

    fn on_submission_received(&self, info: &pocx_aggregator::SubmissionInfo) {
        let _ = self.app_handle.emit("aggregator:submission-received", info);
    }

    fn on_submission_forwarded(&self, info: &pocx_aggregator::ForwardedInfo) {
        let _ = self.app_handle.emit("aggregator:submission-forwarded", info);
    }

    fn on_submission_accepted(&self, info: &pocx_aggregator::AcceptedInfo) {
        let _ = self.app_handle.emit("aggregator:submission-accepted", info);
    }

    fn on_submission_rejected(&self, info: &pocx_aggregator::RejectedInfo) {
        let _ = self.app_handle.emit("aggregator:submission-rejected", info);
    }

    fn on_miner_connected(&self, account_id: &str, machine_id: &str) {
        #[derive(Clone, serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct ConnectedPayload {
            account_id: String,
            machine_id: String,
        }
        let _ = self.app_handle.emit(
            "aggregator:miner-connected",
            ConnectedPayload {
                account_id: account_id.to_string(),
                machine_id: machine_id.to_string(),
            },
        );
    }

    fn on_stats_updated(&self, snapshot: &pocx_aggregator::StatsSnapshot) {
        log::debug!(
            "Stats updated: miners={}, machines={}, height={}",
            snapshot.unique_miners, snapshot.unique_machines, snapshot.current_height
        );

        // Cache the stats in state
        if let Ok(mut state) = self.state.lock() {
            if let Ok(val) = serde_json::to_value(snapshot) {
                state.last_stats = Some(val);
            }
        }

        let _ = self.app_handle.emit("aggregator:stats-updated", snapshot);
    }

    fn on_error(&self, error: &str) {
        log::error!("Aggregator error: {}", error);

        if let Ok(mut state) = self.state.lock() {
            state.status = AggregatorStatus::Error {
                message: error.to_string(),
            };
        }

        #[derive(Clone, serde::Serialize)]
        struct ErrorPayload {
            error: String,
        }
        let _ = self.app_handle.emit(
            "aggregator:error",
            ErrorPayload {
                error: error.to_string(),
            },
        );
    }

    fn on_stopped(&self) {
        log::info!("Aggregator stopped");

        if let Ok(mut state) = self.state.lock() {
            state.status = AggregatorStatus::Stopped;
        }

        let _ = self.app_handle.emit("aggregator:stopped", ());
    }
}
