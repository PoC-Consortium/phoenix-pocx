# Phoenix on Android: Wallet and Miner

Earlier versions of Phoenix ran on Android only as a **mining-only** client — no wallet, no keys, dependent on another machine to sign. That is no longer true. **The Android build is now a full Phoenix wallet *and* a miner.** It creates and holds wallets, sends and receives BTCX, keeps a transaction history and contacts, publishes forging assignments — and it can mine your plotted storage straight into a wallet it holds on the device, with no other computer involved.

It does this without a local Bitcoin-PoCX Core node. Android runs the **nodeless (remote) wallet** described in Chapter 26: a wallet that lives on the phone and reaches the network through Electrum servers. Everything in this chapter builds on that model, so it is worth reading Chapter 26 alongside this one.

This chapter covers the Android app end to end: installing it, creating or restoring a wallet, the one-click "mine to my own wallet" flow that is the point of the whole thing, and the Android-specific mechanics — permissions, background mining, and the seed-safety rules that matter more on a phone than anywhere else.

## What the Android build can do

The phone is now a self-sufficient participant. On its own, with no other machine, it can:

| Wallet | Mining |
|--------|--------|
| Create, restore, and hold multiple named wallets | Plot free storage (CPU, and OpenCL where supported) |
| Receive BTCX (address + QR) | Mine its plots into a **pool** in the background |
| Send BTCX (with fee presets and review) | Publish the on-chain **forging assignment** a pool needs |
| Keep transaction history and contacts | Mine straight into a wallet the phone itself holds |
| Import wallets by descriptor or single WIF key | Report into your **aggregator** (Chapter 24) as an option |

The one thing it still cannot do is **solo mine** — forging a block yourself requires a full node, which the nodeless phone does not run. Solo is disabled; pool mining (and your own aggregator) work. This is the same limit every remote-mode wallet has (Chapter 26), not an Android-specific one.

## Installing on Android

Installation is covered in Chapter 3 and recapped here. The Android build is distributed as an **APK** on the project's GitHub Releases — it is not on Google Play or F-Droid.

1. On the device, download `phoenix-pocx-wallet-<version>.apk` from the project site or GitHub Releases.
2. Open the APK; when Android warns that your browser or file manager is not allowed to install apps, tap **Settings**, enable **Allow from this source**, and return.
3. Tap **Install**, then open **Phoenix Wallet** from the app drawer.

On first launch the app opens straight into wallet onboarding — there is no node-setup wizard, because Android never runs a node.

## Setting up your wallet

The first screen is **Set up your wallet** — *"Create a new wallet or restore an existing one from its recovery phrase."* This is the same fork as the desktop Wallets screen (Chapter 5), sized for a phone.

### Creating a new wallet

- **Name it.** Give the wallet a recognisable name — it appears in the wallet switcher and list.
- **Write down the 24 words.** Phoenix generates a fresh 24-word recovery phrase and shows it once, with the blunt warning it deserves: *"These 24 words are the only backup of your wallet. Write them down on paper and keep them offline. Anyone who knows them can spend your funds."* There is no cloud backup and never will be (see *Seed safety on a phone*, below) — paper is the backup.
- **Confirm the backup.** Phoenix asks you to re-enter a few of the words from your written copy, exactly as the desktop create flow does, to prove you wrote them down.
- **Set a device passphrase (optional but recommended).** A passphrase encrypts the seed stored on the device. It is *not* part of the recovery phrase — the words alone always restore your funds — but on a phone it is what stands between a thief who picks up your unlocked device and your seed. On Android especially, **set one** (the reasoning is in *Seed safety on a phone*).

### Restoring an existing wallet

Choose **Restore wallet** and enter your 12- or 24-word phrase. Because the phone has no local blockchain to rescan, Phoenix instead checks the phrase's history against your configured Electrum server to find the right *derivation branch* — *"Restoring checks the phrase's history on the configured Electrum server to find the right derivation branch."* It then opens the wallet on the branch that holds funds.

