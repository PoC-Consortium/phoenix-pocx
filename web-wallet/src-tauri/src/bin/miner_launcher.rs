//! Phoenix PoCX Miner Launcher
//!
//! A small native binary that launches the main wallet app in mining-only mode.
//! This is used for the macOS "Phoenix PoCX Miner.app" wrapper to avoid
//! Rosetta prompts that occur with shell script executables.

use std::process::Command;
use std::path::PathBuf;
use std::env;

fn main() {
    let main_app_name = "Phoenix PoCX Wallet.app";

    // Get the path to this executable
    let exe_path = env::current_exe().unwrap_or_default();

    // The launcher is at: Miner.app/Contents/MacOS/phoenix-pocx-miner
    // So the Miner.app is 3 levels up
    let miner_app_dir = exe_path
        .parent() // MacOS
        .and_then(|p| p.parent()) // Contents
        .and_then(|p| p.parent()); // Miner.app

    // The main app might be in the same directory as the Miner app (e.g., in DMG)
    let same_folder = miner_app_dir
        .and_then(|p| p.parent())
        .map(|p| p.join(main_app_name));

    // Search locations
    let search_paths = [
        same_folder,
        Some(PathBuf::from("/Applications").join(main_app_name)),
        dirs::home_dir().map(|h| h.join("Applications").join(main_app_name)),
    ];

    // Find the main app
    let main_app = search_paths
        .into_iter()
        .flatten()
        .find(|p| p.exists());

    match main_app {
        Some(app_path) => {
            // Launch the main app with --mining-only
            let status = Command::new("open")
                .args(["-a", app_path.to_str().unwrap_or(""), "--args", "--mining-only"])
                .status();

            if let Err(e) = status {
                show_error(&format!("Failed to launch wallet: {}", e));
            }
        }
        None => {
            show_error("Phoenix PoCX Wallet is required but not found.\n\nPlease install the main wallet application first.");
        }
    }
}

fn show_error(message: &str) {
    // Use osascript to show a native dialog on macOS
    let _ = Command::new("osascript")
        .args([
            "-e",
            &format!(
                r#"display dialog "{}" buttons {{"OK"}} default button "OK" with icon stop with title "Phoenix PoCX Miner""#,
                message.replace('"', "\\\"")
            ),
        ])
        .status();
}
