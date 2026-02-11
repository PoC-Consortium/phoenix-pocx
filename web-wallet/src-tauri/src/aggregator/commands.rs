//! Tauri command handlers for aggregator operations

use super::state::{
    save_config, AggregatorConfig, AggregatorStatus, SharedAggregatorState,
};
use crate::mining::commands::CommandResult;
use crate::node::state::SharedNodeState;
use serde::Serialize;
use tauri::State;

/// Aggregator status response
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregatorStatusResponse {
    pub status: AggregatorStatus,
    pub config: AggregatorConfig,
}

// ============================================================================
// Configuration Commands
// ============================================================================

/// Get aggregator configuration
#[tauri::command]
pub fn get_aggregator_config(
    state: State<SharedAggregatorState>,
) -> CommandResult<AggregatorConfig> {
    match state.lock() {
        Ok(inner) => CommandResult::ok(inner.config.clone()),
        Err(e) => CommandResult::err(format!("Failed to get aggregator config: {}", e)),
    }
}

/// Save aggregator configuration
#[tauri::command]
pub fn save_aggregator_config(
    config: AggregatorConfig,
    state: State<SharedAggregatorState>,
) -> CommandResult<()> {
    if let Err(e) = save_config(&config) {
        return CommandResult::err(format!("Failed to save config: {}", e));
    }

    match state.lock() {
        Ok(mut inner) => {
            inner.config = config;
            CommandResult::ok(())
        }
        Err(e) => CommandResult::err(format!("Failed to update state: {}", e)),
    }
}

// ============================================================================
// Lifecycle Commands
// ============================================================================

/// Start the aggregator
#[tauri::command]
pub async fn start_aggregator(
    state: State<'_, SharedAggregatorState>,
    node_state: State<'_, SharedNodeState>,
) -> Result<CommandResult<()>, ()> {
    // Get config and validate
    let config = {
        let mut inner = match state.lock() {
            Ok(guard) => guard,
            Err(e) => return Ok(CommandResult::err(format!("Failed to lock state: {}", e))),
        };

        if inner.status == (AggregatorStatus::Running {
            listen_address: String::new(),
        }) {
            // Check more precisely
            if matches!(inner.status, AggregatorStatus::Running { .. }) {
                return Ok(CommandResult::err("Aggregator is already running"));
            }
        }

        if matches!(inner.status, AggregatorStatus::Running { .. }) {
            return Ok(CommandResult::err("Aggregator is already running"));
        }

        inner.status = AggregatorStatus::Starting;
        inner.config.clone()
    };

    // Clear any previous stop request
    pocx_aggregator::clear_stop_request();

    // Build pocx_aggregator::Config
    let submission_mode = match config.submission_mode {
        super::state::AggregatorSubmissionMode::Wallet => {
            pocx_aggregator::config::SubmissionMode::Wallet
        }
        super::state::AggregatorSubmissionMode::Pool => {
            pocx_aggregator::config::SubmissionMode::Pool
        }
    };

    // Use node config for cookie auth and as fallback for upstream port
    let node_config = node_state.get_config();
    let effective_port = node_config.effective_rpc_port();
    let upstream_rpc_port = if config.upstream_rpc_port > 0 { config.upstream_rpc_port } else { effective_port };
    let listen_address = if config.listen_address.ends_with(":0") || config.listen_address.ends_with(":1") {
        format!("0.0.0.0:{}", effective_port + 1)
    } else {
        config.listen_address.clone()
    };

    // Build cookie path from node config for upstream RPC auth
    let data_dir = node_config.get_data_directory();
    let network_str = node_config.network.as_str();
    let cookie_path = crate::build_cookie_path(
        &data_dir.to_string_lossy(),
        network_str,
    );

    // Database path in app data dir
    let db_path = crate::app_data_dir().join("aggregator.db");

    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let agg_config = pocx_aggregator::Config {
        server: pocx_aggregator::config::ServerConfig {
            listen_address: listen_address,
            auth: Default::default(),
        },
        upstream: pocx_aggregator::config::UpstreamConfig {
            name: config.upstream_name.clone(),
            rpc_transport: pocx_aggregator::config::RpcTransport::Http,
            rpc_host: config.upstream_rpc_host.clone(),
            rpc_port: upstream_rpc_port,
            rpc_auth: pocx_aggregator::config::RpcAuth::Cookie {
                cookie_path: Some(cookie_path.to_string_lossy().to_string()),
            },
            submission_mode,
            block_time_secs: config.block_time_secs,
        },
        cache: Default::default(),
        database: pocx_aggregator::config::DatabaseConfig {
            path: db_path.to_string_lossy().to_string(),
            retention_days: 7,
        },
        dashboard: None, // Phoenix provides its own UI
        logging: pocx_aggregator::config::LoggingConfig {
            level: "info".to_string(),
            file: String::new(),
        },
    };

    // Clone state for the spawned task
    let state_clone = state.inner().clone();

    // Spawn aggregator in background task
    tokio::spawn(async move {
        log::info!("Aggregator task starting...");

        match pocx_aggregator::run_aggregator_safe(agg_config).await {
            Ok(()) => {
                log::info!("Aggregator task stopped normally");
            }
            Err(e) => {
                log::error!("Aggregator task failed: {}", e);
                if let Ok(mut inner) = state_clone.lock() {
                    inner.status = AggregatorStatus::Error {
                        message: e.to_string(),
                    };
                }
            }
        }

        // Ensure status is updated on exit
        if let Ok(mut inner) = state_clone.lock() {
            if matches!(inner.status, AggregatorStatus::Running { .. } | AggregatorStatus::Starting) {
                inner.status = AggregatorStatus::Stopped;
            }
        }

        log::info!("Aggregator task ended");
    });

    Ok(CommandResult::ok(()))
}

/// Stop the aggregator
#[tauri::command]
pub async fn stop_aggregator(
    state: State<'_, SharedAggregatorState>,
) -> Result<CommandResult<()>, ()> {
    log::info!("Stopping aggregator...");

    pocx_aggregator::request_stop();

    // Update state immediately
    if let Ok(mut inner) = state.lock() {
        inner.status = AggregatorStatus::Stopped;
    }

    Ok(CommandResult::ok(()))
}

// ============================================================================
// Status Commands
// ============================================================================

/// Check if aggregator is running
#[tauri::command]
pub fn is_aggregator_running(
    state: State<SharedAggregatorState>,
) -> CommandResult<bool> {
    match state.lock() {
        Ok(inner) => {
            let running = matches!(inner.status, AggregatorStatus::Running { .. });
            CommandResult::ok(running)
        }
        Err(e) => CommandResult::err(format!("Failed to check status: {}", e)),
    }
}

/// Get aggregator status
#[tauri::command]
pub fn get_aggregator_status(
    state: State<SharedAggregatorState>,
) -> CommandResult<AggregatorStatusResponse> {
    match state.lock() {
        Ok(inner) => CommandResult::ok(AggregatorStatusResponse {
            status: inner.status.clone(),
            config: inner.config.clone(),
        }),
        Err(e) => CommandResult::err(format!("Failed to get status: {}", e)),
    }
}

/// Get cached aggregator stats
#[tauri::command]
pub fn get_aggregator_stats(
    state: State<SharedAggregatorState>,
) -> CommandResult<Option<serde_json::Value>> {
    match state.lock() {
        Ok(inner) => CommandResult::ok(inner.last_stats.clone()),
        Err(e) => CommandResult::err(format!("Failed to get stats: {}", e)),
    }
}