If the phrase turns out to have history on **two** address types — the SegWit (BIP-84) branch and the Taproot (BIP-86) branch — Phoenix tells you so and offers to **create the second wallet** over the same phrase, so no funds stay hidden on a branch you did not open. You end up with both wallets, switchable from the header menu.

> **Note** — Restoring needs a configured Electrum server to probe against (Chapter 26). If none is set, Phoenix says so and sends you to the wallet settings to add one first. If a scan comes up empty because the server was still catching up, a **Scan again** action retries.

### Address type: why SegWit is the default

An **Advanced** choice at creation sets the wallet's **address type**. It matters for mining:

| Type | Addresses | Can receive mining rewards? |
|------|-----------|------------------------------|
| **SegWit (BIP-84)** *(default, recommended)* | `pocx1q…` | **Yes** — plot addresses are SegWit v0. |
| **Taproot (BIP-86)** | `pocx1p…` | **No** — taproot addresses can never be plot addresses. |
| **Legacy (pre-SegWit)** | `1…`-style | **No** — can send and receive ordinary coins only. |

Leave it on **SegWit** unless you have a specific reason not to. Only a SegWit wallet can hold a plot address, so only a SegWit wallet can mine or publish a forging assignment (Chapter 19). If you pick taproot or legacy, the mining screens will tell you to switch to a SegWit wallet before you can plot to your own key.

### Importing a wallet

Two import paths mirror the nodeless imports from Chapter 26:

- **Import a descriptor** — paste one or two private *output descriptors*. One ranged descriptor (ending `/0/*` or `/1/*`) is enough; Phoenix infers the change branch. Watch-only (xpub) descriptors are not supported yet — the private key material is required.
- **Import a single key (WIF)** — wrap a private key as `wpkh(YOUR_WIF)` to import it as a one-address SegWit wallet. This is the way to bring a vanity address or a stand-alone plotting key onto the phone; change returns to that same address.

## Getting around: the navigation drawer

Once a wallet is open, a **navigation drawer** (the menu icon at the top-left) reaches every part of the app — wallet home, receive, send, history, contacts, forging assignment, mining, and settings. The wallet's name sits at the top of the header with a **switcher**: tap it to jump between your wallets. Switching closes the open wallet and opens the chosen one — *"the open wallet closes first."*

From the same wallet menu you can **rename** or **delete** a wallet (both require switching away from it first — the active wallet cannot be renamed or deleted). Deletion is safe: *"Its files are moved to the trash folder on this device — nothing is destroyed, and the recovery phrase always restores the funds."* A wallet still on the legacy coin type also shows an **Upgrade to v31** item here (Chapter 5); tapping it upgrades in place. If the wallet's seed is passphrase-locked, Phoenix asks you to *"unlock the wallet first, then upgrade."*

The everyday wallet screens — **Receive** (address and QR), **Send** (recipient, amount, fee presets or custom, and a review step before broadcast), **Transaction history**, and **Contacts** — work as their desktop counterparts do in Chapters 7–10, laid out for a small screen. Sending signs on the device and broadcasts through your Electrum server. The wallet-home balance card carries the same **Balance details** shortcut (the coin-stack icon) as the desktop, opening the per-address coin breakdown described in Chapter 9 — laid out for the phone as a vertical **stack of cards**, one per funding address, each showing the address with its balance, coin count, and the *public-key-known* flag beneath it, with a refresh button in the header.

## The point of it all: mine to your own wallet

The reason Android became a full wallet is a single flow: **plot your phone's storage and mine straight into a wallet the phone holds — with no addresses to copy from anywhere else.** On the wallet home a card invites you in — **Mine to this wallet**: *"Plot free storage space and earn mining rewards straight into this wallet."*

Tapping through takes you into the mining setup (Chapter 15). The difference from a manual setup is the plotting address: instead of pasting an address from another machine, you choose **Use wallet address**, and Phoenix fills in an address the phone's own wallet controls. Plot to that address, mine into a pool, and the rewards land in the wallet you are already looking at.

