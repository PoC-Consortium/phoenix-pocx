//! Plotter execution engine
//!
//! Handles the actual execution of plot plan items using pocx_plotter.
//!
//! This module contains PlotterRuntime which is the single source of truth for:
//! - Whether the plotter is running
//! - Stop type (none/soft/hard)
//! - Current plan (in memory only, not persisted)
//! - Current execution index
//! - Plotting progress
//!
//! Note: For optimal disk I/O performance (especially direct I/O), run the app as administrator.
//! This can be done by right-clicking the app and selecting "Run as administrator".

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

use super::callback::TauriPlotterCallback;
use super::state::{MiningConfig, PlotPlanItem, PlottingStatus, SharedMiningState};

// ============================================================================
// Types
// ============================================================================

/// Stop type for plotter
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopType {
    #[default]
    None,
    /// Soft stop: finish current batch, keep plan
    Soft,
    /// Hard stop: finish current item, clear plan and regenerate
    Hard,
}

/// Plotting progress tracking
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlottingProgress {
    pub hashing_warps: u64,
    pub writing_warps: u64,
    pub total_warps: u64,
    pub plot_start_time: u64,
    pub current_batch_size: usize,
    pub completed_in_batch: usize,
    pub progress: f64,
    pub speed_mib_s: f64,
}

/// Plot plan (in-memory only, not persisted)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotPlan {
    pub items: Vec<PlotPlanItem>,
    #[serde(default)]
    pub config_hash: String,
    #[serde(default)]
    pub generated_at: u64,
}

/// Plotter runtime state (returned to frontend)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotterState {
    pub running: bool,
    pub stop_type: StopType,
    pub plan: Option<PlotPlan>,
    pub current_index: usize,
    pub progress: PlottingProgress,
}

