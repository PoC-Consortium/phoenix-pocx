const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const rootDir = path.resolve(__dirname, '../../..');
const webWalletDir = path.join(rootDir, 'web-wallet');
const desktopDir = path.join(rootDir, 'desktop/wallet');
const distDir = path.join(desktopDir, 'dist');

console.log('[INFO] Building Phoenix PoCX Wallet...');

// Build Angular app
console.log('[INFO] Building Angular app...');
execSync('npm run build', { cwd: webWalletDir, stdio: 'inherit' });

// Copy dist to desktop (Angular 19 outputs to browser/ subdirectory)
console.log('[INFO] Copying dist files...');
const angularDist = path.join(webWalletDir, 'dist/web-wallet/browser');
// Clean old dist first
fs.emptyDirSync(distDir);
fs.copySync(angularDist, distDir);

console.log('[OK] Build complete!');