The flow works in both directions. If you open mining setup first without a wallet yet, Phoenix nudges you to **Create wallet**, then returns you to the wizard with the new wallet's address ready to use. If the wallet is locked, an inline unlock appears. A custom address is still first-class — you can always type an address from elsewhere — but for the common case of "a spare phone earning into my own keys," there is nothing to paste.

> **Note** — Because only a SegWit wallet can own a plot address, the *Use wallet address* option requires the active wallet to be SegWit (see above). With a taproot or legacy wallet active, the wizard tells you to switch to a SegWit wallet or enter an address manually.

## Seed safety on a phone

A phone is a small, easily lost, always-online device, so the rules about the recovery phrase — true everywhere in this handbook — bite hardest here.

- **The 24-word phrase is the only backup. There is no cloud backup, by design.** Android's automatic app-data backup is **deliberately disabled** for Phoenix, specifically so that your seed can never be swept up into Google Drive or any other cloud. This is a security decision, not an oversight: a seed that reaches the cloud is a seed outside your control. The consequence is simple and non-negotiable — **if you lose the phone and have not written the words down, the funds are gone.** Write them on paper before you fund the wallet.
- **Set a device passphrase.** Without one, the seed stored on the device is only lightly obfuscated — adequate against a casual glance, not against someone determined who has your unlocked phone. A device passphrase encrypts the seed at rest. (A hardware-backed Android Keystore option is planned to strengthen this further; until then, the passphrase is your protection.)
- **The wallet is a hot wallet.** An open, unlocked wallet on the phone can spend, and so can whatever controls the screen. Lock the wallet when you are done (the settings screen has **Lock wallet**), use your device's own screen lock, and do not hold more on a phone than you would carry in a physical wallet. For serious balances, keep the bulk in a wallet on a machine you control more tightly and treat the phone as spending money.

> **Warning** — No legitimate person, and no part of Phoenix, will ever ask for your 24 words. Anyone who does is trying to steal from you. Phoenix shows the phrase exactly once, at creation; after that it never asks for it again.

## The two permissions Android mining needs

Mining (not the wallet) needs two Android permissions. Both are essential; background mining will not work reliably without them.

### All files access (storage permission)

To detect and read plot files, Phoenix needs Android's **All files access** permission (formally `MANAGE_EXTERNAL_STORAGE`, introduced with Android 11). Plot files are large and live in ordinary storage; Android's default scoped-storage model does not let an app read arbitrary plot folders, so the broader permission is required.

When Phoenix needs it, it shows a prompt explaining that it needs *"All files access"* to detect and read plot files, and offers to open the system settings where you grant it. Tap through, enable the permission for Phoenix, and return.

![The in-app All files access prompt on Android.](images/processed/ch23-all-files-access.png){width=55%}

> **Note** — Without All files access, Phoenix cannot see your plot files at all — a configured plot folder will appear empty even when it is full. If a plot folder shows nothing on Android, this permission is the first thing to check.

### Battery optimisation exemption

By default, Android aggressively suspends background apps to save power — which would kill mining the moment the screen turns off. Phoenix requests a **battery optimisation exemption** so the system leaves it running. Grant it when prompted; without it, mining stops whenever the device idles.

## How background mining stays alive

Once permissions are granted and mining starts, Phoenix keeps itself running through two Android mechanisms you will see evidence of but do not configure directly.

### The foreground service

Android only guarantees that a **foreground service** keeps running when the app is backgrounded. Phoenix starts one whenever mining (or plotting) is active. The visible sign is a **persistent notification** in your status bar for as long as the work continues — it shows the current activity and carries a **Stop** button so you can halt mining without opening the app.

![The persistent mining notification on the Android lock screen.](images/processed/ch23-notification.png){width=55%}

The notification is not optional and cannot be dismissed while mining runs — that is how Android distinguishes a legitimate background worker from an app trying to run unseen. Treat it as the at-a-glance indicator that your phone is still mining.

### The wake lock

Alongside the foreground service, Phoenix holds a **partial wake lock**. This keeps the device's CPU running with the screen off, so scans still happen when a new block arrives at 3 a.m. with the phone on your nightstand. The screen stays off; only the processor is kept from sleeping.