/// Result of executing a plot item
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotExecutionResult {
    pub success: bool,
    pub warps_plotted: u64,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A single output for batch plotting
#[derive(Debug, Clone)]
pub struct BatchPlotOutput {
    pub path: String,
    pub warps: u64,
}

// ============================================================================
// PlotterRuntime - Single source of truth for plotter state
// ============================================================================

/// Runtime state for the plotter
///
/// This is the single source of truth for all plotter state:
/// - Running status
/// - Stop type (none/soft/hard)
/// - Current plan (in memory only)
/// - Execution index
/// - Progress tracking
pub struct PlotterRuntime {
    /// Flag indicating if plotting is active
    is_running: AtomicBool,
    /// Stop type (none/soft/hard)
    stop_type: Mutex<StopType>,
    /// Current plan (in memory only, not persisted)
    plan: Mutex<Option<PlotPlan>>,
    /// Current execution index within plan
    current_index: AtomicUsize,
    /// Progress tracking
    progress: Mutex<PlottingProgress>,
}

impl PlotterRuntime {
    pub fn new() -> Self {
        log::debug!("[PLOTTER] PlotterRuntime created");
        Self {
            is_running: AtomicBool::new(false),
            stop_type: Mutex::new(StopType::None),
            plan: Mutex::new(None),
            current_index: AtomicUsize::new(0),
            progress: Mutex::new(PlottingProgress::default()),
        }
    }

    // ========================================================================
    // Running state
    // ========================================================================

    /// Check if plotting is currently running
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }

    /// Set running state
    pub fn set_running(&self, running: bool) {
        let old = self.is_running.swap(running, Ordering::SeqCst);
        log::debug!("[PLOTTER] is_running: {} → {}", old, running);
    }

    // ========================================================================
    // Stop type
    // ========================================================================

    /// Get current stop type
    pub fn get_stop_type(&self) -> StopType {
        *self.stop_type.lock().unwrap()
    }

    /// Request soft stop (finish batch, keep plan)
    pub fn request_soft_stop(&self) {
        let mut stop = self.stop_type.lock().unwrap();
        let old = *stop;
        *stop = StopType::Soft;
        log::debug!("[PLOTTER] stop_type: {:?} → {:?}", old, StopType::Soft);
    }

    /// Request hard stop (finish item, clear plan)
    pub fn request_hard_stop(&self) {
        let mut stop = self.stop_type.lock().unwrap();
        let old = *stop;
        *stop = StopType::Hard;
        log::debug!("[PLOTTER] stop_type: {:?} → {:?}", old, StopType::Hard);
        // Signal pocx_plotter to stop its internal loops
        pocx_plotter::request_stop();
    }

    /// Clear stop request
    pub fn clear_stop(&self) {
        let mut stop = self.stop_type.lock().unwrap();
        let old = *stop;
        *stop = StopType::None;
        if old != StopType::None {
            log::debug!("[PLOTTER] stop_type: {:?} → {:?}", old, StopType::None);
        }
        // Also clear pocx_plotter's internal stop flag
        pocx_plotter::clear_stop_request();
    }

    /// Check if any stop is requested
    pub fn is_stop_requested(&self) -> bool {
        self.get_stop_type() != StopType::None
    }

    // ========================================================================
    // Plan management
    // ========================================================================

    /// Set the current plan
    pub fn set_plan(&self, plan: PlotPlan) {
        log::debug!("[PLOTTER] plan set: {} items, hash={}", plan.items.len(), plan.config_hash);
        *self.plan.lock().unwrap() = Some(plan);
        self.current_index.store(0, Ordering::SeqCst);
    }

    /// Get the current plan (cloned)
    pub fn get_plan(&self) -> Option<PlotPlan> {
        self.plan.lock().unwrap().clone()
    }

    /// Clear the current plan
    pub fn clear_plan(&self) {
        log::debug!("[PLOTTER] plan cleared");
        *self.plan.lock().unwrap() = None;
        self.current_index.store(0, Ordering::SeqCst);
    }

    /// Check if plan exists
    pub fn has_plan(&self) -> bool {
        self.plan.lock().unwrap().is_some()
    }

    // ========================================================================
    // Index management
    // ========================================================================

    /// Get current execution index
    pub fn get_current_index(&self) -> usize {
        self.current_index.load(Ordering::SeqCst)
    }

    /// Advance to next index, returns new index
    pub fn advance_index(&self) -> usize {
        let old = self.current_index.fetch_add(1, Ordering::SeqCst);
        let new = old + 1;
        log::debug!("[PLOTTER] index advanced: {} → {}", old, new);
        new
    }

    /// Set index (for resuming)
    pub fn set_index(&self, index: usize) {
        let old = self.current_index.swap(index, Ordering::SeqCst);
        log::debug!("[PLOTTER] index set: {} → {}", old, index);
    }

    /// Get current item from plan
    pub fn get_current_item(&self) -> Option<PlotPlanItem> {
        let plan = self.plan.lock().unwrap();
        let index = self.current_index.load(Ordering::SeqCst);
        plan.as_ref().and_then(|p| p.items.get(index).cloned())
    }

    /// Check if there are more items to execute
    pub fn has_more_items(&self) -> bool {
        let plan = self.plan.lock().unwrap();
        let index = self.current_index.load(Ordering::SeqCst);
        plan.as_ref().map(|p| index < p.items.len()).unwrap_or(false)
    }

    // ========================================================================
    // Progress tracking
    // ========================================================================

    /// Get current progress (cloned)
    pub fn get_progress(&self) -> PlottingProgress {
        self.progress.lock().unwrap().clone()
    }

    /// Update progress
    pub fn update_progress(&self, progress: PlottingProgress) {
        *self.progress.lock().unwrap() = progress;
    }

    /// Reset progress for new batch
    pub fn reset_progress(&self, total_warps: u64, batch_size: usize) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        *self.progress.lock().unwrap() = PlottingProgress {
            hashing_warps: 0,
            writing_warps: 0,
            total_warps,
            plot_start_time: now,
            current_batch_size: batch_size,
            completed_in_batch: 0,
            progress: 0.0,
            speed_mib_s: 0.0,
        };
        log::debug!("[PLOTTER] progress reset: {} warps, batch_size={}", total_warps, batch_size);
    }

    /// Update hashing progress
    pub fn add_hashing_warps(&self, warps: u64) {
        let mut progress = self.progress.lock().unwrap();
        progress.hashing_warps += warps;
        self.recalculate_progress(&mut progress);
    }

    /// Update writing progress
    pub fn add_writing_warps(&self, warps: u64) {
        let mut progress = self.progress.lock().unwrap();
        progress.writing_warps += warps;
        self.recalculate_progress(&mut progress);
    }

    /// Recalculate overall progress percentage
    fn recalculate_progress(&self, progress: &mut PlottingProgress) {
        if progress.total_warps > 0 {
            // Combined progress: hashing is ~50%, writing is ~50%
            let hashing_pct = (progress.hashing_warps as f64 / progress.total_warps as f64) * 50.0;
            let writing_pct = (progress.writing_warps as f64 / progress.total_warps as f64) * 50.0;
            progress.progress = (hashing_pct + writing_pct).min(100.0);
        }
    }

    /// Update speed
    pub fn update_speed(&self, speed_mib_s: f64) {
        self.progress.lock().unwrap().speed_mib_s = speed_mib_s;
    }

    // ========================================================================
    // State snapshot
    // ========================================================================

    /// Get complete plotter state for frontend
    pub fn get_state(&self) -> PlotterState {
        log::debug!("[PLOTTER] get_state called");
        PlotterState {
            running: self.is_running(),
            stop_type: self.get_stop_type(),
            plan: self.get_plan(),
            current_index: self.get_current_index(),
            progress: self.get_progress(),
        }
    }

}

