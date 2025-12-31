const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Cookie file operations (require dataDirectory and network options)
  readCookieFile: (options) => ipcRenderer.invoke('read-cookie-file', options),
  getCookiePath: (options) => ipcRenderer.invoke('get-cookie-path', options),

  // Platform info
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  isDev: () => ipcRenderer.invoke('is-dev'),

  // Dialog operations
  showFolderDialog: (options) => ipcRenderer.invoke('show-folder-dialog', options),

  // Notification operations
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),

  // Menu navigation - listen for route-to events from main process
  onRouteTo: (callback) => ipcRenderer.on('route-to', (event, route) => callback(route)),

  // Update notifications
  onNewVersion: (callback) => ipcRenderer.on('new-version', (event, updateInfo) => callback(updateInfo)),
  onNewVersionCheckNoUpdate: (callback) => ipcRenderer.on('new-version-check-noupdate', () => callback()),
  onNewVersionDownloadStarted: (callback) => ipcRenderer.on('new-version-download-started', () => callback()),
  selectVersionAsset: (assetUrl) => ipcRenderer.send('new-version-asset-selected', assetUrl),

  // Check if running in Electron
  isElectron: true
});
