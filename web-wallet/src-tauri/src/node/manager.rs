//! Node process management
//!
//! Handles starting, stopping, and monitoring the Bitcoin-PoCX daemon.

use super::config::NodeConfig;
use super::state::{NodeStatus, SharedNodeState};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

/// Process name to look for
#[cfg(target_os = "windows")]
const BITCOIND_PROCESS_NAME: &str = "bitcoind.exe";

#[cfg(not(target_os = "windows"))]
const BITCOIND_PROCESS_NAME: &str = "bitcoind";

/// Manages the Bitcoin-PoCX daemon process
pub struct NodeManager {
    /// Child process handle (if we spawned it)
    process: Mutex<Option<Child>>,
}

impl Default for NodeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl NodeManager {
    /// Create a new node manager
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    /// Check if bitcoind is running by looking for the process
    pub fn is_node_running() -> bool {
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new());

        for process in sys.processes().values() {
            let name = process.name().to_string_lossy().to_lowercase();
            if name == BITCOIND_PROCESS_NAME.to_lowercase() {
                return true;
            }
        }
        false
    }

    /// Find the PID of a running bitcoind process
    pub fn find_node_pid() -> Option<u32> {
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new());

        for (pid, process) in sys.processes() {
            let name = process.name().to_string_lossy().to_lowercase();
            if name == BITCOIND_PROCESS_NAME.to_lowercase() {
                return Some(pid.as_u32());
            }
        }
        None
    }

    /// Start the managed node
    pub fn start(&self, state: &SharedNodeState, app: &AppHandle) -> Result<u32, String> {
        log::info!("Starting managed node...");

        // Check if already running
        if let Some(pid) = Self::find_node_pid() {
            log::info!("Node already running with PID {}", pid);
            state.set_managed_pid(Some(pid));

            // Emit event
            let _ = app.emit("node:started", serde_json::json!({ "pid": pid }));

            return Ok(pid);
        }

        // Get configuration
        let config = state.get_config();

        // Ensure bitcoind exists
        let bitcoind_path = NodeConfig::bitcoind_path();
        if !bitcoind_path.exists() {
            return Err(format!(
                "bitcoind not found at {}. Please download it first.",
                bitcoind_path.display()
            ));
        }

        // Ensure data directory exists
        let data_dir = config.get_data_directory();
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;

        // Write bitcoin.conf if it doesn't exist or if in managed mode
        let conf_path = config.bitcoin_conf_path();
        if config.mode == super::config::NodeMode::Managed || !conf_path.exists() {
            config.write_bitcoin_conf()?;
        }

        // Emit starting event
        let _ = app.emit("node:starting", ());

        // Build command
        let mut cmd = Command::new(&bitcoind_path);

        // Add data directory
        cmd.arg(format!("-datadir={}", data_dir.display()));

        // Add network flag if not mainnet
        match config.network {
            super::config::Network::Testnet => {
                cmd.arg("-testnet");
            }
            super::config::Network::Regtest => {
                cmd.arg("-regtest");
            }
            super::config::Network::Mainnet => {}
        }

        // Add custom args if any
        if !config.custom_args.is_empty() {
            for arg in config.custom_args.split_whitespace() {
                cmd.arg(arg);
            }
        }

        // Configure stdio - redirect to null to prevent blocking
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
        cmd.stdin(Stdio::null());

        // On Windows, prevent console window from appearing
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // Start the process
        log::info!("Starting bitcoind: {:?}", cmd);
        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start bitcoind: {}", e))?;

        let pid = child.id();
        log::info!("bitcoind started with PID {}", pid);

        // Store the child process
        *self.process.lock().unwrap() = Some(child);

        // Update state
        state.set_managed_pid(Some(pid));
        state.update_status(|s| {
            s.running = true;
            s.error = None;
        });

        // Emit started event
        let _ = app.emit("node:started", serde_json::json!({ "pid": pid }));

        Ok(pid)
    }

    /// Stop the managed node gracefully using RPC stop command
    ///
    /// Sends the RPC `stop` command and returns immediately.
    /// The node will shut down gracefully on its own - no need to wait.
    /// This is how bitcoin-qt works: it sends stop and lets the node finish.
    pub fn stop(&self, state: &SharedNodeState, app: &AppHandle) -> Result<(), String> {
        log::info!("Stopping managed node...");

        // Emit stopping event
        let _ = app.emit("node:stopping", ());

        // Send RPC stop command - this initiates graceful shutdown
        let config = state.get_config();
        let rpc_result = std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().ok()?;
            rt.block_on(async { super::rpc::stop_node_gracefully(&config).await.ok() })
        })
        .join();

        match rpc_result {
            Ok(Some(_)) => {
                log::info!("RPC stop command sent - node will shutdown gracefully");
            }
            _ => {
                log::warn!(
                    "RPC stop command failed - node may not be running or RPC not available"
                );
            }
        }

        // Clear our process handle (we don't own it anymore)
        *self.process.lock().unwrap() = None;

        // Update state - node is stopping (may still be running briefly)
        state.set_managed_pid(None);
        state.update_status(|s| {
            s.running = false;
            s.pid = None;
            s.peers = 0;
        });

        // Emit stopped event
        let _ = app.emit("node:stopped", ());

        Ok(())
    }

    /// Restart the managed node
    pub fn restart(&self, state: &SharedNodeState, app: &AppHandle) -> Result<u32, String> {
        log::info!("Restarting managed node...");

        self.stop(state, app)?;

        // Wait a moment for the process to fully stop
        std::thread::sleep(std::time::Duration::from_millis(1000));

        self.start(state, app)
    }

    /// Update the node status by checking if process is running
    /// Note: RPC queries for blockchain info will be done separately
    pub fn refresh_status(state: &SharedNodeState, app: &AppHandle) -> NodeStatus {
        let config = state.get_config();

        // Check if process is running
        let is_running = Self::is_node_running();
        let pid = Self::find_node_pid();

        // Update PID in state if we found one
        if pid != state.get_managed_pid() {
            state.set_managed_pid(pid);
        }

        // Update status
        state.update_status(|s| {
            s.running = is_running;
            s.pid = pid;
            s.installed = NodeConfig::bitcoind_path().exists();
            s.network = config.network.as_str().to_string();
            s.version = config.installed_version.clone();
        });

        let status = state.get_status();

        // Emit status change
        let _ = app.emit("node:status-changed", &status);

        status
    }

    /// Detect if a node is already running (crash recovery)
    pub fn detect_existing_node(state: &SharedNodeState) -> Option<u32> {
        if let Some(pid) = Self::find_node_pid() {
            log::info!("Detected existing bitcoind process with PID {}", pid);
            state.set_managed_pid(Some(pid));
            state.update_status(|s| {
                s.running = true;
                s.pid = Some(pid);
            });
            return Some(pid);
        }
        None
    }

    /// Check if we have the child process handle (we started it)
    pub fn has_process_handle(&self) -> bool {
        self.process.lock().unwrap().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_manager_creation() {
        let manager = NodeManager::new();
        assert!(!manager.has_process_handle());
    }
}
