# Phoenix PoCX Wallet (v2)

Angular 21 + Tauri 2 implementation of the Phoenix Bitcoin-PoCX Wallet.

## Project Structure

```
phoenix-pocx/
├── web-wallet/              # Angular 21 web application
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/        # Core services
│   │   │   │   ├── auth/    # Cookie authentication
│   │   │   │   └── services/# Desktop, Platform services
│   │   │   ├── bitcoin/     # Bitcoin-specific services
│   │   │   │   └── services/
│   │   │   │       ├── rpc/ # Split RPC services
│   │   │   │       │   ├── rpc-client.service.ts     # Base JSON-RPC transport
│   │   │   │       │   ├── blockchain-rpc.service.ts # Chain queries
│   │   │   │       │   ├── wallet-rpc.service.ts     # Wallet operations
│   │   │   │       │   └── mining-rpc.service.ts     # Mining/PoCX operations
│   │   │   │       └── wallet/
│   │   │   │           ├── descriptor.service.ts     # BIP39/descriptor generation
│   │   │   │           ├── wallet-manager.service.ts # Wallet lifecycle
│   │   │   │           └── wallet.service.ts         # High-level wallet API
│   │   │   ├── shared/      # Shared components, services
│   │   │   ├── store/       # NgRx store
│   │   │   │   ├── wallet/  # Wallet state management
│   │   │   │   └── settings/# Settings state management
│   │   │   └── features/    # Feature modules
│   │   └── ...
│   ├── src-tauri/           # Tauri desktop wrapper (Rust)
│   │   ├── src/
│   │   │   ├── main.rs      # Entry point
│   │   │   └── lib.rs       # Commands & plugins
│   │   ├── Cargo.toml       # Rust dependencies
│   │   └── tauri.conf.json  # Tauri configuration
│   └── package.json
└── CLAUDE.md
```

## Build & Run

### Web Development (Hot Reload)
```bash
cd web-wallet
npm install
npm start
```

### Desktop Development (Tauri)
```bash
cd web-wallet
npm install
npm run tauri:dev
```

### Production Build
```bash
cd web-wallet
npm install
npm run tauri:build
```

## Tech Stack

- **Angular 21** - Frontend with signals, block control flow
- **Angular Material 21** - Material Design components
- **NgRx 21** - State management
- **Tauri 2** - Lightweight desktop wrapper (Rust)
- **TypeScript 5.9** - Type safety

## Service Architecture

### RPC Layer (Split Architecture)
The monolithic `BitcoinRpcService` from v1 has been split into focused services:

1. **RpcClientService** - Low-level JSON-RPC transport
   - HTTP communication with Bitcoin Core
   - Authentication via CookieAuthService
   - Connection status tracking
   - Batch request support

2. **BlockchainRpcService** - Chain queries
   - getblockchaininfo, getblock, getrawtransaction
   - Network info, mempool queries
   - Fee estimation

3. **WalletRpcService** - Wallet operations
   - Wallet management (create, load, list)
   - Transaction listing and sending
   - Address generation
   - Descriptor imports
   - PSBT support

4. **MiningRpcService** - Mining/PoCX operations
   - Standard mining RPCs
   - Bitcoin-PoCX specific: assignments, plots, deadlines

### Wallet Layer
1. **DescriptorService** - BIP39 & descriptor operations
2. **WalletManagerService** - Wallet lifecycle management
3. **WalletService** - High-level API with Angular signals

### Desktop Bridge (ElectronService)
Despite the legacy name, this service is now primarily for Tauri:
- `isTauri` / `isDesktop` - Platform detection
- `readCookieFile()` - Read Bitcoin Core cookie file
- `showFolderDialog()` - Native folder picker
- `showDesktopNotification()` - System notifications
- `openExternal()` - Open URLs in browser

### State Management (NgRx)
- **wallet** feature: balance, transactions, UTXOs, addresses
- **settings** feature: network, theme, preferences

## Tauri Commands (Rust)

Located in `src-tauri/src/lib.rs`:
- `read_cookie_file` - Read cookie file with path expansion
- `get_cookie_path` - Build cookie path from data dir + network
- `get_platform` - Return platform (win32/darwin/linux)
- `is_dev` - Check if running in debug mode

## Tauri Plugins

- **dialog** - Native file/folder dialogs
- **notification** - System notifications
- **opener** - Open URLs/files with default app
- **http** - HTTP client for RPC calls (bypasses CORS)
- **updater** - Auto-update support (configured but not yet active)
