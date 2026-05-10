//! Tauri command handlers for the pools module.

use super::cache::{read_cache, write_cache};
use super::merger::merge;
use super::resolver::{resolve_pools, HickoryPoolResolver};
use super::{static_pools_for, NetworkScope, PoolEntry};
use crate::mining::commands::CommandResult;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

const CACHE_FILE: &str = "pools_cache.json";

fn cache_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(CACHE_FILE)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PoolsUpdatedPayload {
    network: String,
    pools: Vec<PoolEntry>,
}

/// Return cached pools immediately; spawn a background refresh that emits
/// `pools:updated` when fresh data lands. If the cache is empty, the static
/// fallback is returned synchronously so the UI is never blank.
#[tauri::command]
pub async fn list_pools(app: AppHandle, network: String) -> CommandResult<Vec<PoolEntry>> {
    let Some(scope) = NetworkScope::parse(&network) else {
        return CommandResult::ok(Vec::new());
    };

    let path = cache_path(&app);
    let cached = read_cache(&path, scope_str(scope));
    let immediate = if cached.is_empty() {
        static_pools_for(scope)
    } else {
        cached
    };

    // Fire-and-forget background refresh.
    let app_for_bg = app.clone();
    let net_label = network.clone();
    tokio::spawn(async move {
        if let Err(e) = background_refresh(&app_for_bg, scope, &net_label).await {
            log::warn!("Pool DNS refresh failed: {}", e);
            let _ = app_for_bg.emit("pools:dns-failed", net_label);
        }
    });

    CommandResult::ok(immediate)
}

/// Force a synchronous DNS lookup; updates the cache; emits `pools:updated`.
#[tauri::command]
pub async fn refresh_pools(app: AppHandle, network: String) -> CommandResult<Vec<PoolEntry>> {
    let Some(scope) = NetworkScope::parse(&network) else {
        return CommandResult::ok(Vec::new());
    };
    match background_refresh(&app, scope, &network).await {
        Ok(pools) => CommandResult::ok(pools),
        Err(e) => CommandResult::err(format!("Pool refresh failed: {}", e)),
    }
}

async fn background_refresh(
    app: &AppHandle,
    scope: NetworkScope,
    network_label: &str,
) -> Result<Vec<PoolEntry>, String> {
    let resolver = HickoryPoolResolver::from_system_or_default();
    let discovered = resolve_pools(&resolver, scope, &[])
        .await
        .map_err(|e| e.to_string())?;
    let merged = merge(scope, &discovered);
    let path = cache_path(app);
    let _ = write_cache(&path, scope_str(scope), &merged);
    let _ = app.emit(
        "pools:updated",
        PoolsUpdatedPayload {
            network: network_label.to_string(),
            pools: merged.clone(),
        },
    );
    Ok(merged)
}

fn scope_str(scope: NetworkScope) -> &'static str {
    match scope {
        NetworkScope::Mainnet => "mainnet",
        NetworkScope::Testnet => "testnet",
    }
}
