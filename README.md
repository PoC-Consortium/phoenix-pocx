# Phoenix PoCX Wallet

A modern Bitcoin-PoCX desktop wallet built with Angular 19 and Electron.

## Features

- Create and import HD wallets (BIP39/BIP84)
- Send and receive Bitcoin-PoCX
- Transaction history with confirmations
- Forging assignment management (PoCX-specific)
- Multi-language support (24 languages)
- Light/Dark theme
- Desktop app for Windows, macOS, and Linux

## Requirements

- **Node.js** 18+ and npm
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
# Terminal 1: Start Angular dev server
cd web-wallet
npm install
npm start

# Terminal 2: Start Electron (in dev mode)
cd desktop/wallet
npm install
npm run start:dev
```

### Production Build

```bash
# Build web app
cd web-wallet
npm run build

# Package desktop app
cd desktop/wallet
npm run build
npm run pack
```

The packaged app will be in `desktop/wallet/release-builds/`.

## Project Structure

```
phoenix-pocx/
├── web-wallet/          # Angular 19 web application
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/           # Core services (auth, platform)
│   │   │   ├── bitcoin/        # Bitcoin RPC & wallet services
│   │   │   ├── shared/         # Shared components
│   │   │   ├── store/          # NgRx state management
│   │   │   └── features/       # Feature modules
│   │   └── assets/
│   │       └── locales/        # i18n translation files
│   └── package.json
├── desktop/wallet/      # Electron desktop wrapper
│   ├── main.js          # Electron main process
│   ├── preload.js       # Context bridge for IPC
│   └── package.json
└── README.md
```

## Tech Stack

- **Angular 19** - Frontend framework with signals and new control flow
- **Angular Material 19** - Material Design components
- **NgRx 19** - State management
- **Electron 34** - Desktop wrapper
- **TypeScript 5.7** - Type safety

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

## Attribution

This project is a fork of [Phoenix](https://github.com/signum-network/phoenix) by the Signum Network team. The original Phoenix wallet was built for the Signum blockchain and has been adapted for Bitcoin-PoCX.

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.
