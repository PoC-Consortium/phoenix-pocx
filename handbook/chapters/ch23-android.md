# Mining on Android

Phoenix PoCX runs on Android, but in a deliberately reduced form. The Android build is a **mining-only** client: it contributes storage capacity to the network, but it does not run a node, does not create or hold wallets, and cannot mine solo. This chapter explains what the Android build can and cannot do, and walks through the permissions and settings that keep it mining reliably in the background.

## What the Android build is — and is not

The Android app exists for one purpose: to turn a phone or tablet's storage (or attached storage) into mining capacity. Everything that needs a full node or a wallet is intentionally absent.

| The Android build **can**…                  | The Android build **cannot**…                                              |
|---------------------------------------------|----------------------------------------------------------------------------|
| Plot drives (CPU, and OpenCL where supported) | Run a Bitcoin-PoCX Core node — Android has no managed node.               |
| Mine its plots in the background            | Create, import, or hold a wallet — there is no key management on Android.   |
| Submit to a pool or an aggregator           | Mine **solo** — solo requires a local node, which Android does not have.    |
| Keep mining with the screen off            | Sign its own blocks — there is no signing wallet on the device.            |

Because it has no node and no wallet, an Android miner is always part of a *larger* setup. It produces mining solutions and sends them somewhere that *can* sign blocks:

- **To a pool** — the Android device submits to a pool, which forges and pays out. This is the simplest Android setup.
- **To an aggregator** — the Android device submits to a Phoenix aggregator running on another machine you control (Chapter 24), which signs with its wallet. This is the way to fold a phone into your own farm.

In both cases, the signing and the rewards happen elsewhere; the phone just contributes capacity. This is the Android expression of the three-pieces architecture from Chapter 13 — Android provides plots and a miner, never the signing wallet.

## Installing on Android

Installation is covered in Chapter 3 and recapped here. The Android build is distributed as an **APK** on the project's GitHub Releases — it is not on Google Play or F-Droid.

1. On the device, download `phoenix-pocx-wallet-<version>.apk` from the project site or GitHub Releases.
2. Open the APK; when Android warns that your browser or file manager is not allowed to install apps, tap **Settings**, enable **Allow from this source**, and return.
3. Tap **Install**, then open **Phoenix PoCX Wallet** from the app drawer.

On first launch the app goes straight into mining-only mode — there is no node setup wizard and no wallet-creation flow, because neither applies on Android.

## The two permissions Android mining needs

Background mining on a modern Android device requires two permissions that the app will request. Both are essential; mining will not work reliably without them.

### All files access (storage permission)

To detect and read plot files, Phoenix needs Android's **All files access** permission (formally `MANAGE_EXTERNAL_STORAGE`, introduced with Android 11). Plot files are large and live in ordinary storage; the scoped-storage model Android uses by default does not let an app read arbitrary plot folders, so the broader permission is required.

When Phoenix needs it, it shows a prompt explaining that it needs *"All files access"* to detect and read plot files, and offers to open the system settings where you grant it. Tap through, enable the permission for Phoenix, and return to the app.

![The in-app All files access prompt on Android.](images/processed/ch23-all-files-access.png){width=55%}

> **Note** — Without All files access, Phoenix cannot see your plot files at all — the drive will appear empty even if it is full of plots. If a configured plot folder shows nothing on Android, this permission is the first thing to check.

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

> **Tip — plot on a desktop, then transfer to the phone.** On-device plotting on Android works, but a mobile processor is slow at it; depending on how much capacity you are plotting it can take a while. The smoother approach is to generate the plot files on a desktop machine — fast CPU or GPU plotting (Chapters 16–17) — using the *same plotting address* you will configure on the phone, then copy the finished `.pocx` files onto the device's storage (or onto a microSD card you move into it). Point Android's plot folder at where you placed them, and the phone goes straight to mining with no plotting wait. This keeps the heavy, one-time work on hardware suited to it and leaves the phone to do the light part.

### The plotting address must come from elsewhere

Because Android holds no wallet, it cannot offer you a *"use wallet address"* option for the plotting address. You **enter the address manually** — an address from a wallet you control on another machine (Chapter 7). The plots you generate on Android are tied to that address; the rewards, once the solutions are signed by a pool or your aggregator, flow to it.

This is the natural consequence of Android being mining-only: the phone plots and mines, but the *ownership* lives in a wallet on a device that can hold keys.

### No solo option

The chain configuration omits solo mining on Android — the wizard tells you *"solo mining is not available on mobile devices."* Configure a **pool** chain, or point the device at your **aggregator** (Chapter 24). One of those is required for an Android miner to do anything useful.

## Realistic expectations

A phone is not a mining rig, but mining itself is light enough that an Android device handles it comfortably — the realistic limits are about storage and one-time plotting, not about wear.

- **Capacity is whatever storage the device has.** Depending on the device and what you attach to it, that ranges from a couple of gigabytes of spare internal storage up to a terabyte or more on a large microSD card or a USB-OTG drive. You participate with your fraction of network capacity, exactly as any miner does; the phone is simply contributing a smaller share than a full rig would. That is perfectly fine — a phone pointed at a pool earns its proportional keep like any other contributor.
- **Mining is gentle on the device.** Forging is read-only and low-CPU (Chapter 13): the phone reads a small slice of its plots every couple of minutes and is otherwise idle. Power draw is minimal and ongoing wear is negligible — mining does not stress a phone the way a game or sustained video does. Leaving an old device mining indefinitely is perfectly reasonable.
- **Plotting is the only heavy part — so do it elsewhere.** The slow, processor-intensive work is *plotting*, not mining. As noted above, generate plots on a desktop and transfer the finished files to the phone; the device then only ever does the light mining work. On-device plotting is available if you prefer it, but it is slow and is the one workload that will actually warm the phone for a while. When you do plot on the device, the setup wizard's memory estimate (Chapter 15) counts the phone's free **swap** (zram / memory-extension) on top of physical RAM, since the plotter can draw on it — an **Available Swap** line appears alongside available RAM.

The most common Android setup is the simplest one: **a phone mining into a pool, on its own.** It does not need another machine, an aggregator, or anything else on your network — just the pool configuration (and the forging assignment that pool mining requires, Chapter 19). A spare phone with a microSD card, pointed at a pool, is a complete and self-sufficient miner. If you *do* already run a farm, the same device can instead report into your aggregator (Chapter 24) — but that is an option, not a requirement.

> **Tip** — An old phone or tablet with a large microSD card or a USB-OTG drive is a tidy way to put retired hardware to work — the same end-of-life-hardware logic from Chapter 14, applied to mobile devices. Pre-load it with plots from your desktop, point it at a pool, and leave it running.

## What's next

If the Android device — or any of your miners — should report into a central coordinator rather than a pool, the next chapter is for you. **Chapter 24 — Orchestrating Multiple Machines with the Aggregator** covers turning one Phoenix instance into the hub of a multi-machine farm, with the others (Android included) submitting their solutions to it.