Between the foreground service, the wake lock, and the battery exemption, a correctly set-up Android miner keeps mining through screen-off, idle, and overnight — stopping only when you tap **Stop**, the battery runs down, or the app is force-closed.

## Configuring mining on Android

The mining setup is the same three-step wizard as on desktop (Chapter 15), with a few Android-specific differences.

### Plot folders by path

Desktop Phoenix opens a native folder picker; Android does not have an equivalent that works for arbitrary storage, so you **type the plot folder path** directly. The app shows an example to follow — typically something under the device's shared storage, for example:

```
/storage/emulated/0/PoCX/plots
```

Enter the full path to the folder where your plots live (or should be generated), and Phoenix scans it the same way it scans a desktop drive. External storage — a microSD card or a USB-OTG drive — has its own path, which your device's file manager can show you.

> **Tip — plot on a desktop, then transfer to the phone.** On-device plotting works, but a mobile processor is slow at it. The smoother approach is to generate the plot files on a desktop machine — fast CPU or GPU plotting (Chapters 16–17) — using the *same plotting address* you will use on the phone, then copy the finished `.pocx` files onto the device (or onto a microSD card you move into it). Point Android's plot folder at where you placed them and the phone goes straight to mining with no plotting wait. Keep the heavy, one-time work on hardware suited to it; leave the phone the light part.

### The plotting address is now your own

Because Android now holds wallets, the plotting address can come from the phone itself — the **Use wallet address** flow above fills in an address the device controls. You can still **enter an address manually** if you want to mine into a wallet held elsewhere; both are supported. When you plot to your own wallet, the rewards a pool pays out land directly in it.

### No solo option

Solo mining is disabled on the nodeless phone (Chapter 26). The chain configuration omits it — *"Solo mining is not available on mobile devices."* Configure a **pool** chain, or point the device at your **aggregator** (Chapter 24). Pool mining also needs a forging assignment (Chapter 19), which the phone publishes for you over Electrum; most pools run a faucet to cover the small assignment fee.

## Realistic expectations

A phone is not a mining rig, but mining itself is light enough that an Android device handles it comfortably — the realistic limits are about storage and one-time plotting, not wear.

- **Capacity is whatever storage the device has** — from a couple of gigabytes of spare internal storage up to a terabyte or more on a large microSD card or a USB-OTG drive. You participate with your fraction of network capacity like any miner; the phone simply contributes a smaller share, which is perfectly fine.
- **Mining is gentle on the device.** Forging is read-only and low-CPU (Chapter 13): the phone reads a small slice of its plots every couple of minutes and is otherwise idle. Power draw is minimal and ongoing wear is negligible. Leaving an old device mining indefinitely is reasonable.
- **Plotting is the only heavy part — so do it elsewhere.** The slow, processor-intensive work is *plotting*, not mining. Generate plots on a desktop and transfer them; the phone then only ever does the light mining work. On-device plotting is available if you prefer it, but it is slow and is the one workload that will warm the phone for a while. When you do plot on the device, the wizard's memory estimate (Chapter 15) counts the phone's free **swap** (zram / memory-extension) on top of physical RAM, since the plotter can draw on it — an **Available Swap** line appears alongside available RAM.

The most self-contained Android setup is now genuinely self-contained: **a spare phone that holds its own wallet, plots a microSD card, and mines into a pool — rewards landing in keys the phone controls, nothing to copy from another machine.** If you already run a farm, the same device can instead report into your aggregator (Chapter 24) — an option, not a requirement.

> **Tip** — An old phone or tablet with a large microSD card or a USB-OTG drive is a tidy way to put retired hardware to work — the end-of-life-hardware logic of Chapter 14 applied to mobile. Create a wallet on it, pre-load plots from your desktop, point it at a pool, and leave it running.

## What's next

The Android device is a complete wallet-plus-miner in your pocket. If you run several machines and want them coordinated around one hub rather than each pointed at a pool, the next chapter is for you. **Chapter 24 — Orchestrating Multiple Machines with the Aggregator** covers turning one Phoenix instance into the hub of a multi-machine farm, with the others — Android included — submitting their solutions to it.
