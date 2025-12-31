const { app, BrowserWindow, ipcMain, shell, dialog, Notification, Menu } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const UpdateService = require('./update-service');
const isDev = process.env.NODE_ENV === 'develop';
const showDevTools = isDev || process.env.DEVTOOLS === 'true';

// Set app name for notifications and taskbar
app.setName('Phoenix PoCX Wallet');

// Update service instance
let updateService = null;

// On Windows, set AppUserModelId for proper taskbar grouping and notifications
// Only set in production - in dev mode it shows the raw ID since the app isn't installed
if (process.platform === 'win32' && !isDev) {
  app.setAppUserModelId('org.pocx.phoenix');
}

// Set unique userData path to avoid conflicts with v1 wallet
app.setPath('userData', path.join(app.getPath('appData'), 'phoenix-pocx-v2'));

// Keep a global reference of the window object
let mainWindow = null;

/**
 * Expand environment variables and ~ in paths
 * Windows: %VAR% style
 * Unix: ~ expands to HOME
 */
function expandPath(p) {
  if (!p) return p;

  if (process.platform === 'win32') {
    // Expand %VAR% style environment variables
    return p.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
  } else {
    // Expand ~ to HOME directory
    if (p.startsWith('~/')) {
      return path.join(process.env.HOME, p.slice(2));
    } else if (p === '~') {
      return process.env.HOME;
    }
    return p;
  }
}

/**
 * Build cookie file path from dataDirectory and network
 */
function buildCookiePath(dataDirectory, network) {
  const expandedDir = expandPath(dataDirectory);

  if (network === 'mainnet') {
    return path.join(expandedDir, '.cookie');
  } else {
    // testnet or regtest - cookie is in subdirectory
    return path.join(expandedDir, network, '.cookie');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: showDevTools
    },
    icon: path.join(__dirname, 'assets/icons/icon.png'),
    show: false,
    backgroundColor: '#1e1e2f'
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:4200');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Open DevTools if enabled
  if (showDevTools) {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createMenu();
}

/**
 * Create application menu
 */
function createMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          click() {
            if (mainWindow) {
              mainWindow.webContents.send('route-to', '/settings');
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: showDevTools
        ? [
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
          ]
        : [
            { role: 'togglefullscreen' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' }
          ]
    },
    // Window menu
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    // Help menu
    {
      role: 'help',
      submenu: [
        {
          label: 'Check for Update',
          click: async () => {
            if (updateService) {
              const updateInfo = await updateService.manualCheck();
              if (updateInfo) {
                handleNewVersion(updateInfo);
              } else {
                mainWindow.webContents.send('new-version-check-noupdate');
              }
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Bitcoin PoCX Documentation',
          click() {
            shell.openExternal('https://github.com/PoC-Consortium/bitcoin-pocx/blob/master/docs/index.md');
          }
        },
        {
          label: 'Report A Suggestion',
          click() {
            shell.openExternal('https://github.com/PoC-Consortium/phoenix/issues/new?assignees=&labels=enhancement,web,desktop&template=feature_request.md&title=');
          }
        },
        {
          label: 'Report An Issue',
          click() {
            shell.openExternal('https://github.com/PoC-Consortium/phoenix/issues/new?assignees=&labels=bug,web,desktop&template=bug_report.md&title=');
          }
        },
        { type: 'separator' },
        {
          label: 'About',
          click: async () => {
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Phoenix PoCX Wallet',
              message: 'Phoenix PoCX Wallet',
              detail: 'A secure and easy-to-use wallet for Bitcoin PoCX.\n\nVersion: 2.0.0\n\nwww.bitcoin-pocx.org',
              buttons: ['OK', 'Visit Website'],
              defaultId: 0,
              icon: path.join(__dirname, 'assets/icons/icon.png')
            });
            if (result.response === 1) {
              shell.openExternal('https://www.bitcoin-pocx.org');
            }
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (isMac) {
    template.unshift({
      label: app.getName(),
      submenu: [
        {
          label: 'About Phoenix PoCX Wallet',
          click: async () => {
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Phoenix PoCX Wallet',
              message: 'Phoenix PoCX Wallet',
              detail: 'A secure and easy-to-use wallet for Bitcoin PoCX.\n\nVersion: 2.0.0\n\nwww.bitcoin-pocx.org',
              buttons: ['OK', 'Visit Website'],
              defaultId: 0,
              icon: path.join(__dirname, 'assets/icons/icon.png')
            });
            if (result.response === 1) {
              shell.openExternal('https://www.bitcoin-pocx.org');
            }
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });

    // Window menu on macOS
    template[4].submenu = [
      { role: 'close' },
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' }
    ];
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
ipcMain.handle('read-cookie-file', async (event, options = {}) => {
  try {
    const { dataDirectory, network } = options;

    if (!dataDirectory || !network) {
      return { success: false, error: 'Missing dataDirectory or network parameter' };
    }

    const cookiePath = buildCookiePath(dataDirectory, network);
    console.log('Reading cookie file from:', cookiePath);

    if (fs.existsSync(cookiePath)) {
      const content = await fs.readFile(cookiePath, 'utf8');
      return { success: true, content: content.trim(), path: cookiePath };
    }
    return { success: false, error: `Cookie file not found at ${cookiePath}`, path: cookiePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-cookie-path', (event, options = {}) => {
  const { dataDirectory, network } = options;
  if (!dataDirectory || !network) {
    return null;
  }
  return buildCookiePath(dataDirectory, network);
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

ipcMain.handle('is-dev', () => {
  return isDev;
});

ipcMain.handle('show-folder-dialog', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || 'Select Folder',
    defaultPath: expandPath(options.defaultPath) || app.getPath('home'),
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('show-notification', (event, options = {}) => {
  const { title, body } = options;

  if (!Notification.isSupported()) {
    return { success: false, error: 'Notifications not supported on this platform' };
  }

  const notification = new Notification({
    title: title || 'Phoenix Wallet',
    body: body || '',
    icon: path.join(__dirname, 'assets/icons/icon.png'),
  });

  notification.show();

  // Focus window when notification is clicked
  notification.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  return { success: true };
});

/**
 * Handle new version notification
 */
function handleNewVersion(updateInfo) {
  if (mainWindow && updateInfo) {
    mainWindow.webContents.send('new-version', updateInfo);
  }
}

/**
 * Start the update service
 */
function startUpdateService() {
  updateService = new UpdateService();
  updateService.start((updateInfo) => {
    if (updateInfo) {
      handleNewVersion(updateInfo);
    }
  });
}

// IPC handler for downloading selected asset
ipcMain.on('new-version-asset-selected', (event, assetUrl) => {
  if (assetUrl) {
    // Open the download URL in the default browser
    shell.openExternal(assetUrl);
    mainWindow.webContents.send('new-version-download-started');
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  // Start update service after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    startUpdateService();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent navigation to external sites
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== 'file:' && !navigationUrl.startsWith('http://localhost')) {
      event.preventDefault();
    }
  });
});
