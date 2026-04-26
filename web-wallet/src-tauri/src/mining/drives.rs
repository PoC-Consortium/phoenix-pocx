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
    pub complete_files: u32,           // .pocx files (ready for mining)
    pub complete_size_gib: f64,        // Size of complete files
    pub incomplete_files: u32,         // Resumable .tmp files (matching current config)
    pub incomplete_size_gib: f64,      // Size of resumable .tmp files
    pub volume_id: Option<String>, // Volume GUID for same-drive detection (handles mount points)
    pub orphan_files: Vec<OrphanFile>, // .tmp files that can't be resumed under current config
}

/// Reason a .tmp file is considered an orphan (incompatible with current config)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OrphanReason {
    AddressMismatch,
    CompressionMismatch,
}

/// A .tmp file that can't be resumed under the current config.
/// Plotting is blocked until the user deletes the file (or restores matching settings).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanFile {
    pub filename: String,
    pub size_gib: f64,
    pub reason: OrphanReason,
    pub expected: String, // current config value
    pub actual: String,   // value embedded in .tmp filename
}

/// Parsed components of a `{addr}_{seed}_{warps}_X{compress}.tmp` filename.
/// Used both for orphan classification and for resume to recover the file's true warps
/// (the filename is the source of truth — preallocation can be partial on disk-full,
/// non-elevated Windows fallback, network mounts that ignore allocation hints, etc.).
#[derive(Debug, Clone)]
pub struct ParsedTmpFilename {
    pub addr_hex: String, // uppercase, 40 chars
    pub seed: [u8; 32],
    pub warps: u64,
    pub compression: u8,
}

pub fn parse_tmp_filename(filename: &str) -> Option<ParsedTmpFilename> {
    // Strip path components if a full path was passed.
    let basename = std::path::Path::new(filename)
        .file_name()
        .and_then(|n| n.to_str())?;
    let stripped = basename.strip_suffix(".tmp")?;
    let parts: Vec<&str> = stripped.split('_').collect();
    if parts.len() != 4 {
        return None;
    }
    let addr_hex = parts[0].to_uppercase();
    let seed_hex = parts[1].to_uppercase();
    if addr_hex.len() != 40 || seed_hex.len() != 64 {
        return None;
    }
    if !addr_hex.chars().all(|c| c.is_ascii_hexdigit())
        || !seed_hex.chars().all(|c| c.is_ascii_hexdigit())
    {
        return None;
    }
    let seed_bytes = hex::decode(&seed_hex).ok()?;
    if seed_bytes.len() != 32 {
        return None;
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&seed_bytes);
    let warps: u64 = parts[2].parse().ok()?;
    let compression: u8 = parts[3].strip_prefix('X')?.parse().ok()?;
    Some(ParsedTmpFilename {
        addr_hex,
        seed,
        warps,
        compression,
    })
}

/// Current config used to classify .tmp files. `None` skips classification —
/// every .tmp counts as incomplete (legacy behaviour, used before a config is set).
#[derive(Debug, Clone)]
pub struct ScanConfig {
    pub address_hex_upper: String, // 40-char hex of the 20-byte address payload
    pub compression: u8,
}

impl ScanConfig {
    /// Build from a MiningConfig. Returns `None` if the address can't be decoded
    /// (e.g. unconfigured wallet) — caller should treat that as "skip classification".
    pub fn from_mining_config(plotting_address: &str, compression: u8) -> Option<Self> {
        if plotting_address.is_empty() {
            return None;
        }
        let (payload, _network) = pocx_address::decode_address(plotting_address).ok()?;
        Some(Self {
            address_hex_upper: hex::encode_upper(payload),
            compression,
        })
    }
}

/// Plot file scan results
#[derive(Debug, Default)]
struct PlotFileScan {
    complete_count: u32,
    complete_bytes: u64,
    incomplete_count: u32,
    incomplete_bytes: u64,
    orphan_files: Vec<OrphanFile>,
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
        let len = volume_name
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(volume_name.len());
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

/// Scan directory for plot files (.pocx and .tmp).
///
/// When `scan_config` is `Some`, .tmp files are classified against the current
/// config: matches go into `incomplete_*`, mismatches go into `orphan_files`.
/// When `None`, every .tmp counts as incomplete (used before any config is set).
fn scan_plot_files(path: &str, scan_config: Option<&ScanConfig>) -> PlotFileScan {
    let gib = 1024.0 * 1024.0 * 1024.0;
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

            let file_size = std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);

