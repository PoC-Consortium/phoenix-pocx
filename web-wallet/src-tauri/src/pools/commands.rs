//! Tauri command handlers for the pools module.

use super::{static_pools_for, NetworkScope, PoolEntry};
use crate::mining::commands::CommandResult;

/// Return the merged pool list for the given network.
///
/// In Phase 1 this is static-only. Phase 3 wires in DNS discovery + cache.
#[tauri::command]
pub async fn list_pools(network: String) -> CommandResult<Vec<PoolEntry>> {
    let Some(scope) = NetworkScope::parse(&network) else {
        return CommandResult::ok(Vec::new()); // regtest etc.
    };
    CommandResult::ok(static_pools_for(scope))
}
