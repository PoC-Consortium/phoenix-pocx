//! GitHub releases API and file download
//!
//! Handles fetching release information and downloading node binaries.

use super::config::{GITHUB_REPO_NAME, GITHUB_REPO_OWNER};
use super::state::{DownloadProgress, DownloadStage, SharedNodeState};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Information about a GitHub release
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    /// Version string (e.g., "v26.0.0")
    pub version: String,
    /// Git tag name
    pub tag: String,
    /// Release date (ISO 8601)
    pub date: String,
    /// Release notes / body
    pub release_notes: String,
    /// Available assets (downloads)
    pub assets: Vec<ReleaseAsset>,
    /// Whether this is a prerelease
    pub prerelease: bool,
}

/// A downloadable asset from a release
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    /// File name
    pub name: String,
    /// Download URL
    pub download_url: String,
    /// File size in bytes
    pub size: u64,
    /// SHA256 hash (extracted from GitHub digest)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// Update information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// Whether an update is available
    pub available: bool,
    /// Currently installed version
    pub current_version: Option<String>,
    /// Latest available version
    pub latest_version: Option<String>,
    /// Release information (if update available)
    pub release_info: Option<ReleaseInfo>,
}

/// GitHub API response for a release
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

/// GitHub API response for an asset
#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    /// SHA256 digest in format "sha256:hash"
    digest: Option<String>,
}

impl From<GitHubRelease> for ReleaseInfo {
    fn from(release: GitHubRelease) -> Self {
        let version = release
            .name
            .unwrap_or_else(|| release.tag_name.clone())
            .trim_start_matches('v')
            .to_string();

        Self {
            version,
            tag: release.tag_name,
            date: release.published_at.unwrap_or_default(),
            release_notes: release.body.unwrap_or_default(),
            prerelease: release.prerelease,
            assets: release.assets.into_iter().map(|a| a.into()).collect(),
        }
    }
}

impl From<GitHubAsset> for ReleaseAsset {
    fn from(asset: GitHubAsset) -> Self {
        // Extract SHA256 hash from digest (format: "sha256:hash")
        let sha256 = asset.digest.and_then(|d| {
            d.strip_prefix("sha256:").map(|h| h.to_string())
        });

        Self {
            name: asset.name,
            download_url: asset.browser_download_url,
            size: asset.size,
            sha256,
        }
    }
}

/// Get the platform-specific archive name pattern
/// These patterns match the actual release file names on GitHub
pub fn get_platform_archive_pattern() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "win64"  // Matches win64-setup.exe or win64.zip
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"  // Matches .zip or .tar.gz
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "arm64-apple-darwin"  // Matches .zip or .tar.gz
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-linux-gnu"  // Matches .tar.gz
    }

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-linux-gnu"  // Matches .tar.gz
    }

    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    {
        "unknown"
    }
}

/// Find the appropriate asset for the current platform
pub fn find_platform_asset(assets: &[ReleaseAsset]) -> Option<&ReleaseAsset> {
    let pattern = get_platform_archive_pattern();
    let matching: Vec<_> = assets.iter().filter(|a| a.name.contains(pattern)).collect();

    if matching.is_empty() {
        return None;
    }

    // On macOS, prefer .tar.gz over .zip (zip only contains Qt app, no bitcoind)
    #[cfg(target_os = "macos")]
    {
        if let Some(asset) = matching.iter().find(|a| a.name.ends_with(".tar.gz")) {
            return Some(asset);
        }
    }

    // On Windows, prefer .zip over .exe (exe is NSIS installer, harder to extract)
    #[cfg(target_os = "windows")]
    {
        if let Some(asset) = matching.iter().find(|a| a.name.ends_with(".zip")) {
            return Some(asset);
        }
    }

    // Default: return first match
    matching.into_iter().next()
}

/// Create HTTP client with appropriate headers
fn create_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Phoenix-PoCX-Wallet/2.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// Fetch the latest release from GitHub
pub async fn fetch_latest_release() -> Result<ReleaseInfo, String> {
    let client = create_client()?;
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_REPO_OWNER, GITHUB_REPO_NAME
    );

    log::info!("Fetching latest release from {}", url);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API returned status {}",
            response.status()
        ));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release: {}", e))?;

    Ok(release.into())
}

