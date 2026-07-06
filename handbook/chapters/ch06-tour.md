# A Tour of the Interface

You now have a working wallet. This chapter steps through every part of the Phoenix PoCX main window so you know where to find things before we start receiving and sending coins in the next two chapters.

## Before the tour — Phoenix does not hold your keys

Before we start clicking around, there is one architectural detail worth being explicit about, because it quietly shapes everything else.

**Phoenix does not store your private keys.** The wallet you created in the previous chapter — the keys that actually authorise spending — lives inside Bitcoin-PoCX Core, not inside Phoenix. During wallet creation, Phoenix's role with the recovery phrase is short-lived and very deliberately limited:

1. It generates the 24-word phrase locally, in memory.
2. It displays the phrase on screen so you can write it down.
3. It helps you verify you have written it correctly.
4. It hands the phrase to Bitcoin-PoCX Core through an RPC call, asking Core to derive the keys.
5. It wipes the phrase from its own memory immediately afterwards.

From that moment on, every key-related operation — signing a send, exporting a private address, decrypting a message — is performed by Core. Phoenix asks; Core does the cryptography; Phoenix shows you the result. Phoenix never has the keys long enough to lose them, leak them, or accidentally back them up.

Three practical consequences flow from this:

- **Backups follow Core, not Phoenix.** Wiping or reinstalling Phoenix does *not* delete your wallet — the keys remain in Core's wallet database. Equally, exporting Phoenix's settings does *not* export your funds.
- **Encryption is Core's encryption.** When you set a wallet password in Chapter 5, that password is forwarded to Core, which encrypts the keys at rest. Phoenix never sees the encrypted blob; it only relays your password to Core when an operation needs to sign.
- **Phoenix is replaceable; the keys are not.** You can swap Phoenix for a different Bitcoin-PoCX Core front-end (a command-line client, for example) and your wallet keeps working — because the keys are in Core, not in Phoenix.

The rest of this chapter assumes that mental model. When the handbook says *"the wallet shows X"* or *"the wallet signs Y"*, that is shorthand for "Phoenix asks Core, and Core actually does the work."

## The shape of the main window

Once a wallet is active, Phoenix presents the same three-region layout on every page:

![The Phoenix main window: sidebar, toolbar, and dashboard.](images/processed/ch06-main-window.png){width=98%}

| Region              | Where                                  | What it does                                                                  |
|---------------------|----------------------------------------|-------------------------------------------------------------------------------|
| **Sidebar**         | Left side, full height                 | Navigation between sections of the wallet (Dashboard, Send, Mining, …).       |
| **Toolbar**         | Top, full width above the content      | Status indicators, the wallet selector, settings, and language picker.        |
| **Content area**    | Centre, fills the rest of the window   | The page you are currently on. Everything outside the sidebar and toolbar.    |

On smaller screens (or when the sidebar is collapsed) the sidebar slides in over the content from the left and a hamburger button (the three-stacked-lines menu icon) appears on the toolbar to bring it back.

## The sidebar

The sidebar is the navigation hub. Reading top to bottom:

![The sidebar, with wallet info and grouped navigation.](images/processed/ch06-sidebar.png){height=9cm}

### Header

A small header strip shows the Phoenix logo, the application name, and the current Phoenix version. If a newer Phoenix release is available, an upward arrow badge appears next to the version number. Clicking the version opens a small dialog with details about the update.

### Wallet info

Just below the header is the **wallet name** and a live **balance** display. The balance is what your active wallet currently holds, in BTCX, fetched from Core in the background and refreshed automatically.

If you have multiple wallets and the wrong one is shown, switch from the toolbar (covered below) — not from the sidebar.

### Dashboard (standalone)

The first navigation entry is **Dashboard**, the wallet's home screen. It is the default page Phoenix opens to and where you land after creating or opening a wallet.

### Group: Transactions

Everything to do with moving and tracking BTCX:

| Item                      | Icon                | Goes to                                                                  |
|---------------------------|---------------------|--------------------------------------------------------------------------|
| **Transactions**          | `compare_arrows`    | Full transaction history with filters and details. Chapter 9.            |
| **Send**                  | `send`              | Send BTCX. Chapter 8.                                                    |
| **Receive**               | `call_received`     | Generate or copy a receive address. Chapter 7.                           |
| **Transaction Builder**   | `edit_document`     | Compose, sign, coordinate, and broadcast a PSBT — the advanced spending path used for multisig and watch-only wallets. Chapter 8. |
| **Contacts**              | `contacts`          | Local address book of names and addresses. Chapter 10.                   |

> **Note** — **Send** is disabled for wallets that cannot produce a complete signature on their own — *watch-only* wallets and *multisig* wallets. Hovering the greyed-out entry explains why and points you to the **Transaction Builder** instead (Chapters 5 and 8).

### Group: Mining

Everything to do with plot files, the miner, and forging:

| Item                    | Icon         | Goes to                                                                     | When it appears                              |
|-------------------------|--------------|-----------------------------------------------------------------------------|----------------------------------------------|
| **Mining Dashboard**    | `hardware`   | The miner's main screen — drives, plot plan, deadlines, capacity. Ch. 20.   | Always.                                      |
| **Aggregator**          | `hub`        | The aggregator's dashboard — connected machines and accounts. Ch. 24.       | Only after you enable the aggregator (Ch24). |
| **Forging Assignment**  | `swap_horiz` | Create, check, and revoke on-chain forging assignments. Ch. 19.             | Always.                                      |

