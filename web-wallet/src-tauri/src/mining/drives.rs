//! Drive detection and plot file scanning
//!
//! Detects available drives and scans for existing plot files.

use serde::{Deserialize, Serialize};
use std::path::Path;
use sysinfo::Disks;

/// Drive information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub path: String,
    pub label: String,
    pub total_gib: f64,
    pub free_gib: f64,
    pub is_system_drive: bool,
    pub complete_files: u32,       // .pocx files (ready for mining)
    pub complete_size_gib: f64,    // Size of complete files
    pub incomplete_files: u32,     // .tmp files (can resume)
    pub incomplete_size_gib: f64,  // Size of incomplete files
    pub volume_id: Option<String>, // Volume GUID for same-drive detection (handles mount points)
}

/// Plot file scan results
#[derive(Debug, Default)]
struct PlotFileScan {
    complete_count: u32,
    complete_bytes: u64,
    incomplete_count: u32,
    incomplete_bytes: u64,
}

/// Get the volume GUID for a given path (Windows only)
/// This correctly identifies the actual physical volume even for mount points
#[cfg(target_os = "windows")]
fn get_volume_guid(path: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetVolumeNameForVolumeMountPointW;

    let mut path_wide: Vec<u16> = OsStr::new(path).encode_wide().collect();
    // Ensure path ends with backslash
    if !path.ends_with('\\') {
        path_wide.push('\\' as u16);
    }
    path_wide.push(0); // null terminator

    let mut volume_name: [u16; 50] = [0; 50];

    let result = unsafe {
        GetVolumeNameForVolumeMountPointW(
            path_wide.as_ptr(),
            volume_name.as_mut_ptr(),
            volume_name.len() as u32,
        )
    };

    if result != 0 {
        let len = volume_name.iter().position(|&c| c == 0).unwrap_or(volume_name.len());
        Some(String::from_utf16_lossy(&volume_name[..len]))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn get_volume_guid(path: &str) -> Option<String> {
    // On Unix, use device ID as the volume identifier
    // This correctly identifies which filesystem a path belongs to
    use std::os::unix::fs::MetadataExt;

    std::fs::metadata(path)
        .map(|m| format!("dev:{}", m.dev()))
        .ok()
}

/// Check if this path is on the actual system volume (not a mountpoint to another drive)
#[cfg(target_os = "windows")]
fn is_system_drive_path(mount_point: &str) -> bool {
    // Get system volume GUID (C:\)
    let system_volume = get_volume_guid("C:\\");
    // Get volume GUID for the given path
    let path_volume = get_volume_guid(mount_point);

    match (system_volume, path_volume) {
        (Some(sys), Some(path)) => sys == path,
        // Fallback: if we can't get volume GUIDs, only treat exact C:\ as system drive
        _ => {
            let upper = mount_point.to_uppercase();
            upper == "C:\\" || upper == "C:"
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn is_system_drive_path(mount_point: &str) -> bool {
    // Check if mount point is "/" OR if it's on the same device as root
    if mount_point == "/" {
        return true;
    }

    // Use device ID to check if the path is on the same filesystem as root
    use std::os::unix::fs::MetadataExt;

    let root_dev = std::fs::metadata("/").map(|m| m.dev()).ok();
    let path_dev = std::fs::metadata(mount_point).map(|m| m.dev()).ok();

    match (root_dev, path_dev) {
        (Some(root), Some(path)) => root == path,
        _ => mount_point == "/", // Fallback
    }
}

/// Check if filename matches PoCX plot file pattern
/// Format: {address}_{startNonce}_{nonceCount}_{compression}.pocx or .tmp
fn is_plot_filename(filename: &str) -> bool {
    // Must have at least 3 underscores: addr_start_nonces_comp.ext
    let parts: Vec<&str> = filename.split('_').collect();
    if parts.len() < 4 {
        return false;
    }
    // Last part should end with .pocx or .tmp
    let last = parts.last().unwrap_or(&"");
    last.ends_with(".pocx") || last.ends_with(".tmp")
}

/// Scan directory for plot files (.pocx and .tmp)
fn scan_plot_files(path: &str) -> PlotFileScan {
    let dir = Path::new(path);
    if !dir.exists() || !dir.is_dir() {
        return PlotFileScan::default();
    }

    let mut result = PlotFileScan::default();

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let file_path = entry.path();
            if !file_path.is_file() {
                continue;
            }

            let filename = match file_path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name,
                None => continue,
            };

            // Check if it matches plot file pattern
            if !is_plot_filename(filename) {
                continue;
            }

            let file_size = std::fs::metadata(&file_path)
                .map(|m| m.len())
                .unwrap_or(0);

            if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
                match ext {
                    "pocx" => {
                        result.complete_count += 1;
                        result.complete_bytes += file_size;
                    }
                    "tmp" => {
                        result.incomplete_count += 1;
                        result.incomplete_bytes += file_size;
                    }
                    _ => {}
                }
            }
        }
    }

    result
}

/// List available drives for plotting
pub fn list_drives() -> Vec<DriveInfo> {
    let disks = Disks::new_with_refreshed_list();
    let gib = 1024.0 * 1024.0 * 1024.0;

    disks
        .iter()
        .filter(|d| {
            // Filter out very small drives (< 10 GB)
            d.total_space() > 10 * 1024 * 1024 * 1024
        })
        .map(|d| {
            let mount_point = d.mount_point().to_string_lossy().to_string();
            let total_bytes = d.total_space() as f64;
            let free_bytes = d.available_space() as f64;
            let is_system = is_system_drive_path(&mount_point);

            let scan = scan_plot_files(&mount_point);

            DriveInfo {
                path: mount_point.clone(),
                label: d.name().to_string_lossy().to_string(),
                total_gib: total_bytes / gib,
                free_gib: free_bytes / gib,
                is_system_drive: is_system,
                complete_files: scan.complete_count,
                complete_size_gib: scan.complete_bytes as f64 / gib,
                incomplete_files: scan.incomplete_count,
                incomplete_size_gib: scan.incomplete_bytes as f64 / gib,
                volume_id: get_volume_guid(&mount_point),
            }
        })
        .collect()
}

/// Get drive info for a specific path
pub fn get_drive_info(path: &str) -> Option<DriveInfo> {
    let target_path = Path::new(path);
    let disks = Disks::new_with_refreshed_list();
    let gib = 1024.0 * 1024.0 * 1024.0;

    // Find the disk with the LONGEST matching mount point
    // This is critical for Linux where "/" matches everything, but we want
    // the most specific mount point (e.g., "/media/usb" over "/")
    let mut best_match: Option<(&sysinfo::Disk, usize)> = None;

    for disk in disks.iter() {
        let mount_point = disk.mount_point();
        if target_path.starts_with(mount_point) {
            let mount_len = mount_point.as_os_str().len();
            match &best_match {
                Some((_, best_len)) if mount_len <= *best_len => {
                    // Current match is not longer, skip
                }
                _ => {
                    // This is a longer (more specific) match
                    best_match = Some((disk, mount_len));
                }
            }
        }
    }

    // Build DriveInfo from the best matching disk
    best_match.map(|(disk, _)| {
        let mount_str = disk.mount_point().to_string_lossy().to_string();
        let total_bytes = disk.total_space() as f64;
        let free_bytes = disk.available_space() as f64;
        let is_system = is_system_drive_path(&mount_str);

        // Scan the specific path for plot files (not the mount point)
        let scan = scan_plot_files(path);

        DriveInfo {
            path: path.to_string(),
            label: disk.name().to_string_lossy().to_string(),
            total_gib: total_bytes / gib,
            free_gib: free_bytes / gib,
            is_system_drive: is_system,
            complete_files: scan.complete_count,
            complete_size_gib: scan.complete_bytes as f64 / gib,
            incomplete_files: scan.incomplete_count,
            incomplete_size_gib: scan.incomplete_bytes as f64 / gib,
            volume_id: get_volume_guid(path),
        }
    })
}
