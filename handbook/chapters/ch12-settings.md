# Settings & Preferences

The **Settings** screen collects everything that affects how Phoenix behaves between wallets: how it connects to Bitcoin-PoCX Core, what it notifies you about, the destructive operations that reset configuration, and the diagnostic shortcuts that let you (or a support contact) inspect what is going on under the hood.

You can reach it from two places: the **gear** icon in the toolbar and the **Settings** entry at the bottom of the sidebar (Chapter 6). Both open the same screen.

The screen is organised into four tabs. This chapter walks through each one in turn.

![Settings â€” the Node Configuration tab in managed mode.](images/processed/ch12-settings-managed.png){width=55%}

## Tab 1 — Node Configuration

The most important tab. This is where you choose whether Phoenix manages Bitcoin-PoCX Core for you, or connects to an external instance you run yourself, and where you tune the details of either option.

### Connection mode

Radio buttons at the top of the tab switch between **Managed**, **External**, and **Remote (Electrum)**. Switching modes does *not* delete any wallet data — it only changes how Phoenix reaches the network. You can flip between them as you experiment.

The rest of the tab changes depending on which mode is selected. Managed and external are covered below and in Chapter 25; remote mode has its own panel (also below) and its own chapter (Chapter 26).

### Managed mode panel

This panel mirrors the setup wizard from Chapter 4 and adds operational controls for the node that is already installed.


**Status block.** At the top of the panel, Phoenix displays the live state of the managed node:

| Field         | What it shows                                                                            |
|---------------|------------------------------------------------------------------------------------------|
| **Status**    | *Running* / *Stopped* / *Starting…* / *Stopping…* / *Error*.                             |
| **Version**   | The installed Bitcoin-PoCX Core version, e.g. `v30.2-pocx`.                              |
| **Network**   | The chain the node is currently configured for.                                          |
| **PID**       | The operating system process ID, when running. Useful when diagnosing from a terminal.   |

Three buttons sit alongside:

- **Start** — if the node is currently stopped.
- **Stop** — graceful shutdown via RPC.
- **Restart** — stop then start, in sequence.

If no node binary is installed yet (because you previously chose external mode, or because the binary has been removed), the status block shows *"Not installed"* and a single **Download & Install** button takes you back through the wizard flow described in Chapter 4.

**Network selection.** Two radio buttons — *Mainnet* and *Testnet* — let you switch the chain the managed node runs on. A change to the network requires Phoenix and the node to stop first; the panel warns you about this with a small reminder.

**Advanced options** (collapsible).

| Setting                  | Notes                                                                                    |
|--------------------------|------------------------------------------------------------------------------------------|
| **Wallet RPC port**      | The port Phoenix uses to reach Core. Defaults from the network selection (`8332` mainnet, `18332` testnet). |
| **Aggregator listen port** | The port the optional aggregator listens on when enabled (Chapter 24). Defaults to `8080`. |

Override either only if another program already uses the default.

> **Note** — A running service locks the port that depends on it, and a small hint appears explaining why. The **Wallet RPC port** cannot be edited while the node, miner, or aggregator is running. The **Aggregator listen port** is stricter only about the parts that use it — it is locked while the miner or aggregator is running, but a running node alone does not block it. Stop the relevant services first, change the port, then start them again.

**Custom bitcoind arguments.** Also inside Advanced options is an editor for extra command-line arguments passed to the managed `bitcoind` when it starts — for tuning the node beyond what the rest of the panel exposes (for example `dbcache`, `proxy`, or `maxconnections`).

- Each argument is a **Key** and an optional **Value** row; click **Add argument** to add one and **Remove** to delete it. When none are set, the editor shows *"No custom arguments set."*
- Write option names **without the leading dash** — `dbcache`, not `-dbcache`.
- For **flag-only** options that take no value, leave the value empty (the field hints *"(empty = flag only)"*).
- A handful of keys are **managed by the wallet** (the ports, network, data directory, and similar that Phoenix sets itself). If you enter one of those, Phoenix flags it as reserved and ignores it on save, so your custom argument can never fight the wallet's own configuration.
- Changes take effect on the next node start — **restart the node to apply them** (the editor reminds you).

> **Warning** — These arguments are passed straight to Bitcoin-PoCX Core. A wrong or conflicting option can stop the node from starting. Change this only if you understand the `bitcoind` option you are setting; when in doubt, leave it empty.

**Node updates.** A small section near the bottom of the panel.

- **Current** — the installed Core version.
- **Check for updates** — asks GitHub Releases whether a newer Core is available.
- **Update** — appears if an update is available. Clicking it downloads the new release (with SHA-256 verification, same as the wizard) and replaces the installed binary.

> **Tip** — Updating the node may require Phoenix to stop the miner and aggregator first. The settings screen reminds you with a small hint when an update is pending.

**Save & apply.** A button at the bottom of the panel commits any changes you made (network, ports, etc.) to disk and restarts the relevant services.

### External mode panel

The external panel collects the connection details Phoenix needs to reach a Bitcoin-PoCX Core instance you run yourself.