### Group: Network

Two read-only views of what Bitcoin-PoCX Core sees:

- **Blocks** — the recent block list, with height, time, and basic block details.
- **Peers** — the nodes Core is currently connected to, with their addresses, ping times, and direction.

Both are useful for diagnosing sync problems or seeing how well-connected Core is. They are covered briefly in Chapters 12 and 26.

### Footer

At the bottom of the sidebar:

- **Settings** — application-wide preferences, network, theme, language, advanced options. Chapter 12.
- **Logout** — closes the current wallet and returns you to the Wallets screen. The wallet itself is *not* deleted; it is just unloaded from the active session. This is also how you switch between wallets without restarting Phoenix.

## The toolbar

The toolbar sits above the content area and stays in place as you navigate.

![The toolbar: status indicators, wallet selector, settings, and language.](images/processed/ch06-toolbar.png){width=98%}

Reading from left to right:

### Sidenav toggle

A hamburger icon (three stacked horizontal lines), shown when the sidebar is hidden. Click it to bring the sidebar back.

### Status indicators

A row of small icons that turn solid (active) when something is running. They appear and disappear based on what you have configured:

| Icon              | Symbol      | Means…                                                                                                       |
|-------------------|-------------|--------------------------------------------------------------------------------------------------------------|
| **Node**          | `share`     | Bitcoin-PoCX Core is running. Visible only in managed mode (the icon is not shown if you use an external node). |
| **Miner**         | `hardware`  | The miner is running and scanning plots. Visible only after you have configured mining (Chapter 15).         |
| **Plotter**       | `storage`   | The plotter has work to do. Solid means actively plotting; outlined means a plan exists but is paused.       |
| **Wallet lock**   | `lock` / `lock_open` | Visible only when at least one encrypted wallet is loaded. The icon shows whether any wallet is currently unlocked for spending. |
| **Clock drift**   | `schedule`  | A small clock that colours green / amber / red according to how far your system clock has drifted from network time. Visible only when clock-drift monitoring is enabled (Chapter 12). Click it to open the **System Clock Drift** dialog (Chapter 20). |

Hovering over any of these icons reveals a tooltip with the current state in words — the clock indicator's tooltip reads, for example, *"Clock is 0.4s ahead of NTP."* They are the fastest way to confirm at a glance that the things you expect to be running really are.

### Wallet selector

To the right of the status icons is the **wallet selector** — the wallet's name with a downward chevron. Clicking it opens a menu listing every wallet you have, with per-row controls to:

- Switch the active wallet (click a row).
- Lock or unlock an encrypted wallet for the session.
- Load or unload a wallet.
- Identify watch-only wallets (eye icon) and multisig wallets (a purple group icon whose tooltip names the policy, e.g. *"2-of-3 multisig wallet"*).

A **Manage wallets** entry at the top of the menu jumps to the full Wallets screen (Chapter 5) where you can also create, import, or set up watch-only wallets.

### Settings icon

A gear icon that opens the Settings screen. The same destination as the **Settings** entry in the sidebar footer; the toolbar shortcut is just always within reach.

### Language picker

The current language code with a globe icon. Click to switch interface language. Phoenix ships with translations for many languages (settings cover this in Chapter 12).

## The content area

Everything that is *not* the sidebar or the toolbar is the content area. Each navigation entry replaces the content area with a different screen — Dashboard, Send, Receive, Mining Dashboard, and so on.

The content area scrolls independently of the sidebar and toolbar, which means status icons and navigation always remain in place even when you are deep in a long transaction list.

## A quick map of where things live

Use this as a cheat sheet while you find your way around:

| If you want to…                                       | Go to…                                                  |
|-------------------------------------------------------|---------------------------------------------------------|
| See your current balance                              | Sidebar (always visible) or Dashboard.                  |
| Receive BTCX                                          | **Receive** (sidebar → Transactions group).             |
| Send BTCX                                             | **Send** (sidebar → Transactions group).                |
| Spend from a multisig or watch-only wallet, or build a PSBT | **Transaction Builder** (sidebar → Transactions group). |
| See what arrived and what left                        | **Transactions** (sidebar → Transactions group).        |
| Manage saved names and addresses                      | **Contacts** (sidebar → Transactions group).            |
| Set up plotting and mining                            | **Mining Dashboard** (sidebar → Mining group).          |
| Coordinate multiple mining machines                   | **Aggregator** (sidebar → Mining group, when enabled).  |
| Delegate forging to a pool or another wallet          | **Forging Assignment** (sidebar → Mining group).        |
| Switch the active wallet                              | Toolbar wallet selector.                                |
| Lock or unlock an encrypted wallet for the session    | Toolbar wallet selector or wallet-lock indicator.       |
| Change theme, language, network, or node settings     | **Settings** (toolbar gear or sidebar footer).          |
| Sign out of the current wallet                        | **Logout** (sidebar footer).                            |

## What's next

You know the layout. Time to put it to use. The next chapter — **Receiving Bitcoin-PoCX** — shows you how to generate addresses, what to do with them, and how to recognise an incoming transaction. After that, Chapter 8 covers sending.