impl Default for PlotterRuntime {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe plotter runtime
pub type SharedPlotterRuntime = Arc<PlotterRuntime>;

/// Create a new shared plotter runtime
pub fn create_plotter_runtime() -> SharedPlotterRuntime {
    Arc::new(PlotterRuntime::new())
}

/// Execute a batch of plot items (multiple outputs in single plotter run)
///
/// Items with the same batchId should be executed together for parallel disk writes.
pub async fn execute_plot_batch<R: Runtime>(
    app_handle: AppHandle<R>,
    items: Vec<PlotPlanItem>,
    config: &MiningConfig,
    mining_state: SharedMiningState,
    plotter_runtime: SharedPlotterRuntime,
) -> Result<PlotExecutionResult, String> {
    // Check if already running
    if plotter_runtime.is_running() {
        log::warn!("Plotter is already running, rejecting batch request");
        return Err("Plotter is already running".to_string());
    }

    // Clear any previous stop request
    plotter_runtime.clear_stop();

    // Validate address
    if config.plotting_address.is_empty() {
        return Err("No plotting address configured".to_string());
    }

    // Collect outputs from all items
    let mut outputs: Vec<BatchPlotOutput> = Vec::new();
    let mut paths: Vec<String> = Vec::new();

    for item in &items {
        match item {
            PlotPlanItem::Plot { path, warps, batch_id: _ } => {
                outputs.push(BatchPlotOutput {
                    path: path.clone(),
                    warps: *warps,
                });
                paths.push(path.clone());
            }
            PlotPlanItem::Resume { path, file_index: _, size_gib } => {
                // For resume, we still need to handle .tmp files
                // But for batching, we treat it as a regular output
                outputs.push(BatchPlotOutput {
                    path: path.clone(),
                    warps: *size_gib,
                });
                paths.push(path.clone());
            }
            PlotPlanItem::AddToMiner => {
                // Skip add_to_miner items in batch - they're executed separately
                log::info!("Skipping add_to_miner item in batch");
            }
        }
    }

    if outputs.is_empty() {
        return Err("No plot items in batch".to_string());
    }

    // Build the plotter task with all outputs
    let task = build_plotter_task_batch(
        &config.plotting_address,
        &outputs,
        config,
        None, // Batch mode doesn't support resume
    )?;

    // Calculate total warps
    let total_warps: u64 = outputs.iter().map(|o| o.warps).sum();

    // Update plotting status (show first path)
    {
        if let Ok(mut state) = mining_state.lock() {
            let status_path = if paths.len() > 1 {
                format!("{} (+{} more)", paths[0], paths.len() - 1)
            } else {
                paths[0].clone()
            };
            state.plotting_status = PlottingStatus::Plotting {
                file_path: status_path,
                progress: 0.0,
                speed_mib_s: 0.0,
            };
        }
    }

    // Register callback for progress events
    TauriPlotterCallback::register(app_handle.clone());

    // Mark as running
    plotter_runtime.set_running(true);

    log::info!("Starting plotter: {} outputs, {} GiB", outputs.len(), total_warps);

    // Clone values for the background task
    let mining_state_clone = mining_state.clone();
    let plotter_runtime_clone = plotter_runtime.clone();
    let app_handle_clone = app_handle.clone();
    let paths_clone = paths.clone();
    let items_clone = items.clone();

    // Spawn the plotter task in the background
    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            let start = std::time::Instant::now();
            let plotter_result = pocx_plotter::run_plotter_safe(task);
            let duration = start.elapsed();
            (plotter_result, duration, paths_clone)
        })
        .await;

        // Update state when done
        match mining_state_clone.lock() {
            Ok(mut state) => {
                state.plotting_status = PlottingStatus::Idle;
            }
            Err(e) => {
                log::error!("Failed to lock mining state to update status: {} - UI may show stale state", e);
            }
        }
        plotter_runtime_clone.set_running(false);

        // Process the result and emit events for each item
        match result {
            Ok((Ok(()), duration, _paths)) => {
                // Check if plotter was stopped vs completed normally
                let was_stopped = pocx_plotter::is_stop_requested();

                if was_stopped {
                    log::info!("Batch plot stopped by user request");
                    // Emit stopped event for all items
                    for item in &items_clone {
                        let (item_type, path) = match item {
                            PlotPlanItem::Plot { path, .. } => ("plot", path.clone()),
                            PlotPlanItem::Resume { path, .. } => ("resume", path.clone()),
                            PlotPlanItem::AddToMiner => ("add_to_miner", String::new()),
                        };
                        let _ = app_handle_clone.emit(
                            "plotter:item-complete",
                            serde_json::json!({
                                "type": item_type,
                                "path": path,
                                "success": false,
                                "warpsPlotted": 0,
                                "durationMs": duration.as_millis() as u64,
                                "error": "Stopped by user",
                            }),
                        );
                    }
                } else {
                    log::info!("Plotter finished: {} GiB in {:?}", total_warps, duration);

                    // Emit completion event for each item in the batch
                    for item in &items_clone {
                        match item {
                            PlotPlanItem::Plot { path, warps, batch_id: _ } => {
                                let _ = app_handle_clone.emit(
                                    "plotter:item-complete",
                                    serde_json::json!({
                                        "type": "plot",
                                        "path": path,
                                        "success": true,
                                        "warpsPlotted": warps,
                                        "durationMs": duration.as_millis() as u64,
                                        "batchSize": items_clone.len(),
                                    }),
                                );
                            }
                            PlotPlanItem::Resume { path, file_index: _, size_gib } => {
                                let _ = app_handle_clone.emit(
                                    "plotter:item-complete",
                                    serde_json::json!({
                                        "type": "resume",
                                        "path": path,
                                        "success": true,
                                        "warpsPlotted": size_gib,
                                        "durationMs": duration.as_millis() as u64,
                                        "batchSize": items_clone.len(),
                                    }),
                                );
                            }
                            PlotPlanItem::AddToMiner => {
                                // Emit add_to_miner event so frontend can restart miner
                                let _ = app_handle_clone.emit(
                                    "plotter:item-complete",
                                    serde_json::json!({
                                        "type": "add_to_miner",
                                        "success": true,
                                        "durationMs": duration.as_millis() as u64,
                                    }),
                                );
                            }
                        }
                    }
                }
            }
            Ok((Err(e), duration, _paths)) => {
                log::error!("Batch plot failed: {}", e);
                // Emit failure for all items
                for item in &items_clone {
                    let (item_type, path) = match item {
                        PlotPlanItem::Plot { path, .. } => ("plot", path.clone()),
                        PlotPlanItem::Resume { path, .. } => ("resume", path.clone()),
                        PlotPlanItem::AddToMiner => ("add_to_miner", String::new()),
                    };
                    let _ = app_handle_clone.emit(
                        "plotter:item-complete",
                        serde_json::json!({
                            "type": item_type,
                            "path": path,
                            "success": false,
                            "warpsPlotted": 0,
                            "durationMs": duration.as_millis() as u64,
                            "error": e.to_string(),
                        }),
                    );
                }
            }
            Err(e) => {
                log::error!("Batch plotter task panicked: {}", e);
                for item in &items_clone {
                    let (item_type, path) = match item {
                        PlotPlanItem::Plot { path, .. } => ("plot", path.clone()),
                        PlotPlanItem::Resume { path, .. } => ("resume", path.clone()),
                        PlotPlanItem::AddToMiner => ("add_to_miner", String::new()),
                    };
                    let _ = app_handle_clone.emit(
                        "plotter:item-complete",
                        serde_json::json!({
                            "type": item_type,
                            "path": path,
                            "success": false,
                            "warpsPlotted": 0,
                            "durationMs": 0,
                            "error": format!("Task panicked: {}", e),
                        }),
                    );
                }
            }
        }
    });

    Ok(PlotExecutionResult {
        success: true,
        warps_plotted: 0, // Actual value comes via events
        duration_ms: 0,
        error: None,
    })
}