![External-node configuration, with the Test connection result.](images/processed/ch12-settings-external.png){width=98%}

**Network selection.** *Mainnet*, *Testnet*, or *Regtest*. Regtest is only useful for local development against your own bitcoind instance.

**Connection settings.**

| Setting          | What it is                                                          |
|------------------|---------------------------------------------------------------------|
| **RPC host**     | The hostname or IP address where your Core instance listens. `127.0.0.1` for a local node, or the LAN address of a server. |
| **RPC port**     | The port your Core's `rpcport=` is set to.                          |

**Authentication.** Two options, with radio buttons:

- **Cookie-based** *(recommended for local nodes)* — Phoenix reads Core's authentication cookie directly from the data directory. You supply:
    - **Data directory** — the path Core uses to store its files. The default depends on the operating system; Phoenix shows a hint.
    - **Testnet subdirectory** — the testnet-specific subdirectory name (default `testnet`). Only used when the network is testnet.
- **Username & password** — for remote nodes or hardened setups where the cookie file is not accessible. Supply the `rpcuser` and `rpcpassword` you set in Core's `bitcoin.conf`.

**Test connection.** A button that performs a lightweight RPC call to confirm the credentials work. On success, Phoenix displays the **version**, **chain**, and **blocks** the remote node reports — confirming both that the connection works and that you are connected to the network you expect. Worth doing before clicking *Save*.

**Reset to defaults / Save & apply.** Two buttons at the bottom — *Reset* clears the form to the defaults for the selected network; *Save* commits.

### Remote (Electrum) mode panel

In remote mode there is no node to configure — instead this panel manages the **Electrum servers** the local wallet syncs through. (The full story is Chapter 26; this is the settings reference.)

**Network selection.** *Mainnet*, *Testnet*, or *Regtest*. Each network keeps its own server list and its own wallet data.

**Electrum servers.** An ordered list of endpoints — *"The first entry is the primary server; the rest are failovers."*

| Control | What it does |
|---------|--------------|
| **Server URL** | Add an endpoint as `tcp://host:port` or `ssl://host:port` (prefer `ssl://`). |
| **Test connection** | Makes a lightweight query to confirm the server is reachable before you rely on it. |
| **Remove server** | Deletes an entry; the remaining order is the failover order. |

For mainnet a default Bitcoin-PoCX server is present out of the box; testnet and regtest start empty. Put a server you run first if you have one, and keep a public server below it as a failover.

**Wallets.** Below the server list, remote mode shows the local wallets it holds. Alongside the usual switch/rename/delete controls, a wallet still on the legacy coin type carries the **v30** badge and its **Upgrade to v31** action (Chapter 5). A **Check for older (v30) funds** button re-scans the active wallet's legacy (v30) derivation branch and restores any funds it finds there — reporting either *"Found and restored older funds"* or *"No older funds found."* Use it if a freshly upgraded wallet looks like it is missing history that used to be there.

## Tab 2 — Notifications

Phoenix can deliver native operating-system notifications for events of interest. This tab toggles which ones.

![The Notifications tab.](images/processed/ch12-settings-notifications.png){width=98%}

The list is split into two groups.

### Transaction notifications

| Toggle                  | Fires when…                                                                            |
|-------------------------|----------------------------------------------------------------------------------------|
| **Incoming payment**    | An unconfirmed transaction credits one of your addresses.                              |
| **Payment confirmed**   | An incoming payment reaches its first confirmation.                                    |
| **Block mined**         | The local miner forges a block.                                                        |
| **Block reward matured**| A previously immature mining reward becomes spendable (after the coinbase maturity window). |

### Wallet status notifications

| Toggle                  | Fires when…                                                                            |
|-------------------------|----------------------------------------------------------------------------------------|
| **Node connected**      | Phoenix establishes (or re-establishes) its RPC connection to Core.                    |
| **Node disconnected**   | Phoenix loses its RPC connection to Core.                                              |
| **Sync complete**       | The node finishes its initial blockchain sync or catches back up after being behind.   |

### System notifications

| Toggle                          | Fires when…                                                                            |
|---------------------------------|----------------------------------------------------------------------------------------|
| **Warn when system clock drifts** | Your system clock drifts far enough from network time to threaten forging. This also drives the toolbar's clock-drift indicator (Chapter 6) and the **System Clock Drift** dialog (Chapter 20). On by default — a drifting clock silently breaks mining, so the warning is worth keeping. |

A master toggle near the top of the tab disables every notification at once if you want a quiet session without losing the per-event configuration.

> **Tip** — *Node disconnected* is the most important toggle for a long-running miner — it tells you immediately when something has gone wrong with Core, before mining starts piling up missed deadlines. The default is *on* for that reason.

## Tab 3 — Danger Zone

Operations that destroy or rewrite configuration. Phoenix groups them on their own tab so they cannot be reached by accident from anywhere else.

![The Danger Zone tab: resets and WIF import.](images/processed/ch12-settings-danger.png){width=98%}