            if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
                match ext {
                    "pocx" => {
                        result.complete_count += 1;
                        result.complete_bytes += file_size;
                    }
                    "tmp" => {
                        // Classify against current config if provided.
                        let orphan = match (scan_config, parse_tmp_filename(filename)) {
                            (Some(cfg), Some(parsed)) => {
                                if parsed.addr_hex != cfg.address_hex_upper {
                                    Some(OrphanFile {
                                        filename: filename.to_string(),
                                        size_gib: file_size as f64 / gib,
                                        reason: OrphanReason::AddressMismatch,
                                        expected: cfg.address_hex_upper.clone(),
                                        actual: parsed.addr_hex,
                                    })
                                } else if parsed.compression != cfg.compression {
                                    Some(OrphanFile {
                                        filename: filename.to_string(),
                                        size_gib: file_size as f64 / gib,
                                        reason: OrphanReason::CompressionMismatch,
                                        expected: format!("X{}", cfg.compression),
                                        actual: format!("X{}", parsed.compression),
                                    })
                                } else {
                                    None
                                }
                            }
                            // No config or unparseable filename → treat as resumable
                            // (legacy behaviour; the resume code will surface its own
                            // error if the file is genuinely unusable).
                            _ => None,
                        };

                        if let Some(orphan_file) = orphan {
                            result.orphan_files.push(orphan_file);
                        } else {
                            result.incomplete_count += 1;
                            result.incomplete_bytes += file_size;
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    result
}

/// List available drives for plotting.
///
/// Pass `Some(scan_config)` to classify .tmp files against the current config —
/// mismatched files end up in `orphan_files`, matching files in `incomplete_*`.
pub fn list_drives(scan_config: Option<&ScanConfig>) -> Vec<DriveInfo> {
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

            let scan = scan_plot_files(&mount_point, scan_config);

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
                orphan_files: scan.orphan_files,
            }
        })
        .collect()
}

/// Get drive info for a specific path.
///
/// Pass `Some(scan_config)` to classify .tmp files against the current config.
pub fn get_drive_info(path: &str, scan_config: Option<&ScanConfig>) -> Option<DriveInfo> {
    // On Android, sysinfo::Disks doesn't work properly for app storage paths
    // Use statvfs to get space info directly from the path
    #[cfg(target_os = "android")]
    {
        return get_drive_info_android(path, scan_config);
    }

    #[cfg(not(target_os = "android"))]
    {
        let target_path = Path::new(path);
        let gib = 1024.0 * 1024.0 * 1024.0;
        let disks = Disks::new_with_refreshed_list();

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
        let result = best_match.map(|(disk, _)| {
            let mount_str = disk.mount_point().to_string_lossy().to_string();
            let total_bytes = disk.total_space() as f64;
            let free_bytes = disk.available_space() as f64;
            let is_system = is_system_drive_path(&mount_str);

            // Scan the specific path for plot files (not the mount point)
            let scan = scan_plot_files(path, scan_config);

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
                orphan_files: scan.orphan_files,
            }
        });

        if result.is_some() {
            return result;
        }

        // Fallback: sysinfo didn't find the drive (e.g., network mount)
        get_drive_info_fallback(path, scan_config)
    }
}

/// Android-specific drive info using statvfs
#[cfg(target_os = "android")]
fn get_drive_info_android(path: &str, scan_config: Option<&ScanConfig>) -> Option<DriveInfo> {
    use std::ffi::CString;
    use std::os::raw::c_char;

    let gib = 1024.0 * 1024.0 * 1024.0;
    let target_path = Path::new(path);

    // Create directory if it doesn't exist (Android may need this)
    if !target_path.exists() {
        if let Err(e) = std::fs::create_dir_all(target_path) {
            log::warn!("Failed to create directory {}: {}", path, e);
            // Continue anyway - we might still be able to get parent dir info
        }
    }

    // Get filesystem stats using statvfs
    #[repr(C)]
    struct Statvfs {
        f_bsize: u64,
        f_frsize: u64,
        f_blocks: u64,
        f_bfree: u64,
        f_bavail: u64,
        f_files: u64,
        f_ffree: u64,
        f_favail: u64,
        f_fsid: u64,
        f_flag: u64,
        f_namemax: u64,
    }

    extern "C" {
        fn statvfs(path: *const c_char, buf: *mut Statvfs) -> i32;
    }

    let c_path = match CString::new(path) {
        Ok(p) => p,
        Err(_) => return None,
    };

    let mut stat = Statvfs {
        f_bsize: 0,
        f_frsize: 0,
        f_blocks: 0,
        f_bfree: 0,
        f_bavail: 0,
        f_files: 0,
        f_ffree: 0,
        f_favail: 0,
        f_fsid: 0,
        f_flag: 0,
        f_namemax: 0,
    };

    let result = unsafe { statvfs(c_path.as_ptr(), &mut stat) };

    if result != 0 {
        log::warn!("statvfs failed for path: {}", path);
        return None;
    }

    let block_size = if stat.f_frsize > 0 {
        stat.f_frsize
    } else {
        stat.f_bsize
    };
    let total_bytes = (stat.f_blocks * block_size) as f64;
    let free_bytes = (stat.f_bavail * block_size) as f64;

    // Scan for plot files
    let scan = scan_plot_files(path, scan_config);

    // Extract a label from the path
    let label = target_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Storage")
        .to_string();

    Some(DriveInfo {
        path: path.to_string(),
        label,
        total_gib: total_bytes / gib,
        free_gib: free_bytes / gib,
        is_system_drive: false, // Android app storage is never system drive
        complete_files: scan.complete_count,
        complete_size_gib: scan.complete_bytes as f64 / gib,
        incomplete_files: scan.incomplete_count,
        incomplete_size_gib: scan.incomplete_bytes as f64 / gib,
        volume_id: get_volume_guid(path),
        orphan_files: scan.orphan_files,
    })
}