/// Fetch all releases from GitHub
pub async fn fetch_all_releases() -> Result<Vec<ReleaseInfo>, String> {
    let client = create_client()?;
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases",
        GITHUB_REPO_OWNER, GITHUB_REPO_NAME
    );

    log::info!("Fetching all releases from {}", url);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API returned status {}",
            response.status()
        ));
    }

    let releases: Vec<GitHubRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse releases: {}", e))?;

    Ok(releases.into_iter().map(|r| r.into()).collect())
}

/// Fetch SHA256SUMS file from a release
pub async fn fetch_sha256sums(release: &ReleaseInfo) -> Result<String, String> {
    // Look for SHA256SUMS or similar file
    let sums_asset = release
        .assets
        .iter()
        .find(|a| a.name.to_uppercase().contains("SHA256SUMS"))
        .ok_or_else(|| "SHA256SUMS file not found in release".to_string())?;

    let client = create_client()?;

    log::info!("Fetching SHA256SUMS from {}", sums_asset.download_url);

    let response = client
        .get(&sums_asset.download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch SHA256SUMS: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download SHA256SUMS: status {}",
            response.status()
        ));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read SHA256SUMS: {}", e))
}

/// Parse SHA256SUMS content and find hash for a specific file
pub fn find_hash_for_file(sha256sums: &str, filename: &str) -> Option<String> {
    for line in sha256sums.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let hash = parts[0];
            let file = parts[1].trim_start_matches('*');
            if file == filename || file.ends_with(filename) {
                return Some(hash.to_lowercase());
            }
        }
    }
    None
}

/// Download a file with progress reporting
pub async fn download_file(
    url: &str,
    dest: PathBuf,
    state: &SharedNodeState,
    app: &AppHandle,
) -> Result<PathBuf, String> {
    let client = create_client()?;

    log::info!("Downloading {} to {}", url, dest.display());

    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Start the download
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    let filename = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    // Initialize progress
    let mut progress = DownloadProgress {
        downloaded: 0,
        total: total_size,
        speed: 0.0,
        stage: DownloadStage::Downloading,
        file_name: filename.clone(),
    };
    state.set_download_progress(Some(progress.clone()));
    let _ = app.emit("node:download-progress", &progress);

    // Open file for writing
    let mut file =
        File::create(&dest).map_err(|e| format!("Failed to create file: {}", e))?;

    // Download with progress
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;

        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        downloaded += chunk.len() as u64;

        // Update progress (throttle to avoid too many events)
        if last_emit.elapsed().as_millis() >= 100 {
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                downloaded as f64 / elapsed
            } else {
                0.0
            };

            progress.downloaded = downloaded;
            progress.speed = speed;

            state.set_download_progress(Some(progress.clone()));
            let _ = app.emit("node:download-progress", &progress);
            last_emit = Instant::now();
        }
    }

    // Final progress update
    progress.downloaded = downloaded;
    progress.stage = DownloadStage::Complete;
    state.set_download_progress(Some(progress.clone()));
    let _ = app.emit("node:download-progress", &progress);

    log::info!("Download complete: {} bytes", downloaded);

    Ok(dest)
}

/// Normalize version string for comparison (strip 'v' prefix and lowercase)
fn normalize_version(version: &str) -> String {
    version.trim_start_matches('v').to_lowercase()
}

/// Check for updates
pub async fn check_for_update(state: &SharedNodeState) -> Result<UpdateInfo, String> {
    let current_version = state.get_installed_version();
    let release = fetch_latest_release().await?;

    let available = match &current_version {
        Some(current) => {
            // Compare using tag (not version) since installed version is stored as the tag
            // Normalize both to handle 'v' prefix differences
            let latest_normalized = normalize_version(&release.tag);
            let current_normalized = normalize_version(current);
            latest_normalized != current_normalized && !release.prerelease
        }
        None => true, // No version installed, update available
    };

    Ok(UpdateInfo {
        available,
        current_version,
        latest_version: Some(release.tag.clone()),
        release_info: if available { Some(release) } else { None },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_hash_for_file() {
        let sha256sums = r#"
abc123def456  bitcoin-26.0.0-win64.zip
789xyz000111  bitcoin-26.0.0-x86_64-linux-gnu.tar.gz
"#;

        let hash = find_hash_for_file(sha256sums, "bitcoin-26.0.0-win64.zip");
        assert_eq!(hash, Some("abc123def456".to_string()));

        let hash = find_hash_for_file(sha256sums, "nonexistent.zip");
        assert_eq!(hash, None);
    }

    #[test]
    fn test_platform_pattern() {
        let pattern = get_platform_archive_pattern();
        assert!(!pattern.is_empty());
    }
}
