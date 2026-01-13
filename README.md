# Phoenix PoCX Wallet

A modern Bitcoin-PoCX desktop wallet built with Angular 21 and Tauri.

## Features

- Create and import HD wallets (BIP39/BIP84)
- Send and receive Bitcoin-PoCX
- Transaction history with confirmations
- Forging assignment management (PoCX-specific)
- **Managed Node**: Automatic download, install, and lifecycle management of Bitcoin-PoCX Core
- **Integrated Mining**: Multi-chain PoCX mining with real-time dashboard
- **Plot File Generation**: CPU and GPU (OpenCL) plotting support
- Multi-language support (24 languages)
- Lightweight desktop app for Windows, macOS, and Linux

## Requirements

- **Node.js** 20+ and npm
- **Rust** (for desktop builds)
- **Bitcoin-PoCX Core** - either:
  - **Managed mode** (recommended): Wallet downloads and manages the node automatically
  - **External mode**: Connect to your own Bitcoin-PoCX Core instance with RPC enabled

## Quick Start

### Web Development (Hot Reload)

```bash
cd web-wallet
npm install
npm start
```

Open http://localhost:4200 in your browser.

### Desktop Development

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

The packaged app will be in `web-wallet/src-tauri/target/release/bundle/`.

## Project Structure

```
phoenix-pocx/
├── web-wallet/              # Angular 21 web application
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/        # Core services (auth, platform, guards)
│   │   │   ├── bitcoin/     # Bitcoin RPC & wallet services
│   │   │   ├── node/        # Managed node service & setup wizard
│   │   │   ├── mining/      # Mining dashboard & plotting
│   │   │   ├── shared/      # Shared components
│   │   │   ├── store/       # NgRx state management
│   │   │   └── features/    # Feature modules
│   │   └── assets/
│   │       └── locales/     # i18n translation files
│   ├── src-tauri/           # Tauri desktop wrapper (Rust)
│   │   ├── src/
│   │   │   ├── main.rs      # Entry point
│   │   │   ├── lib.rs       # Commands & setup
│   │   │   ├── node/        # Managed node backend
│   │   │   └── mining/      # Mining & plotting backend
│   │   ├── Cargo.toml       # Rust dependencies
│   │   └── tauri.conf.json  # Tauri configuration
│   └── package.json
├── CLAUDE.md                # Developer documentation
└── README.md
```

## Tech Stack

- **Angular 21** - Frontend framework with signals and block control flow
- **Angular Material 21** - Material Design components
- **NgRx 21** - State management
- **Tauri 2** - Lightweight desktop wrapper (Rust)
- **TypeScript 5.9** - Type safety

## Node Configuration

### Managed Mode (Default)

On first launch, the wallet will guide you through downloading Bitcoin-PoCX Core. The node is automatically started and stopped with the wallet.

### External Mode

To connect to your own Bitcoin-PoCX Core instance, configure your `bitcoin.conf`:

```ini
server=1
rpcuser=your_username
rpcpassword=your_password
# Or use cookie-based authentication (recommended)
```

Cookie-based authentication is recommended and automatically detected.

## Development

### Code Quality

```bash
cd web-wallet
npm run lint        # ESLint
npm run lint:fix    # Auto-fix lint issues
npm run format:check # Prettier check
npm run format:fix   # Auto-format code
```

### Testing

```bash
cd web-wallet
npm test           # Run unit tests
npm run test:ci    # CI mode (headless)
```

### Tauri Prerequisites

Install Rust: https://rustup.rs/

**Linux (Ubuntu/Debian):**
```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
```

**macOS:**
```bash
xcode-select --install
```

**Windows:**
- Install Visual Studio Build Tools with C++ workload

### GPU Plotting (Optional)

For GPU-accelerated plot generation, install OpenCL drivers:
- **NVIDIA**: Included with NVIDIA drivers
- **AMD**: Install AMD ROCm or AMDGPU-PRO drivers
- **Intel**: Install Intel OpenCL runtime

No OpenCL SDK is required at build time (dynamic loading).

## Attribution

This project is a fork of [Phoenix](https://github.com/signum-network/phoenix) by the Signum Network team. The original Phoenix wallet was built for the Signum blockchain and has been adapted for Bitcoin-PoCX.

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.
