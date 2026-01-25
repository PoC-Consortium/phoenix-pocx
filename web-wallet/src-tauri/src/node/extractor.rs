//! Archive extraction for node binaries
//!
//! Handles extracting bitcoind from zip (Windows), tar.gz (Linux), and dmg (macOS) archives.

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
    } else if archive_name.ends_with(".dmg") {
        #[cfg(target_os = "macos")]
        {
            extract_from_dmg(archive_path, &bitcoind_dest)?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err("DMG extraction is only supported on macOS".to_string());
        }
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

        // Check if this is the bitcoind binary (in bin/ directory)
        if path_str.ends_with(&format!("bin/{}", BITCOIND_BINARY)) {
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

/// Extract bitcoind from a DMG disk image (macOS only)
#[cfg(target_os = "macos")]
fn extract_from_dmg(archive_path: &Path, dest: &Path) -> Result<(), String> {
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    // Create unique temp mount point using timestamp and process ID
    let unique_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mount_point = std::env::temp_dir().join(format!("phoenix-btc-{}-{}", std::process::id(), unique_id));

    fs::create_dir_all(&mount_point)
        .map_err(|e| format!("Failed to create mount point: {}", e))?;

    log::info!("Mounting DMG to {}", mount_point.display());

    // Mount DMG to our private mount point
    let mount_result = Command::new("hdiutil")
        .args([
            "attach",
            archive_path.to_str().ok_or("Invalid archive path")?,
            "-mountpoint",
            mount_point.to_str().ok_or("Invalid mount point path")?,
            "-nobrowse",
            "-readonly",
        ])
        .output()
        .map_err(|e| format!("Failed to run hdiutil: {}", e))?;

    if !mount_result.status.success() {
        let _ = fs::remove_dir(&mount_point);
        return Err(format!(
            "Failed to mount DMG: {}",
            String::from_utf8_lossy(&mount_result.stderr)
        ));
    }

    // Search for bitcoind in the mounted DMG
    // Bitcoin Core packages it inside an .app bundle
    let result = find_and_copy_bitcoind(&mount_point, dest);

    // Always unmount and clean up (even on error)
    log::info!("Unmounting DMG");
    let _ = Command::new("hdiutil")
        .args(["detach", mount_point.to_str().unwrap_or(""), "-force"])
        .output();

    // Remove our temp mount point directory
    let _ = fs::remove_dir(&mount_point);

    result
}

/// Find bitcoind in a mounted DMG and copy it to destination
#[cfg(target_os = "macos")]
fn find_and_copy_bitcoind(mount_point: &Path, dest: &Path) -> Result<(), String> {
    // Known locations in Bitcoin Core DMG
    let known_app_names = ["Bitcoin-Qt.app", "Bitcoin Core.app", "Bitcoin-PoCX.app"];

    // First try known .app locations
    for app_name in &known_app_names {
        let bitcoind_path = mount_point.join(app_name).join("Contents/MacOS/bitcoind");
        if bitcoind_path.exists() {
            log::info!("Found bitcoind at {}", bitcoind_path.display());
            return copy_bitcoind(&bitcoind_path, dest);
        }
    }

    // If not found, search for any .app bundle containing bitcoind
    if let Ok(entries) = fs::read_dir(mount_point) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "app").unwrap_or(false) {
                let bitcoind_path = path.join("Contents/MacOS/bitcoind");
                if bitcoind_path.exists() {
                    log::info!("Found bitcoind at {}", bitcoind_path.display());
                    return copy_bitcoind(&bitcoind_path, dest);
                }
            }
        }
    }

    // Also check for bitcoind directly in mount root (some archives)
    let direct_path = mount_point.join("bitcoind");
    if direct_path.exists() {
        log::info!("Found bitcoind at {}", direct_path.display());
        return copy_bitcoind(&direct_path, dest);
    }

    // Check bin/ directory
    let bin_path = mount_point.join("bin/bitcoind");
    if bin_path.exists() {
        log::info!("Found bitcoind at {}", bin_path.display());
        return copy_bitcoind(&bin_path, dest);
    }

    Err(format!("{} not found in DMG", BITCOIND_BINARY))
}

/// Copy bitcoind to destination
#[cfg(target_os = "macos")]
fn copy_bitcoind(src: &Path, dest: &Path) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    }

    fs::copy(src, dest)
        .map_err(|e| format!("Failed to copy bitcoind: {}", e))?;

    Ok(())
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