A warning banner at the top of the tab reminds you that the actions below are not reversible.

### Reset mining configuration

Wipes the mining-related configuration: chains, drives, CPU/GPU device choices, plot plan state. The plot files themselves on disk are **not** touched — you can rebuild the configuration from scratch, point Phoenix at the same drives, and the existing `.pocx` files will be re-detected and joined to the next round.

Use this when your mining configuration has become tangled (mismatched orphan files, broken drive list) and you want to start the configuration over without losing the actual plot work.

### Reset wallet

Wipes Phoenix's view of the active wallet — settings, contacts associated with the wallet, internal caches. This does *not* delete the underlying Bitcoin-PoCX Core wallet or its keys; it removes Phoenix-side bookkeeping only. You can re-add the wallet from the Wallets screen (Chapter 5) afterwards.

> **Warning** — Despite the name, this is a Phoenix-level reset, not a key deletion. To actually destroy the underlying wallet (and its keys), you must remove the wallet from Bitcoin-PoCX Core itself — typically by wiping the node's data directory, which Chapter 27 covers in detail. *Always confirm you have your recovery phrase before any wallet-related reset.*

### Import WIF private key

A small advanced tool for importing a single private key — in Bitcoin's **Wallet Import Format (WIF)** — into the active wallet. Useful for sweeping funds from another wallet that does not support seed-based migration, or for recovering an isolated address.

The form has three inputs:

- **WIF private key** — the WIF-encoded private key to import.
- **Address label** *(optional)* — a label to attach to the resulting address.
- **Rescan strategy** — *now*, *from a date*, or *from genesis*. The same three options as the watch-only flow in Chapter 5; pick *genesis* if the key has been active for a long time and you want full history.

A **Preview address** button derives the address from the WIF without committing anything, so you can confirm you are importing the right key before clicking **Import to wallet**.

The imported key is added as a regular wpkh (bech32) address to the active wallet; from that point on it spends like any other address in the wallet.

> **Warning** — Importing a private key into a wallet *blends* its history with the wallet's own. If privacy matters for the swept funds (for example, donations to a public address that you do not want linked to your main wallet), consider creating a separate Phoenix wallet for the import instead.

## Tab 4 — Debug Logs

A diagnostic shortcut panel. Most users will never open this tab; when something does go wrong, this is where you (or a support contact) start.

![The Debug and Logs tab: data directory, config files, logs, and system info.](images/processed/ch12-settings-debug.png){width=98%}

### App data directory

A one-button **Open folder** action opens Phoenix's main application data directory in your platform's file manager. Everything else in this tab lives inside it.

### Config files

Each row pairs a file name with an **Open** button.

| File                | Contents                                                                                     |
|---------------------|----------------------------------------------------------------------------------------------|
| **Node config**     | Phoenix's stored node configuration (mode, network, RPC details).                            |
| **Mining config**   | Phoenix's stored mining configuration (chains, drives, devices, plotting address).           |
| **Aggregator config** | Phoenix's stored aggregator configuration.                                                 |
| **Bitcoin config**  | The `bitcoin.conf` that the managed Bitcoin-PoCX Core uses. Edit only if you know what you are changing. |

Clicking **Open** launches the platform's default editor on that file. The first three are JSON; the bitcoin config is the standard Bitcoin Core key-value format.

### Log files

| File                | Contents                                                                                     |
|---------------------|----------------------------------------------------------------------------------------------|
| **App log**         | Phoenix's own log. **Open folder** opens the directory; the latest log file is inside.       |
| **Bitcoin log**     | Bitcoin-PoCX Core's `debug.log` — the canonical place to look for node-side errors.          |

If you ever need to share a log with a support contact, take a fresh slice — the most recent few hundred lines is usually enough; the full file may be huge and contain addresses you do not want to share publicly.

### System info

Three lines summarise the environment for triage:

- **App version** — Phoenix's version.
- **Platform** — your OS and CPU architecture.
- **Node version** — the version of Bitcoin-PoCX Core that Phoenix is currently managing or connected to.

A **Copy all** button at the bottom of the section copies the system info as plain text, suitable for pasting into an issue report or chat without leaking anything sensitive.

## What lives outside Settings

A few preferences are intentionally not in the Settings screen — they have their own homes.

- **Language.** Picked from the language drop-down in the toolbar (Chapter 6). Changing it takes effect immediately.
- **Active wallet.** Switched from the toolbar's wallet selector (Chapter 6) or the Wallets screen (Chapter 5). Settings never picks a wallet for you; whichever wallet you opened is the one most other screens act on.
- **The wallet's spendable-confirmation threshold.** Bitcoin-PoCX Core controls this; it is currently six confirmations and is not user-tunable from Phoenix.

## What's next

That ends Part II. From here we move into the mining-specific chapters. Part III opens with **Chapter 13 — Understanding Proof-of-Capacity Mining**, which extends the brief primer from Chapter 2 into the working model you need to configure a real mining setup — including how plot files, miners, and signing wallets fit together across solo, multi-machine, and pool arrangements.