/// Execute a single plot plan item
pub async fn execute_plot_item<R: Runtime>(
    app_handle: AppHandle<R>,
    item: PlotPlanItem,
    config: &MiningConfig,
    mining_state: SharedMiningState,
    plotter_runtime: SharedPlotterRuntime,
) -> Result<PlotExecutionResult, String> {
    log::info!("=== Execute Plot Item ===");
    log::info!("  Item: {:?}", item);
    log::info!("  Plotting address: {}", config.plotting_address);
    log::info!("  Plotter devices: {:?}", config.plotter_devices);
    log::info!("=========================");

    // Check if already running
    if plotter_runtime.is_running() {
        log::warn!("Plotter is already running, rejecting request");
        return Err("Plotter is already running".to_string());
    }

    // Clear any previous stop request
    plotter_runtime.clear_stop();

    match item {
        PlotPlanItem::Resume {
            path,
            file_index: _,
            size_gib,
        } => {
            execute_resume(
                app_handle,
                path,
                size_gib,
                config,
                mining_state,
                plotter_runtime,
            )
            .await
        }
        PlotPlanItem::Plot {
            path,
            warps,
            batch_id: _,
        } => {
            execute_plot(
                app_handle,
                path,
                warps,
                config,
                mining_state,
                plotter_runtime,
            )
            .await
        }
        PlotPlanItem::AddToMiner => {
            // AddToMiner checkpoint: signals frontend to restart miner with ready drives
            log::info!("AddToMiner checkpoint - frontend will restart miner");

            // Emit completion event - frontend will restart miner to pick up ready drives
            let _ = app_handle.emit("plotter:item-complete", serde_json::json!({
                "type": "add_to_miner",
                "success": true,
            }));

            Ok(PlotExecutionResult {
                success: true,
                warps_plotted: 0,
                duration_ms: 0,
                error: None,
            })
        }
    }
}

