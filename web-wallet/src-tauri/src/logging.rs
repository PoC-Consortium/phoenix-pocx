//! Logging configuration for Phoenix Wallet
//!
//! Uses log4rs with appenders:
//! 1. ConsoleAppender - stdout output
//! 2. RollingFileAppender - log files with rotation (desktop only)
//! 3. TauriEventAppender - forwards pocx_miner logs to frontend

use log::LevelFilter;
use log4rs::append::console::ConsoleAppender;
#[cfg(not(target_os = "android"))]
use log4rs::append::rolling_file::policy::compound::roll::fixed_window::FixedWindowRoller;
#[cfg(not(target_os = "android"))]
use log4rs::append::rolling_file::policy::compound::trigger::size::SizeTrigger;
#[cfg(not(target_os = "android"))]
use log4rs::append::rolling_file::policy::compound::CompoundPolicy;
#[cfg(not(target_os = "android"))]
use log4rs::append::rolling_file::RollingFileAppender;
use log4rs::config::{Appender, Config, Root};
use log4rs::encode::pattern::PatternEncoder;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

// ============================================================================
// App Handle Storage (for TauriEventAppender)
// ============================================================================

static APP_HANDLE: OnceLock<AppHandle<tauri::Wry>> = OnceLock::new();

/// Set the app handle for TauriEventAppender
/// Call this in Tauri's setup() after the app is initialized
pub fn set_app_handle(handle: AppHandle<tauri::Wry>) {
    match APP_HANDLE.set(handle) {
        Ok(_) => log::debug!("App handle set for TauriEventAppender"),
        Err(_) => log::warn!("App handle already set"),
    }
}

// ============================================================================
// Tauri Event Appender
// ============================================================================

/// Event payload for log messages
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent {
    level: String,
    message: String,
}

/// Custom log4rs appender that emits Tauri events for pocx_miner logs
#[derive(Debug)]
pub struct TauriEventAppender;

impl log4rs::append::Append for TauriEventAppender {
    fn append(&self, record: &log::Record) -> anyhow::Result<()> {
        // Only forward pocx_miner and pocx_plotter logs to frontend
        let target = record.target();
        if !target.starts_with("pocx_miner") && !target.starts_with("pocx_plotter") {
            return Ok(());
        }

        // Only forward info, warn, error (skip debug/trace)
        let level = match record.level() {
            log::Level::Error => "error",
            log::Level::Warn => "warn",
            log::Level::Info => "info",
            _ => return Ok(()), // Skip debug/trace
        };

        if let Some(handle) = APP_HANDLE.get() {
            let message = format!("{}", record.args());
            let _ = handle.emit(
                "miner:log",
                LogEvent {
                    level: level.to_string(),
                    message,
                },
            );
        }

        Ok(())
    }

    fn flush(&self) {}
}

// ============================================================================
// Logger Initialization
// ============================================================================

/// Initialize log4rs with console and Tauri event appenders
/// On desktop, also adds a rolling file appender
///
/// # Arguments
/// * `log_dir` - Directory for log files (ignored on Android)
///
/// # Log File Configuration (desktop only)
/// - File: `{log_dir}/phoenix.1.log`
/// - Max size: 20 MB per file
/// - Max count: 10 files (rotation)
/// - Pattern: `{timestamp} [{level}] {target} - {message}`
pub fn init_logger(log_dir: PathBuf) -> Result<log4rs::Handle, Box<dyn std::error::Error>> {
    // Console appender
    let console = ConsoleAppender::builder()
        .encoder(Box::new(PatternEncoder::new(
            "{d(%H:%M:%S)} [{l}] {t} - {m}{n}",
        )))
        .build();

    // Tauri event appender (for frontend Recent Activity)
    let tauri_events = TauriEventAppender;

    // Build config - on Android, skip file appender (permission issues)
    #[cfg(target_os = "android")]
    let config = {
        let _ = log_dir; // Suppress unused variable warning on Android
        Config::builder()
            .appender(Appender::builder().build("console", Box::new(console)))
            .appender(Appender::builder().build("tauri_events", Box::new(tauri_events)))
            .build(
                Root::builder()
                    .appender("console")
                    .appender("tauri_events")
                    .build(LevelFilter::Info),
            )?
    };

    #[cfg(not(target_os = "android"))]
    let config = {
        // Ensure log directory exists
        std::fs::create_dir_all(&log_dir)?;

        let log_file = log_dir.join("phoenix.1.log");
        let log_pattern = log_dir.join("phoenix.{}.log");

        // Rolling file appender (20MB per file, 10 files max)
        let roller = FixedWindowRoller::builder()
            .base(1)
            .build(log_pattern.to_str().unwrap(), 10)?;
        let trigger = SizeTrigger::new(20 * 1024 * 1024); // 20 MB
        let policy = CompoundPolicy::new(Box::new(trigger), Box::new(roller));

        let logfile = RollingFileAppender::builder()
            .encoder(Box::new(PatternEncoder::new(
                "{d(%Y-%m-%d %H:%M:%S)} [{l}] {t} - {m}{n}",
            )))
            .build(log_file, Box::new(policy))?;

        Config::builder()
            .appender(Appender::builder().build("console", Box::new(console)))
            .appender(Appender::builder().build("logfile", Box::new(logfile)))
            .appender(Appender::builder().build("tauri_events", Box::new(tauri_events)))
            .build(
                Root::builder()
                    .appender("console")
                    .appender("logfile")
                    .appender("tauri_events")
                    .build(LevelFilter::Info),
            )?
    };

    Ok(log4rs::init_config(config)?)
}
