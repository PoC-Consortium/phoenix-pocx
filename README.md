# Phoenix PoCX Wallet

A modern Bitcoin-PoCX desktop wallet built with Angular 21 and Tauri.

## Features

- Create and import HD wallets (BIP39/BIP84)
- Send and receive Bitcoin-PoCX
- Transaction history with confirmations
- Forging assignment management (PoCX-specific)
- Multi-language support (24 languages)
- Lightweight desktop app for Windows, macOS, and Linux (~10MB)

## Requirements

- **Node.js** 20+ and npm
- **Rust** (for desktop builds)
- **Bitcoin-PoCX Core** running with RPC enabled

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
│   │   │   ├── core/        # Core services (auth, platform)
│   │   │   ├── bitcoin/     # Bitcoin RPC & wallet services
│   │   │   ├── shared/      # Shared components
│   │   │   ├── store/       # NgRx state management
│   │   │   └── features/    # Feature modules
│   │   └── assets/
│   │       └── locales/     # i18n translation files
│   ├── src-tauri/           # Tauri desktop wrapper (Rust)
│   │   ├── src/
│   │   │   ├── main.rs      # Entry point
│   │   │   └── lib.rs       # Commands & setup
│   │   ├── Cargo.toml       # Rust dependencies
│   │   └── tauri.conf.json  # Tauri configuration
│   └── package.json
└── README.md
```

## Tech Stack

- **Angular 21** - Frontend framework with signals and block control flow
- **Angular Material 21** - Material Design components
- **NgRx 21** - State management
- **Tauri 2** - Lightweight desktop wrapper (Rust)
- **TypeScript 5.9** - Type safety

## Bitcoin Core Configuration

The wallet connects to Bitcoin-PoCX Core via JSON-RPC. Ensure your `bitcoin.conf` includes:

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

## Attribution

This project is a fork of [Phoenix](https://github.com/signum-network/phoenix) by the Signum Network team. The original Phoenix wallet was built for the Signum blockchain and has been adapted for Bitcoin-PoCX.

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.
