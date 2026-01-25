//! Archive extraction for node binaries
//!
//! Handles extracting bitcoind from zip (Windows) and tar.gz (Linux/macOS) archives.

use super::config::NodeConfig;
use super::state::{DownloadStage, SharedNodeState};
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// Binary name to extract
#[cfg(target_os = "windows")]
const BITCOIND_BINARY: &str = "bitcoind.exe";

#[cfg(not(target_os = "windows"))]
const BITCOIND_BINARY: &str = "bitcoind";

/// Extract bitcoind from archive
pub fn extract_bitcoind(
    archive_path: &Path,
    state: &SharedNodeState,
    app: &AppHandle,
) -> Result<PathBuf, String> {
    log::info!("Extracting bitcoind from {}", archive_path.display());

    // Update progress
    let mut progress = state.get_download_progress().unwrap_or_default();
    progress.stage = DownloadStage::Extracting;
    state.set_download_progress(Some(progress.clone()));
    let _ = app.emit("node:download-progress", &progress);

    // Determine archive type and extract
    let archive_name = archive_path
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let dest_dir = NodeConfig::managed_node_dir();
    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create destination directory: {}", e))?;

    let bitcoind_dest = dest_dir.join(BITCOIND_BINARY);

    if archive_name.ends_with(".zip") {
        extract_from_zip(archive_path, &bitcoind_dest)?;
    } else if archive_name.ends_with(".exe") {
        // NSIS installer - extract using 7z (NSIS uses LZMA/7z internally)
        extract_from_7z(archive_path, &dest_dir)?;
    } else if archive_name.ends_with(".tar.gz") || archive_name.ends_with(".tgz") {
        extract_from_tar_gz(archive_path, &bitcoind_dest)?;
    } else {
        return Err(format!("Unknown archive format: {}", archive_name));
    }

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&bitcoind_dest)
            .map_err(|e| format!("Failed to get file permissions: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bitcoind_dest, perms)
            .map_err(|e| format!("Failed to set executable permission: {}", e))?;
    }

    // On macOS, clear quarantine attribute to allow unsigned binaries to run
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("xattr")
            .args(["-cr", bitcoind_dest.to_str().unwrap_or("")])
            .output();
        log::info!("Cleared quarantine attribute on bitcoind");
    }

    // Update progress
    progress.stage = DownloadStage::Complete;
    state.set_download_progress(Some(progress.clone()));
    let _ = app.emit("node:download-progress", &progress);

    log::info!("bitcoind extracted to {}", bitcoind_dest.display());

    Ok(bitcoind_dest)
}

/// Extract bitcoind from a ZIP archive (Windows)
fn extract_from_zip(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|e| format!("Failed to open archive: {}", e))?;

    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    // Find bitcoind in the archive by iterating through entries
    let mut bitcoind_entry_name: Option<String> = None;

    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name();
            if name.ends_with(BITCOIND_BINARY) && !name.contains("test") {
                bitcoind_entry_name = Some(name.to_string());
                break;
            }
        }
    }

    let entry_name = bitcoind_entry_name
        .ok_or_else(|| format!("{} not found in archive", BITCOIND_BINARY))?;

    log::info!("Found {} at {}", BITCOIND_BINARY, entry_name);

    // Extract the file
    let mut entry = archive
        .by_name(&entry_name)
        .map_err(|e| format!("Failed to access archive entry: {}", e))?;

    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    }

    let mut outfile =
        File::create(dest).map_err(|e| format!("Failed to create destination file: {}", e))?;

    io::copy(&mut entry, &mut outfile)
        .map_err(|e| format!("Failed to extract file: {}", e))?;

    Ok(())
}

/// Extract bitcoind from a 7z/NSIS archive (Windows .exe installers)
fn extract_from_7z(_archive_path: &Path, _dest_dir: &Path) -> Result<(), String> {
    Err("Windows NSIS installer extraction not supported. Please request a .zip release from Bitcoin-PoCX project.".to_string())
}

/// Extract bitcoind from a tar.gz archive (Unix)
fn extract_from_tar_gz(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|e| format!("Failed to open archive: {}", e))?;

    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);

    // Get all entries and find bitcoind
    let entries = archive
        .entries()
        .map_err(|e| format!("Failed to read tar archive: {}", e))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Failed to read tar entry: {}", e))?;

        let path = entry
            .path()
            .map_err(|e| format!("Failed to get entry path: {}", e))?;

        let path_str = path.to_string_lossy();

        // Check if this is the bitcoind binary (flexible search like zip extraction)
        // Matches: bin/bitcoind, Bitcoin-Qt.app/Contents/MacOS/bitcoind, or just bitcoind
        if path_str.ends_with(BITCOIND_BINARY) && !path_str.contains("test") {
            log::info!("Found {} at {}", BITCOIND_BINARY, path_str);

            // Ensure parent directory exists
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create destination directory: {}", e))?;
            }

            // Extract to destination
            let mut outfile = File::create(dest)
                .map_err(|e| format!("Failed to create destination file: {}", e))?;

            io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;

            return Ok(());
        }
    }

    Err(format!("{} not found in archive", BITCOIND_BINARY))
}

/// Clean up downloaded archive
pub fn cleanup_archive(archive_path: &Path) -> Result<(), String> {
    if archive_path.exists() {
        fs::remove_file(archive_path)
            .map_err(|e| format!("Failed to remove archive: {}", e))?;
        log::info!("Cleaned up archive: {}", archive_path.display());
    }
    Ok(())
}

/// Get the download directory for temporary files
pub fn get_download_dir() -> PathBuf {
    let dir = NodeConfig::managed_node_dir().join("downloads");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_download_dir() {
        let dir = get_download_dir();
        assert!(dir.ends_with("downloads"));
    }
}
