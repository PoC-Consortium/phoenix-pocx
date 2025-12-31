# Phoenix PoCX Wallet (v2)

New Angular 21 implementation of the Phoenix Bitcoin-PoCX Wallet.

## Project Structure

```
phoenix-pocx/
├── web-wallet/          # Angular 21 web application
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/           # Core services
│   │   │   │   ├── auth/       # Cookie authentication
│   │   │   │   └── services/   # Electron, Platform services
│   │   │   ├── bitcoin/        # Bitcoin-specific services
│   │   │   │   └── services/
│   │   │   │       ├── rpc/    # Split RPC services
│   │   │   │       │   ├── rpc-client.service.ts     # Base JSON-RPC transport
│   │   │   │       │   ├── blockchain-rpc.service.ts # Chain queries
│   │   │   │       │   ├── wallet-rpc.service.ts     # Wallet operations
│   │   │   │       │   └── mining-rpc.service.ts     # Mining/PoCX operations
│   │   │   │       └── wallet/ # Wallet services
│   │   │   │           ├── descriptor.service.ts     # BIP39/descriptor generation
│   │   │   │           ├── wallet-manager.service.ts # Wallet lifecycle
│   │   │   │           └── wallet.service.ts         # High-level wallet API
│   │   │   ├── shared/         # Shared components, services
│   │   │   │   └── services/   # Notifications, error handling
│   │   │   ├── store/          # NgRx store
│   │   │   │   ├── wallet/     # Wallet state management
│   │   │   │   └── settings/   # Settings state management
│   │   │   └── features/       # Feature modules (to be created)
│   │   └── ...
│   └── package.json
├── desktop/wallet/      # Electron desktop wrapper
│   ├── main.js          # Electron main process
│   ├── preload.js       # Context bridge for IPC
│   └── package.json
└── CLAUDE.md
```

## Build & Run

### Web Development (Hot Reload)
```bash
cd web-wallet
npm start
```

### Desktop Development
```bash
# Terminal 1: Start Angular dev server
cd web-wallet
npm start

# Terminal 2: Start Electron (in dev mode)
cd desktop/wallet
npm run start:dev
```

### Production Build
```bash
# Build web app
cd web-wallet
npm run build

# Build desktop (copies web build + packages Electron)
cd desktop/wallet
npm run build
npm run pack
```

## Tech Stack

- **Angular 21** - Latest Angular with signals, block control flow
- **Angular Material 21** - Material Design components
- **NgRx 21** - State management
- **Electron 39** - Desktop wrapper
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

### State Management (NgRx)
- **wallet** feature: balance, transactions, UTXOs, addresses
- **settings** feature: network, theme, preferences

## Migration Notes

This is a fresh rewrite from the original Phoenix wallet (Angular 8).
Components are being migrated incrementally from `../phoenix/`.
