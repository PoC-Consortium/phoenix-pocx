//! Update checking module for Phoenix wallet
//!
//! Provides commands to check for wallet updates from GitHub releases.

use serde::{Deserialize, Serialize};

/// Information about a wallet update
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletUpdateInfo {
    /// Whether an update is available
    pub available: bool,
    /// Current wallet version
    pub current_version: String,
    /// Latest version from GitHub (if available)
    pub latest_version: Option<String>,
    /// URL to the release page
    pub release_url: Option<String>,
    /// Release notes/body
    pub release_notes: Option<String>,
    /// When the release was published
    pub published_at: Option<String>,
}

/// GitHub release response structure
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: Option<String>,
}

/// Get the current app version from Cargo.toml
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Check for wallet updates from GitHub releases
#[tauri::command]
pub async fn check_wallet_update() -> Result<WalletUpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION");

    // Fetch latest release from GitHub API
    let client = reqwest::Client::builder()
        .user_agent("Phoenix-PoCX-Wallet")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get("https://api.github.com/repos/PoC-Consortium/phoenix-pocx/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release info: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    // Parse version from tag (strip 'v' prefix if present)
    let latest_version = release.tag_name.trim_start_matches('v').to_string();

    // Compare versions
    let available = is_newer_version(&latest_version, current_version);

    Ok(WalletUpdateInfo {
        available,
        current_version: current_version.to_string(),
        latest_version: Some(latest_version),
        release_url: Some(release.html_url),
        release_notes: release.body,
        published_at: release.published_at,
    })
}

/// Parsed semantic version with optional pre-release tag
#[derive(Debug, Clone)]
struct SemVer {
    major: u32,
    minor: u32,
    patch: u32,
    /// Pre-release tag (e.g., "rc7", "beta1", "alpha"). None means final release.
    prerelease: Option<String>,
}

impl SemVer {
    fn parse(version: &str) -> Option<Self> {
        // Split on hyphen to separate version from pre-release
        let (version_part, prerelease) = match version.split_once('-') {
            Some((v, pre)) => (v, Some(pre.to_string())),
            None => (version, None),
        };

        let parts: Vec<&str> = version_part.split('.').collect();
        if parts.len() < 2 {
            return None;
        }

        Some(SemVer {
            major: parts.first()?.parse().ok()?,
            minor: parts.get(1)?.parse().ok()?,
            patch: parts.get(2).and_then(|p| p.parse().ok()).unwrap_or(0),
            prerelease,
        })
    }

    /// Compare pre-release tags. Returns ordering.
    /// None (final release) > Some (pre-release)
    fn compare_prerelease(a: &Option<String>, b: &Option<String>) -> std::cmp::Ordering {
        use std::cmp::Ordering;
        match (a, b) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater, // Final > pre-release
            (Some(_), None) => Ordering::Less,    // Pre-release < final
            (Some(a), Some(b)) => {
                // Extract numeric suffix if present (rc7 -> 7, beta2 -> 2)
                let extract_num = |s: &str| -> Option<u32> {
                    s.chars()
                        .rev()
                        .take_while(|c| c.is_ascii_digit())
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect::<String>()
                        .parse()
                        .ok()
                };

                let a_prefix = a.trim_end_matches(|c: char| c.is_ascii_digit());
                let b_prefix = b.trim_end_matches(|c: char| c.is_ascii_digit());

                // If same prefix (both "rc", both "beta"), compare numbers
                if a_prefix == b_prefix {
                    let a_num = extract_num(a).unwrap_or(0);
                    let b_num = extract_num(b).unwrap_or(0);
                    a_num.cmp(&b_num)
                } else {
                    // Different prefixes - compare lexicographically
                    // This handles alpha < beta < rc ordering
                    a.cmp(b)
                }
            }
        }
    }
}

/// Compare two semantic version strings
/// Returns true if `latest` is newer than `current`
fn is_newer_version(latest: &str, current: &str) -> bool {
    let latest_ver = match SemVer::parse(latest) {
        Some(v) => v,
        None => return false,
    };
    let current_ver = match SemVer::parse(current) {
        Some(v) => v,
        None => return true, // If we can't parse current, assume update available
    };

    // Compare major.minor.patch
    if latest_ver.major != current_ver.major {
        return latest_ver.major > current_ver.major;
    }
    if latest_ver.minor != current_ver.minor {
        return latest_ver.minor > current_ver.minor;
    }
    if latest_ver.patch != current_ver.patch {
        return latest_ver.patch > current_ver.patch;
    }

    // Same version numbers - compare pre-release tags
    SemVer::compare_prerelease(&latest_ver.prerelease, &current_ver.prerelease)
        == std::cmp::Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        // Basic version comparisons
        assert!(is_newer_version("2.0.1", "2.0.0"));
        assert!(is_newer_version("2.1.0", "2.0.0"));
        assert!(is_newer_version("3.0.0", "2.9.9"));
        assert!(!is_newer_version("2.0.0", "2.0.0"));
        assert!(!is_newer_version("1.9.9", "2.0.0"));

        // Pre-release comparisons
        assert!(is_newer_version("2.0.0", "2.0.0-rc7")); // Final > RC
        assert!(is_newer_version("2.0.0", "2.0.0-rc.1")); // Final > RC
        assert!(is_newer_version("2.0.0-rc8", "2.0.0-rc7")); // RC8 > RC7
        assert!(is_newer_version("2.0.0-rc10", "2.0.0-rc9")); // RC10 > RC9
        assert!(!is_newer_version("2.0.0-rc7", "2.0.0")); // RC < Final
        assert!(!is_newer_version("2.0.0-rc7", "2.0.0-rc7")); // Same
        assert!(!is_newer_version("2.0.0-rc7", "2.0.0-rc8")); // RC7 < RC8

        // Mixed scenarios
        assert!(is_newer_version("2.0.1-rc1", "2.0.0")); // Higher patch wins
        assert!(!is_newer_version("2.0.0-rc1", "2.0.1")); // Lower patch loses
    }
}
