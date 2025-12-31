/**
 * Update Service for Phoenix PoCX Wallet
 * Checks GitHub releases for new versions and notifies the user.
 */

const https = require('https');
const semver = require('semver');
const pkg = require('./package.json');

// Platform-specific file patterns for download assets
const PlatformFilePatterns = {
  darwin: ['.dmg', '-mac.zip'],
  win32: ['.exe'],
  linux: ['.tar.gz', '.deb', '.rpm', '.AppImage']
};

class UpdateService {
  constructor(config) {
    this.config = config || pkg.update || {};
    this.currentVersion = pkg.version;
    this.checkInterval = null;
  }

  /**
   * Fetch JSON from a URL using native https
   */
  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': `Phoenix-PoCX-Wallet/${this.currentVersion}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      https.get(url, options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Get the latest release from GitHub
   */
  async getLatestRelease() {
    const url = `${this.config.repositoryRootUrl}/releases`;

    try {
      const releases = await this.fetchJson(url);

      // Filter out drafts and pre-releases, find first stable release
      const stableRelease = releases.find(release =>
        !release.draft && !release.prerelease
      );

      return stableRelease || null;
    } catch (error) {
      console.error('Failed to fetch releases:', error.message);
      return null;
    }
  }

  /**
   * Extract version from tag name
   * Removes optional tag prefix (e.g., "desktop-1.0.0" -> "1.0.0")
   */
  extractVersion(tagName) {
    const prefix = this.config.tagPrefix || '';
    let version = tagName;

    if (prefix && version.startsWith(prefix)) {
      version = version.substring(prefix.length);
    }

    // Remove leading 'v' if present
    if (version.startsWith('v')) {
      version = version.substring(1);
    }

    return version;
  }

  /**
   * Filter assets by platform
   */
  filterAssetsByPlatform(assets, platform) {
    const patterns = PlatformFilePatterns[platform] || [];

    return assets
      .filter(asset => patterns.some(pattern =>
        asset.name.toLowerCase().endsWith(pattern.toLowerCase())
      ))
      .map(asset => ({
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size
      }));
  }

  /**
   * Get platform display name
   */
  getPlatformName(platform) {
    switch (platform) {
      case 'darwin': return 'macOS';
      case 'win32': return 'Windows';
      case 'linux': return 'Linux';
      default: return platform;
    }
  }

  /**
   * Check for latest release and compare versions
   */
  async checkForLatestRelease(callback) {
    const release = await this.getLatestRelease();

    if (!release) {
      callback(null);
      return;
    }

    const newVersion = this.extractVersion(release.tag_name);

    // Validate version format
    if (!semver.valid(newVersion)) {
      console.log('Invalid version format:', newVersion);
      callback(null);
      return;
    }

    // Compare versions
    if (!semver.lt(this.currentVersion, newVersion)) {
      console.log('Already up to date:', this.currentVersion);
      callback(null);
      return;
    }

    // Get platform-specific assets
    const platform = process.platform;
    const assets = this.filterAssetsByPlatform(release.assets, platform);

    const updateInfo = {
      currentVersion: this.currentVersion,
      newVersion: newVersion,
      os: this.getPlatformName(platform),
      assets: assets,
      releaseUrl: release.html_url,
      releaseNotes: release.body || ''
    };

    console.log('New version available:', newVersion);
    callback(updateInfo);
  }

  /**
   * Start periodic version checking
   */
  start(callback) {
    const intervalMs = (this.config.checkIntervalMins || 10) * 60 * 1000;

    // Check immediately on start
    this.checkForLatestRelease(callback);

    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.checkForLatestRelease(callback);
    }, intervalMs);

    console.log(`Update service started. Checking every ${this.config.checkIntervalMins || 10} minutes.`);
  }

  /**
   * Stop periodic checking
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Manual check for updates (triggered by menu)
   */
  async manualCheck() {
    return new Promise((resolve) => {
      this.checkForLatestRelease(resolve);
    });
  }
}

module.exports = UpdateService;