/// Parse seed from .tmp filename
/// Filename format: {account}_{seed}_{warps}_X{compression}.tmp
fn parse_seed_from_tmp_filename(filename: &str) -> Option<[u8; 32]> {
    // Get just the filename without path
    let name = std::path::Path::new(filename)
        .file_name()
        .and_then(|n| n.to_str())?;

    // Split by underscore: [account, seed, warps, X{compression}.tmp]
    let parts: Vec<&str> = name.split('_').collect();
    if parts.len() < 2 {
        log::warn!("Invalid .tmp filename format: {}", name);
        return None;
    }

    let seed_hex = parts[1];

    // Parse hex string to bytes
    let seed_bytes = hex::decode(seed_hex).ok()?;
    if seed_bytes.len() != 32 {
        log::warn!("Invalid seed length in filename: {} bytes (expected 32)", seed_bytes.len());
        return None;
    }

    let mut seed = [0u8; 32];
    seed.copy_from_slice(&seed_bytes);
    Some(seed)
}

/// Execute a resume task (resume incomplete .tmp file)
async fn execute_resume<R: Runtime>(
    app_handle: AppHandle<R>,
    drive_path: String,
    size_gib: u64,
    config: &MiningConfig,
    mining_state: SharedMiningState,
    plotter_runtime: SharedPlotterRuntime,
) -> Result<PlotExecutionResult, String> {
    log::info!("[RESUME] Looking for .tmp files in: {}", drive_path);

    // Find .tmp files in the drive path
    let tmp_files = find_tmp_files(&drive_path)?;
    log::info!("[RESUME] Found {} .tmp files", tmp_files.len());

    if tmp_files.is_empty() {
        log::error!("[RESUME] No .tmp files found in {} - returning error", drive_path);
        return Err(format!("No .tmp files found in {}", drive_path));
    }

    // Use the first .tmp file (in practice, should match file_index)
    let tmp_file = &tmp_files[0];
    log::info!("[RESUME] Resuming plot from: {}", tmp_file);

    // Parse seed from filename for resume
    let seed = parse_seed_from_tmp_filename(tmp_file);
    if seed.is_none() {
        return Err(format!("Failed to parse seed from .tmp filename: {}", tmp_file));
    }
    log::info!("Extracted seed for resume: {:?}", seed);

    // Execute the plot with resume seed
    execute_plot_internal(
        app_handle,
        "resume",
        drive_path,
        size_gib, // warps = GiB
        config,
        mining_state,
        plotter_runtime,
        seed,
    )
    .await
}

