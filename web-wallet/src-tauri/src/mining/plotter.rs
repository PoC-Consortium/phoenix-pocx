//! Plotter execution engine
//!
//! Handles the actual execution of plot plan items using pocx_plotter.
//!
//! Note: For optimal disk I/O performance (especially direct I/O), run the app as administrator.
//! This can be done by right-clicking the app and selecting "Run as administrator".

use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::callback::TauriPlotterCallback;
use super::state::{MiningConfig, PlotPlanItem, PlottingStatus, SharedMiningState};

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

/// Runtime state for the plotter (non-serializable)
pub struct PlotterRuntime {
    /// Handle to the currently running plotter task
    task_handle: Mutex<Option<JoinHandle<PlotExecutionResult>>>,
    /// Flag to request stop after current item
    stop_requested: AtomicBool,
    /// Flag indicating if plotting is active
    is_running: AtomicBool,
}

impl PlotterRuntime {
    pub fn new() -> Self {
        Self {
            task_handle: Mutex::new(None),
            stop_requested: AtomicBool::new(false),
            is_running: AtomicBool::new(false),
        }
    }

    /// Check if plotting is currently running
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }

    /// Check if stop has been requested
    pub fn is_stop_requested(&self) -> bool {
        self.stop_requested.load(Ordering::SeqCst)
    }

    /// Request stop after current item completes
    pub fn request_stop(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
    }

    /// Clear stop request (when starting new execution)
    pub fn clear_stop_request(&self) {
        self.stop_requested.store(false, Ordering::SeqCst);
    }

    /// Abort the currently running task (hard stop)
    pub async fn abort_task(&self) {
        let mut handle = self.task_handle.lock().await;
        if let Some(h) = handle.take() {
            h.abort();
        }
        self.is_running.store(false, Ordering::SeqCst);
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
    plotter_runtime.clear_stop_request();

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
            PlotPlanItem::AddToMiner { path } => {
                // Skip add_to_miner items in batch - they'll be handled after completion
                log::info!("Skipping add_to_miner item in batch: {}", path);
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
    plotter_runtime.is_running.store(true, Ordering::SeqCst);

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
        if let Ok(mut state) = mining_state_clone.lock() {
            state.plotting_status = PlottingStatus::Idle;
        }
        plotter_runtime_clone.is_running.store(false, Ordering::SeqCst);

        // Process the result and emit events for each item
        match result {
            Ok((Ok(()), duration, _paths)) => {
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
                        PlotPlanItem::AddToMiner { .. } => {
                            // Skip - not part of batch execution
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
                        PlotPlanItem::AddToMiner { path } => ("add_to_miner", path.clone()),
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
                        PlotPlanItem::AddToMiner { path } => ("add_to_miner", path.clone()),
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
    plotter_runtime.clear_stop_request();

    match item {
        PlotPlanItem::Resume {
            path,
            file_index,
            size_gib,
        } => {
            execute_resume(
                app_handle,
                path,
                file_index,
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
        PlotPlanItem::AddToMiner { path } => {
            // AddToMiner task: marks drive as ready for mining
            // This is a stub - actual miner integration will be added later
            // For now, it just triggers cache refresh on frontend via the event
            log::info!("Adding drive to miner (stub): {}", path);

            // TODO: When miner is integrated, register drive with miner here
            // e.g., miner.add_plot_directory(&path)?;

            // Emit completion event - frontend will clear cache for this path
            let _ = app_handle.emit("plotter:item-complete", serde_json::json!({
                "type": "add_to_miner",
                "path": path,
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

/// Execute a resume task (resume incomplete .tmp file)
async fn execute_resume<R: Runtime>(
    app_handle: AppHandle<R>,
    drive_path: String,
    _file_index: u32,
    size_gib: u64,
    config: &MiningConfig,
    mining_state: SharedMiningState,
    plotter_runtime: SharedPlotterRuntime,
) -> Result<PlotExecutionResult, String> {
    // Find .tmp files in the drive path
    let tmp_files = find_tmp_files(&drive_path)?;
    if tmp_files.is_empty() {
        return Err(format!("No .tmp files found in {}", drive_path));
    }

    // Use the first .tmp file (in practice, should match file_index)
    let tmp_file = &tmp_files[0];
    log::info!("Resuming plot from: {}", tmp_file);

    // Execute the plot with resume
    execute_plot_internal(
        app_handle,
        drive_path,
        size_gib, // warps = GiB
        config,
        mining_state,
        plotter_runtime,
        Some(tmp_file.clone()),
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
async fn execute_plot_internal<R: Runtime>(
    app_handle: AppHandle<R>,
    drive_path: String,
    warps: u64,
    config: &MiningConfig,
    mining_state: SharedMiningState,
    plotter_runtime: SharedPlotterRuntime,
    _resume_file: Option<String>,
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
    plotter_runtime.is_running.store(true, Ordering::SeqCst);

    log::info!("Starting plotter execution for {} warps at {}", warps, drive_path);

    // Clone values for the background task
    let mining_state_clone = mining_state.clone();
    let plotter_runtime_clone = plotter_runtime.clone();
    let app_handle_clone = app_handle.clone();
    let drive_path_clone = drive_path.clone();

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
        if let Ok(mut state) = mining_state_clone.lock() {
            state.plotting_status = PlottingStatus::Idle;
        }
        plotter_runtime_clone.is_running.store(false, Ordering::SeqCst);

        // Process the result and emit events
        match result {
            Ok((Ok(()), duration, path)) => {
                log::info!("Plot completed successfully: {} warps", warps);
                let _ = app_handle_clone.emit(
                    "plotter:item-complete",
                    serde_json::json!({
                        "type": "plot",
                        "path": path,
                        "success": true,
                        "warpsPlotted": warps,
                        "durationMs": duration.as_millis() as u64,
                    }),
                );
            }
            Ok((Err(e), duration, path)) => {
                log::error!("Plot failed: {}", e);
                let _ = app_handle_clone.emit(
                    "plotter:item-complete",
                    serde_json::json!({
                        "type": "plot",
                        "path": path,
                        "success": false,
                        "warpsPlotted": 0,
                        "durationMs": duration.as_millis() as u64,
                        "error": e.to_string(),
                    }),
                );
            }
            Err(e) => {
                log::error!("Plotter task panicked: {}", e);
                let _ = app_handle_clone.emit(
                    "plotter:item-complete",
                    serde_json::json!({
                        "type": "plot",
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
) -> Result<pocx_plotter::PlotterTask, String> {
    build_plotter_task_batch(address, &[BatchPlotOutput { path: output_path.to_string(), warps }], config)
}

/// Build a PlotterTask from configuration with multiple outputs (batch mode)
fn build_plotter_task_batch(
    address: &str,
    outputs: &[BatchPlotOutput],
    config: &MiningConfig,
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
