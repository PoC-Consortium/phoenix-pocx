# First Launch & Node Setup

The first time you start Phoenix PoCX, the application opens a short setup wizard rather than the wallet itself. The wizard does one thing: it gets you connected to **Bitcoin-PoCX Core**, the program that holds your wallet and talks to the network on your behalf. This chapter walks you through the wizard end to end.

![The first-launch setup wizard: choosing between a managed and an external node.](images/processed/ch04-wizard-mode.png){width=70%}

## What the wizard is doing

The heavy lifting on a Bitcoin-PoCX system is done by a program called **Bitcoin-PoCX Core**. A single Core binary combines two responsibilities:

- **Node functionality** — connecting to peers, downloading the blockchain, and validating new blocks.
- **Wallet functionality** — holding your keys, tracking your balances, and signing transactions on your behalf.

Phoenix is the user interface that drives Core. When you click **Send**, Phoenix asks Core to build and sign the transaction; when you check a balance, Phoenix asks Core what it knows. Phoenix on its own does nothing — it always needs a Core instance to talk to. The wizard exists to set that up.

You have two ways to provide Core:

- **Managed mode** *(recommended)* — Phoenix downloads, installs, runs, and updates Bitcoin-PoCX Core for you. You never have to interact with it directly. This is the right choice for almost everyone.
- **External mode** — You bring your own Core instance. You have already installed Bitcoin-PoCX Core somewhere (your own server, a different machine on the network) and you tell Phoenix how to reach it. Useful for advanced users running a hardened or shared setup.

The wizard walks through mode selection first; if you choose managed mode, it then handles the Core download.

## Step 1 — Choose a mode

The first screen asks: *"How would you like to connect to the Bitcoin-PoCX network?"* Below the question are two selectable cards.


| Card             | Pick this if…                                                                                                          |
|------------------|------------------------------------------------------------------------------------------------------------------------|
| **Managed Node** | You want Phoenix to take care of Core for you. *Recommended for almost all users, including miners.*                  |
| **External Node** | You already run Bitcoin-PoCX Core somewhere and want Phoenix to connect to it via RPC. Configuration follows in Chapter 25. |

Click the card you want; the chosen card is highlighted in blue.

### The testnet toggle

Beneath the cards is a checkbox labelled *Testnet mode (for testing and development)*.

- Leave it **unchecked** to use **mainnet** — the real Bitcoin-PoCX network where BTCX has economic value. This is the default and what you almost certainly want.
- Tick it to use **testnet** — a separate network for development. Coins on testnet have no value, blocks are produced more freely, and faucets can supply you with test BTCX. Useful if you are developing software against Phoenix or want to experiment without risking funds.

> **Note** — A third network, **regtest**, exists for local development. It is not exposed in the wizard. Developers who need it run their own `bitcoind -regtest` instance and connect Phoenix to it through external mode.

### Advanced options

Below the testnet toggle is a collapsible **Advanced options** section. The only setting it exposes is the **wallet RPC port**.

- Mainnet defaults to port `8332`, testnet to `18332`, regtest to `18443`. You normally do not change these.
- Override only if another program on your computer already uses the default port, or if you have configured an external Core instance to listen on a non-standard port.

Click **Continue** when you are happy with your choices.

## Step 2 — Install Bitcoin-PoCX Core (managed mode only)

If you chose **External Node**, the wizard saves your network choice and skips ahead to Chapter 5; the rest of this section does not apply to you. Configuring how Phoenix reaches your existing Core instance is covered in Chapter 25.

If you chose **Managed Node**, the wizard now fetches information about the latest Bitcoin-PoCX Core release.

![The install step, showing the Bitcoin-PoCX Core release with its SHA-256 hash and source.](images/processed/ch04-wizard-install.png){width=70%}

The screen shows you exactly what is about to happen:

- **Bitcoin-PoCX Core** version (e.g. `v30.2-pocx`) — the version Phoenix is about to download. Bitcoin-PoCX Core inherits its base version number from upstream Bitcoin Core, with a `-pocx` suffix marking the fork.
- **Platform:** your operating system and CPU architecture, detected automatically (e.g. *Windows (x86_64)*, *Linux (aarch64)*).
- **Download size:** typically a few tens of megabytes.
- **File:** the exact filename of the asset that will be downloaded.
- **SHA256:** the hash that will be checked after download. If the hash does not match, installation aborts and the file is discarded.
- **Source:** `github.com/PoC-Consortium/bitcoin` — the only place Phoenix downloads Bitcoin-PoCX Core binaries from.

> **Note** — Phoenix never executes downloaded code without verifying its SHA-256 first. If the hash is missing from the release or does not match the downloaded file, installation fails with an error and nothing is run.

Click **Download & Install**. The wizard cycles through several stages, each with its own progress indicator:

1. **Fetching release.** Looking up release metadata from GitHub.
2. **Downloading.** Pulling the binary archive. A progress bar shows percentage, transferred bytes, current speed, and an estimated time remaining. You can press **Cancel** at any time to abort.
3. **Verifying.** The file's SHA-256 is computed and compared with the expected value.
4. **Extracting.** The archive is unpacked into Phoenix's data directory.
5. **Complete.** A green check mark appears, the installed version is shown, and the line *"SHA256 verified"* confirms the integrity check.

![Installation complete and SHA-256 verified.](images/processed/ch04-wizard-install-success.png){width=70%}

If anything goes wrong — no internet connection, a hash mismatch, an unsupported platform — Phoenix shows the error in red, and clicking **OK** returns you to the start of step 2 so you can retry.

## Step 3 — Start Bitcoin-PoCX Core and proceed

When the install screen reports success, click **Get Started**. Phoenix now:

1. Starts Bitcoin-PoCX Core in the background.
2. Reads Core's authentication cookie so it can issue RPC calls on your behalf.
3. Waits for Core's RPC interface to become responsive.
4. Hands you off to the next screen, where you create or import a wallet — the start of Chapter 5.

The button label changes briefly to *"Starting Node..."* with a spinning icon. On most machines this takes two to five seconds; on slower computers or first runs after a long shutdown it can take a little longer.

If Core starts but its RPC interface is not yet responsive, Phoenix shows a small warning *"Node started but RPC not ready yet. You may need to wait."* You will be moved on to the next screen anyway, and Phoenix continues to wait for Core in the background. If you see this message frequently, raise it as a Chapter 26 troubleshooting item.

## What Bitcoin-PoCX Core does next, in the background

After the wizard, Core continues working without further interaction:

- It connects to other Bitcoin-PoCX nodes (its *peers*).
- It downloads block headers, then full blocks, in order.
- It validates every block it accepts.

The first time you ever launch Phoenix, this initial sync can take from a few minutes (on testnet, or if Phoenix is already mostly synced from a prior install) to a few hours (on mainnet from scratch on a slow connection). Phoenix remains usable during sync, but balances and history will only be accurate once Core has caught up.

You can see sync progress in the wallet's main interface — there is a status indicator that shows blocks behind, peer count, and a percentage. Chapter 12 covers it in detail.

> **Tip** — Phoenix remembers your choice of mode, network, and Core version. The setup wizard reappears only when one of these is missing — for example, if you wipe Phoenix's configuration, switch networks, or the Core program disappears (the wizard then enters *repair mode* and lets you reinstall without losing your wallet).

## What's next

Bitcoin-PoCX Core is installed and running, and Phoenix is connected to it. What you do *not* yet have is an actual wallet — a set of keys that belong to you. The next chapter walks you through creating one: generating a recovery phrase, writing it down safely, and giving the wallet a name. If you already have a Phoenix or Bitcoin-PoCX recovery phrase from a previous setup, the next chapter also covers importing it.
