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
│   │   │   │   ├── backend/ # WalletBackend seam: Core RPC vs Electrum/BDK
│   │   │   │   │   ├── wallet-backend.model.ts       # Interfaces + capability matrix
│   │   │   │   │   ├── core-wallet-backend.ts        # Bitcoin Core RPC impl
│   │   │   │   │   ├── electrum-wallet-backend.ts    # Local BDK wallet impl
│   │   │   │   │   └── backend-router.service.ts     # Routes by node mode
│   │   │   │   ├── guards/  # Route guards (auth, node-setup, not-remote)
│   │   │   │   └── services/# Desktop, Platform, BtcxWallet, ElectrumStatus
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
│   │   │   ├── node/        # Managed node module
│   │   │   │   ├── models/
│   │   │   │   │   └── node.models.ts               # Node config, status types
│   │   │   │   ├── pages/
│   │   │   │   │   └── node-setup/                  # First-launch setup wizard
│   │   │   │   └── services/
│   │   │   │       └── node.service.ts              # Node state & Tauri IPC
│   │   │   ├── mining/      # Mining & plotting module
│   │   │   │   ├── pages/
│   │   │   │   │   ├── mining-dashboard/             # Main mining UI
│   │   │   │   │   └── setup-wizard/                 # Initial setup flow
│   │   │   │   ├── services/
│   │   │   │   │   ├── mining.service.ts             # Mining state & Tauri IPC
│   │   │   │   │   └── plot-plan.service.ts          # Plot planning logic
│   │   │   │   ├── models/
│   │   │   │   │   └── mining.models.ts              # Types & capacity calculations
│   │   │   │   └── components/                       # Dialogs, charts, etc.
│   │   │   ├── shared/      # Shared components, services
│   │   │   ├── store/       # NgRx store
│   │   │   │   ├── wallet/  # Wallet state management
│   │   │   │   └── settings/# Settings state management
│   │   │   └── features/    # Feature modules
│   │   └── ...
│   ├── src-tauri/           # Tauri desktop wrapper (Rust)
│   │   ├── src/
│   │   │   ├── main.rs      # Entry point
│   │   │   ├── lib.rs       # Commands & plugins
│   │   │   ├── node/        # Managed node backend
│   │   │   │   ├── mod.rs           # Module exports
│   │   │   │   ├── commands.rs      # Tauri commands for node management
│   │   │   │   ├── config.rs        # Node configuration persistence
│   │   │   │   ├── state.rs         # Shared node state
│   │   │   │   ├── manager.rs       # Node lifecycle (start/stop/detect)
│   │   │   │   ├── downloader.rs    # GitHub release fetching
│   │   │   │   ├── extractor.rs     # Archive extraction (zip/tar.gz)
│   │   │   │   ├── hasher.rs        # SHA256 verification
│   │   │   │   └── rpc.rs           # Node RPC communication
│   │   │   └── mining/      # Mining backend
│   │   │       ├── mod.rs           # Module exports
│   │   │       ├── commands.rs      # 50+ Tauri commands
│   │   │       ├── state.rs         # Shared mining state
│   │   │       ├── plotter.rs       # Plot file generation
│   │   │       ├── callback.rs      # Event callbacks to frontend
│   │   │       └── drives.rs        # Drive detection
│   │   ├── plugins/           # Custom Tauri plugins
│   │   │   ├── tauri-plugin-storage-permission/  # Android file access
│   │   │   └── tauri-plugin-foreground-service/  # Android background service
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

### Backend Abstraction (Remote/Electrum Mode)
Node mode is **managed / external / remote**. Remote mode runs WITHOUT a
local bitcoind: a named local BDK wallet store (Rust `btcx_wallet` module,
BIP-84 @ POCX coin type 0x504F4358, one open wallet at a time) synced over
user-configured Electrum servers (ordered list, first = primary, rest
failover).

1. **BackendRouterService** (`core/backend/`) — hands out THE `WalletBackend`
   for the current mode; `WalletService`, `BlockchainStateService`, the NgRx
   wallet effects and the pages consume this seam, so every page works
   against Core RPC and Electrum/BDK alike. `capabilities()` gates
   Core-only actions (abandontransaction, wallet encryption RPCs, rescan,
   watch-only, multisig, testmempoolaccept).
2. **Polling**: remote mode never polls from Angular — the Rust SyncWorker
   ticks at 15s with scripthash subscriptions and the `btcx-wallet:sync`
   event (height + aggregate health) drives WalletService/
   BlockchainStateService refreshes. Chain info (height/base_target for
   network capacity) comes from `btcx_chain_info` (PoCX tip header).