/// Execute a new plot task
async fn execute_plot<R: Runtime>(
    app_handle: AppHandle<R>,
    drive_path: String,
    warps: u64,
    config: &MiningConfig,
    mining_state: SharedMiningState,
    plotter_runtime: SharedPlotterRuntime,
) -> Result<PlotExecutionResult, String> {
    execute_plot_internal(
        app_handle,
        "plot",
        drive_path,
        warps,
        config,
        mining_state,
        plotter_runtime,
        None, // No resume file
    )
    .await
}

/// Internal plot execution
#[allow(clippy::too_many_arguments)]
async fn execute_plot_internal<R: Runtime>(
    app_handle: AppHandle<R>,
    item_type: &str, // "plot" or "resume"
    drive_path: String,
    warps: u64,
    config: &MiningConfig,
    mining_state: SharedMiningState,
    plotter_runtime: SharedPlotterRuntime,
    resume_seed: Option<[u8; 32]>,
) -> Result<PlotExecutionResult, String> {
    // Validate address
    if config.plotting_address.is_empty() {
        return Err("No plotting address configured".to_string());
    }

    // Build the plotter task
    let builder_result = build_plotter_task(
        &config.plotting_address,
        &drive_path,
        warps,
        config,
        resume_seed,
    );

    let task = match builder_result {
        Ok(t) => t,
        Err(e) => return Err(format!("Failed to build plotter task: {}", e)),
    };

    // Update plotting status
    {
        if let Ok(mut state) = mining_state.lock() {
            state.plotting_status = PlottingStatus::Plotting {
                file_path: drive_path.clone(),
                progress: 0.0,
                speed_mib_s: 0.0,
            };
        }
    }

    // Register callback for progress events
    TauriPlotterCallback::register(app_handle.clone());

    // Mark as running
    plotter_runtime.set_running(true);

    log::info!("[EXEC] Starting plotter execution for {} warps at {}", warps, drive_path);
    log::info!("[EXEC] is_running set to TRUE");

    // Clone values for the background task
    let mining_state_clone = mining_state.clone();
    let plotter_runtime_clone = plotter_runtime.clone();
    let app_handle_clone = app_handle.clone();
    let drive_path_clone = drive_path.clone();
    let item_type_owned = item_type.to_string();

    // Spawn the plotter task in the background - don't wait for it!
    // Completion is handled via events (plotter:complete, plotter:error)
    tokio::spawn(async move {
        // Run the actual plotter in a blocking thread
        let result = tokio::task::spawn_blocking(move || {
            log::info!("Plotter thread started for {}", drive_path_clone);
            let start = std::time::Instant::now();
            let plotter_result = pocx_plotter::run_plotter_safe(task);
            let duration = start.elapsed();
            log::info!("Plotter thread finished for {} in {:?}", drive_path_clone, duration);

            (plotter_result, duration, drive_path_clone)
        })
        .await;

        // Update state when done
        log::info!("[EXEC] Plotter task finished, updating state...");
        match mining_state_clone.lock() {
            Ok(mut state) => {
                state.plotting_status = PlottingStatus::Idle;
                log::info!("[EXEC] plotting_status set to Idle");
            }
            Err(e) => {
                log::error!("[EXEC] Failed to lock mining state: {}", e);
            }
        }
        plotter_runtime_clone.set_running(false);
        log::info!("[EXEC] is_running set to FALSE");

        // Process the result and emit events
        match result {
            Ok((Ok(()), duration, path)) => {
                // Check if plotter was stopped vs completed normally
                let was_stopped = pocx_plotter::is_stop_requested();
                if was_stopped {
                    log::info!("[EVENT] Plot stopped by user request: {}", path);
                    log::info!("[EVENT] Emitting plotter:item-complete (stopped)");
                    let _ = app_handle_clone.emit(
                        "plotter:item-complete",
                        serde_json::json!({
                            "type": item_type_owned,
                            "path": path,
                            "success": false,
                            "warpsPlotted": 0,
                            "durationMs": duration.as_millis() as u64,
                            "error": "Stopped by user",
                        }),
                    );
                } else {
                    log::info!("[EVENT] Plot completed successfully: {} warps", warps);
                    log::info!("[EVENT] Emitting plotter:item-complete (success)");
                    let _ = app_handle_clone.emit(
                        "plotter:item-complete",
                        serde_json::json!({
                            "type": item_type_owned,
                            "path": path,
                            "success": true,
                            "warpsPlotted": warps,
                            "durationMs": duration.as_millis() as u64,
                        }),
                    );
                }
            }
            Ok((Err(e), duration, path)) => {
                log::error!("[EVENT] Plot failed: {}", e);
                log::info!("[EVENT] Emitting plotter:item-complete (error)");
                let _ = app_handle_clone.emit(
                    "plotter:item-complete",
                    serde_json::json!({
                        "type": item_type_owned,
                        "path": path,
                        "success": false,
                        "warpsPlotted": 0,
                        "durationMs": duration.as_millis() as u64,
                        "error": e.to_string(),
                    }),
                );
            }
            Err(e) => {
                log::error!("[EVENT] Plotter task panicked: {}", e);
                log::info!("[EVENT] Emitting plotter:item-complete (panic)");
                let _ = app_handle_clone.emit(
                    "plotter:item-complete",
                    serde_json::json!({
                        "type": item_type_owned,
                        "path": drive_path,
                        "success": false,
                        "warpsPlotted": 0,
                        "durationMs": 0,
                        "error": format!("Task panicked: {}", e),
                    }),
                );
            }
        }
    });

    // Return immediately - task started successfully
    // Frontend will receive plotter:started, plotter:*-progress, and plotter:item-complete events
    log::info!("Plotter task spawned, returning immediately");
    Ok(PlotExecutionResult {
        success: true,
        warps_plotted: 0, // Actual value comes via event
        duration_ms: 0,
        error: None,
    })
}