/// Fallback drive info using OS-native filesystem stat calls.
/// Used when sysinfo doesn't find the drive (e.g., network mounts like SMB/NFS).
#[cfg(all(unix, not(target_os = "android")))]
fn get_drive_info_fallback(path: &str, scan_config: Option<&ScanConfig>) -> Option<DriveInfo> {
    use std::ffi::CString;

    let gib = 1024.0 * 1024.0 * 1024.0;
    let target_path = Path::new(path);

    if !target_path.exists() {
        return None;
    }

    let c_path = CString::new(path).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };

    let result = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if result != 0 {
        log::warn!("statvfs fallback failed for path: {}", path);
        return None;
    }

    // Casts needed for cross-platform compat (these fields are u32/i64 on some targets)
    #[allow(clippy::unnecessary_cast)]
    let block_size = if stat.f_frsize > 0 {
        stat.f_frsize as u64
    } else {
        stat.f_bsize as u64
    };
    #[allow(clippy::unnecessary_cast)]
    let total_bytes = (stat.f_blocks as u64 * block_size) as f64;
    #[allow(clippy::unnecessary_cast)]
    let free_bytes = (stat.f_bavail as u64 * block_size) as f64;

    let scan = scan_plot_files(path, scan_config);

    let label = target_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Network Drive")
        .to_string();

    Some(DriveInfo {
        path: path.to_string(),
        label,
        total_gib: total_bytes / gib,
        free_gib: free_bytes / gib,
        is_system_drive: false,
        complete_files: scan.complete_count,
        complete_size_gib: scan.complete_bytes as f64 / gib,
        incomplete_files: scan.incomplete_count,
        incomplete_size_gib: scan.incomplete_bytes as f64 / gib,
        volume_id: get_volume_guid(path),
        orphan_files: scan.orphan_files,
    })
}

/// Fallback drive info using GetDiskFreeSpaceExW.
/// Used when sysinfo doesn't find the drive (e.g., network mounts like SMB/CIFS).
#[cfg(windows)]
fn get_drive_info_fallback(path: &str, scan_config: Option<&ScanConfig>) -> Option<DriveInfo> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let gib = 1024.0 * 1024.0 * 1024.0;
    let target_path = Path::new(path);

    if !target_path.exists() {
        return None;
    }

    let mut path_wide: Vec<u16> = OsStr::new(path).encode_wide().collect();
    path_wide.push(0); // null terminator

    let mut free_bytes_available: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut _total_free_bytes: u64 = 0;

    let result = unsafe {
        GetDiskFreeSpaceExW(
            path_wide.as_ptr(),
            &mut free_bytes_available,
            &mut total_bytes,
            &mut _total_free_bytes,
        )
    };

    if result == 0 {
        log::warn!("GetDiskFreeSpaceExW fallback failed for path: {}", path);
        return None;
    }

    let scan = scan_plot_files(path, scan_config);

    let label = target_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Network Drive")
        .to_string();

    Some(DriveInfo {
        path: path.to_string(),
        label,
        total_gib: total_bytes as f64 / gib,
        free_gib: free_bytes_available as f64 / gib,
        is_system_drive: false,
        complete_files: scan.complete_count,
        complete_size_gib: scan.complete_bytes as f64 / gib,
        incomplete_files: scan.incomplete_count,
        incomplete_size_gib: scan.incomplete_bytes as f64 / gib,
        volume_id: get_volume_guid(path),
        orphan_files: scan.orphan_files,
    })
}