3. **Remote-only surfaces**: toolbar Electrum indicator
   (`ElectrumStatusService` + `btcx_electrum_health`), client-side forging
   assignments (`btcx_wallet_*_assignment` — OP_RETURN txs built/signed via
   BDK, status derived from Electrum script history), client-side PSBT ops
   (`btcx_psbt_*`).
4. **Disabled in remote**: solo mining (pool/custom only), blocks explorer,
   peers page (guarded by `notRemoteGuard`).

### Node Layer (Managed Node)
The node module provides optional managed node functionality:

1. **NodeService** (`node/services/node.service.ts`)
   - Signal-based reactive state for node status and config
   - Tauri IPC for node lifecycle operations
   - Download progress tracking with event listeners
   - Update checking and version management

2. **Node Setup Guard** (`core/guards/node-setup.guard.ts`)
   - Redirects to setup wizard on first launch (managed mode)
   - Checks if node is installed before allowing app access

3. **Node Models** (`node/models/node.models.ts`)
   - NodeConfig: mode (managed/external), network, RPC settings
   - NodeStatus: running state, sync progress, version info
   - ReleaseInfo: GitHub release data for downloads

### Mining Layer
The mining module provides integrated PoCX mining and plotting capabilities:

1. **MiningService** (`mining/services/mining.service.ts`)
   - Signal-based reactive state management
   - Tauri IPC for all mining/plotting operations
   - Event listeners for real-time updates (scan progress, deadlines, plot progress)
   - Incremental capacity tracking with cached calculations
   - Manages miner and plotter lifecycle

2. **PlotPlanService** (`mining/services/plot-plan.service.ts`)
   - Plot file planning and space allocation
   - Drive capacity calculations
   - Plot plan generation and execution

3. **Mining Models** (`mining/models/mining.models.ts`)
   - Type definitions for chains, drives, deadlines, plot plans
   - Effective capacity calculation with O(n) prefix-sum optimization
   - Quality-to-capacity conversion formulas

## Rust Node Backend

Located in `src-tauri/src/node/`:

### Configuration (`config.rs`)
- `NodeConfig` - Persisted to `node_config.json`
- Supports managed mode (wallet controls node) and external mode (user's own node)
- Network selection (mainnet, testnet, regtest)
- RPC authentication (cookie or user/password)

### State Management (`state.rs`)
- `SharedNodeState` - Thread-safe state via `Arc<Mutex<>>`
- Tracks node status, download progress, installed version
- `NodeStatus` emitted to frontend via events

### Node Manager (`manager.rs`)
- Process detection using `sysinfo` crate
- Start node with appropriate arguments
- Graceful shutdown via RPC stop command
- PID tracking for managed processes

### Downloader (`downloader.rs`)
- Fetch releases from GitHub API
- Download with progress reporting
- Update checking with version comparison

### Extractor (`extractor.rs`)
- Extract `bitcoind` from ZIP (Windows) or tar.gz (Unix)
- Supports NSIS installer extraction (Windows)

### Hasher (`hasher.rs`)
- SHA256 verification of downloaded files
- Streaming hash computation for large files

### RPC (`rpc.rs`)
- Lightweight RPC client for node communication
- Health check (getblockchaininfo)
- Graceful stop command

## Rust BTCX Wallet Backend (nodeless / remote mode)

Located in `src-tauri/src/btcx_wallet/`, built on the shared btcx crates
(`params-btcx`, `keys-btcx`, `seedstore`, `electrum-btcx`, `wallet-btcx`):

- **config.rs** — `btcx_wallet_config.json`: network, per-network ordered
  Electrum server lists, NAMED wallet registry (`wallets`/`active_wallet`)
  with per-wallet descriptor policy; legacy single-wallet layout migration.
- **state.rs** — seed store (per active wallet), Electrum pool, one open
  wallet runtime (bdk handle + SyncWorker), `btcx-wallet:sync` emitter
  (height + aggregate health), chain-only Electrum broadcast.
- **manager.rs** — descriptor-explicit wallet open + restore probing.
- **assignments.rs** — client-side forging assignments: POCX/XCOP OP_RETURN
  build/sign/broadcast via BDK (`TxOrdering::Untouched`, plot-address UTXO
  as ownership proof) and `get_assignment` state derived from Electrum
  script history (delays: 30/720 blocks main+test, 4/8 regtest).
- **psbt.rs** — client-side decode/analyze/sign/finalize/combine +
  `walletcreatefundedpsbt` + `btcx_wallet_utxos`.
- **commands.rs** — all `btcx_wallet_*`/`btcx_psbt_*`/`btcx_electrum_*`
  Tauri commands (wallet registry: list/select/close/delete; health/probe/
  chain-info for the remote-mode UI).

Data layout: `btcx-wallet/<network>/<name>/{seed.mnemonic, wallet/btcx.sqlite}`;
deleted wallets move to `<network>/.trash/`, never removed.

## Rust Mining Backend

Located in `src-tauri/src/mining/`:

### State Management (`state.rs`)
- `SharedMiningState` - Thread-safe shared state via `Arc<RwLock<>>`
- Stores chain configs, drive configs, CPU settings, plotter device settings
- Persists to `mining_config.json`

### Commands (`commands.rs`)
50+ Tauri commands organized by category:
- **Device Detection**: `detect_mining_devices` (CPU, GPU via OpenCL)
- **Drive Management**: `list_plot_drives`, `get_plot_drive_info`
- **Chain Config**: `add_chain_config`, `update_chain_config`, `remove_chain_config`
- **Drive Config**: `add_drive_config`, `update_drive_config`, `remove_drive_config`
- **Mining Control**: `start_mining`, `stop_mining`
- **Plot Planning**: `generate_plot_plan`, `execute_plot_plan_item`
- **Plotter Control**: `start_plotter`, `stop_plotter`, `hard_stop_plotter`
- **Benchmarking**: `run_benchmark`
- **Address Utils**: `validate_pocx_address`, `get_address_info`, `hex_to_bech32`

### Plotter (`plotter.rs`)
- Plot file generation using `pocx_plotter` library
- Supports CPU and GPU (OpenCL) plotting
- Progress callbacks to frontend via Tauri events
- Graceful and hard stop support

### Callbacks (`callback.rs`)
- `TauriMinerCallback` - Implements miner callback trait
- Emits events: `mining:scan-progress`, `mining:deadline-found`, `mining:round-finished`
- Real-time updates to frontend via Tauri event system

### Drive Detection (`drives.rs`)
- Cross-platform drive enumeration
- Capacity and free space detection
- Plot file discovery and validation

## PoCX Libraries

The mining backend uses these Rust crates:
- **pocx_miner** - Deadline scanning, mining loop, callback system
- **pocx_plotter** - Plot file generation (CPU/GPU via OpenCL)
- **pocx_address** - Bitcoin-PoCX address validation and encoding
- **opencl3** - GPU detection with dynamic loading (no build-time SDK required)

## Tauri Commands (Rust)

### Core Commands (`src-tauri/src/lib.rs`)
- `read_cookie_file` - Read cookie file with path expansion
- `get_cookie_path` - Build cookie path from data dir + network
- `get_platform` - Return platform (win32/darwin/linux/android)
- `is_dev` - Check if running in debug mode
- `exit_app` - Force exit application
- `is_elevated` - Check admin privileges (Windows)
- `restart_elevated` - Restart with admin privileges for NTFS preallocation

### Node Commands (`src-tauri/src/node/commands.rs`)
- **Status**: `get_node_status`, `refresh_node_status`, `is_node_ready`
- **Config**: `get_node_config`, `save_node_config`, `set_node_network`
- **Lifecycle**: `start_node`, `stop_node`, `detect_existing_node`
- **Download**: `fetch_latest_node_release`, `fetch_all_node_releases`, `download_and_install_from_asset`
- **Update**: `check_node_update`

### Mining Commands (`src-tauri/src/mining/commands.rs`)
See "Rust Mining Backend" section above for full list of 50+ mining commands.

## Tauri Plugins

- **dialog** - Native file/folder dialogs
- **notification** - System notifications
- **opener** - Open URLs/files with default app
- **http** - HTTP client for RPC calls (bypasses CORS)
- **updater** - Auto-update support (configured but not yet active)

### Android Plugins

Custom Tauri plugins for Android-specific functionality (located in `src-tauri/plugins/`):

- **storage-permission** - Request MANAGE_EXTERNAL_STORAGE permission (Android 11+)
  - `has_all_files_access` - Check if permission granted
  - `request_all_files_access` - Open system settings to grant permission

- **foreground-service** - Keep app alive during mining/plotting
  - `start_foreground_service(mode)` - Start service ("mining" or "plotting")
  - `stop_foreground_service` - Stop service and release wake lock
  - `update_service_notification(text)` - Update notification text
  - `request_battery_exemption` - Request battery optimization exemption
  - `is_service_running` - Check if service is active
  - Holds PARTIAL_WAKE_LOCK to prevent CPU sleep
  - Shows persistent notification with Stop button