/// Build a PlotterTask from configuration (single output)
fn build_plotter_task(
    address: &str,
    output_path: &str,
    warps: u64,
    config: &MiningConfig,
    resume_seed: Option<[u8; 32]>,
) -> Result<pocx_plotter::PlotterTask, String> {
    build_plotter_task_batch(address, &[BatchPlotOutput { path: output_path.to_string(), warps }], config, resume_seed)
}

/// Build a PlotterTask from configuration with multiple outputs (batch mode)
fn build_plotter_task_batch(
    address: &str,
    outputs: &[BatchPlotOutput],
    config: &MiningConfig,
    resume_seed: Option<[u8; 32]>,
) -> Result<pocx_plotter::PlotterTask, String> {
    // Collect enabled GPU devices
    let gpu_ids: Vec<String> = config
        .plotter_devices
        .iter()
        .filter(|d| d.enabled && d.device_id != "cpu")
        .map(|d| {
            // Device ID format: "platform:device:cores"
            // Replace cores with configured threads
            let parts: Vec<&str> = d.device_id.split(':').collect();
            if parts.len() >= 2 {
                format!("{}:{}:{}", parts[0], parts[1], d.threads)
            } else {
                d.device_id.clone()
            }
        })
        .collect();

    // Get CPU threads (0 if not enabled)
    let cpu_threads = config
        .plotter_devices
        .iter()
        .find(|d| d.device_id == "cpu" && d.enabled)
        .map(|d| d.threads as u8)
        .unwrap_or(0);

    // Calculate total warps for logging
    let total_warps: u64 = outputs.iter().map(|o| o.warps).sum();

    // Log all plotter parameters
    log::info!("=== Building Plotter Task (Batch) ===");
    log::info!("  Address: {}", address);
    log::info!("  Outputs: {} paths", outputs.len());
    for (i, output) in outputs.iter().enumerate() {
        log::info!("    [{}] {} - {} GiB", i, output.path, output.warps);
    }
    log::info!("  Total warps (GiB): {}", total_warps);
    log::info!("  CPU threads: {}", cpu_threads);
    log::info!("  GPU devices: {:?}", gpu_ids);
    log::info!("  Compression level: {}", config.compression_level);
    log::info!("  Escalation: {}", config.escalation);
    log::info!("  Direct I/O: {}", config.direct_io);
    log::info!("  Zero-copy buffers: {}", config.zero_copy_buffers);
    log::info!("  Low priority: {}", config.low_priority);
    log::info!("  Simulation mode: {}", config.simulation_mode);
    log::info!("  Resume seed: {:?}", resume_seed.map(hex::encode));
    log::info!("=====================================");

    // Build the task
    let mut builder = pocx_plotter::PlotterTaskBuilder::new()
        .address(address)
        .map_err(|e| format!("Invalid address: {}", e))?
        .cpu_threads(cpu_threads)
        .compression(config.compression_level)
        .escalate(config.escalation)
        .direct_io(config.direct_io)
        .quiet(false) // Allow plotter to log
        .line_progress(false); // Use callbacks instead

    // Add seed for resume (required to continue from .tmp file)
    if let Some(seed) = resume_seed {
        log::info!("Setting resume seed: {}", hex::encode(seed));
        builder = builder.seed(seed);
    }

    // Add all outputs
    for output in outputs {
        builder = builder.add_output(output.path.clone(), output.warps, 1);
    }

    // Add GPUs if any
    if !gpu_ids.is_empty() {
        builder = builder.gpus(gpu_ids.clone());
    }

    // Add zero-copy buffers if configured (for APU/integrated GPU)
    if config.zero_copy_buffers {
        builder = builder.zcb(true);
    }

    // Note: low_priority is not supported by pocx_plotter API

    // Add memory limit if configured (0 = auto)
    // Format: "XG" for X GiB
    if config.memory_limit_gib > 0 {
        builder = builder.memory(format!("{}G", config.memory_limit_gib));
    }

    // Enable benchmark mode if simulation mode is active (no disk writes)
    if config.simulation_mode {
        log::info!("Simulation mode enabled: running in benchmark mode (no disk writes)");
        builder = builder.benchmark(true);
    }

    let task = builder.build().map_err(|e| format!("Failed to build task: {}", e))?;

    log::info!("Plotter task built successfully with {} outputs", outputs.len());
    Ok(task)
}

/// Find .tmp files in a directory
fn find_tmp_files(dir_path: &str) -> Result<Vec<String>, String> {
    let path = Path::new(dir_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Path does not exist or is not a directory: {}", dir_path));
    }

    let mut tmp_files = Vec::new();

    match std::fs::read_dir(path) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let file_path = entry.path();
                if let Some(ext) = file_path.extension() {
                    if ext == "tmp" {
                        if let Some(path_str) = file_path.to_str() {
                            tmp_files.push(path_str.to_string());
                        }
                    }
                }
            }
        }
        Err(e) => return Err(format!("Failed to read directory: {}", e)),
    }

    Ok(tmp_files)
}
