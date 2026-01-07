//! Tauri callback implementation for plotter progress events
//!
//! This module provides a PlotterCallback implementation that emits
//! Tauri events to the frontend for real-time progress updates.

use pocx_plotter::PlotterCallback;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

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
