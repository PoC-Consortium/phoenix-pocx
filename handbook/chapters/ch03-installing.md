# Installing Phoenix PoCX

This chapter walks you through downloading and installing Phoenix PoCX on your computer or phone. The process is short, but a few platform-specific quirks are worth knowing about — especially the security warnings that appear because the desktop installers are not yet code-signed.

> **Note** — You only need to install **Phoenix PoCX** itself. The Bitcoin-PoCX Core node, which Phoenix needs to talk to the network, is downloaded automatically on first launch (Chapter 4). You do not have to fetch it separately.

## What you will be installing

A single application that bundles the wallet, the node manager, the plotter, the miner, and the optional aggregator. There are separate builds for each operating system; pick the one that matches your machine.

| Platform | What you download         | Recommended for                                                                  |
|----------|---------------------------|----------------------------------------------------------------------------------|
| Windows  | NSIS installer (`.exe`)   | Windows 10 or later                                                              |
| macOS    | Disk image (`.dmg`)       | macOS 10.13 (High Sierra) or later                                               |
| Linux    | `AppImage`, `.deb`, `.rpm`| Most modern distributions                                                        |
| Android  | APK (`.apk`)              | Android 7 (API 24) or later — full **wallet + miner**, nodeless (no solo mining)   |

## System requirements

Modest, with one exception: if you intend to mine, you will want significantly more disk space than the wallet itself needs.

- **Wallet only.** Roughly 500 MB for the wallet, plus a few gigabytes that the node will gradually use as the blockchain grows. Any modern laptop or desktop is more than enough.
- **Mining as well.** Add as much storage as you plan to plot — typically terabytes. CPU plotting works on any multi-core machine; GPU plotting needs a discrete or integrated GPU with up-to-date OpenCL drivers (Nvidia, AMD, or Intel).
- **Internet connection.** A reliable connection is needed to keep the node in sync. Mobile tethering works in a pinch but is not recommended for long-running mining.

> **Warning** — **If you intend to mine, your system clock must stay synchronised with real time.** Bitcoin-PoCX rejects blocks whose timestamps differ from the local clock by more than **15 seconds** in either direction — compared with Bitcoin's two-hour tolerance, this is a very tight window. The default network time service on Windows, macOS, and Linux is usually sufficient, but make sure it is enabled and not suppressed by an aggressive power-saving profile. A miner with a drifting clock will silently underperform: blocks arrive late, deadlines are missed, and your own valid blocks may be rejected by peers. Chapter 20 covers clock-related troubleshooting in more detail.

A separate hardware planning chapter (Chapter 14) goes into detail for miners.

## Where to download

There are two equivalent download sources.

- **The project website** — the easiest route for most users. It lists the latest stable release for each platform with a single clickable button.

  <https://bitcoin-pocx.org>

- **GitHub Releases** — a complete archive of every published version, plus their checksum files and release notes. Useful if you want to install a specific version, or if you prefer to verify your download by hand.

  <https://github.com/PoC-Consortium/phoenix-pocx/releases>

Always download from one of these two sources. Phoenix PoCX is *not* distributed through any third-party download site, browser extension store, app store (other than the Android channel described below), or social-media link.

> **Warning** — Phishing copies of cryptocurrency wallets are common. If you ever land on a "Phoenix PoCX" download page that does not match one of the URLs above, close the page. Bookmark the real download page in your browser so you can return to it directly.

## Verifying your download (recommended)

Each release on GitHub ships with a `SHA256SUMS` file that lists the SHA-256 checksum of every installer in that release. Verifying the checksum confirms that the file you downloaded has not been tampered with on its way to you.

The procedure differs slightly per operating system, but the idea is the same: compute the SHA-256 of the downloaded installer and compare it with the value listed in `SHA256SUMS`.

**Windows (PowerShell):**

```powershell
Get-FileHash .\Phoenix-PoCX-Wallet_2.0.0_x64-setup.exe -Algorithm SHA256
```

**macOS / Linux:**

```bash
shasum -a 256 Phoenix-PoCX-Wallet_2.0.0_x64.dmg     # macOS
sha256sum Phoenix-PoCX-Wallet_2.0.0_amd64.AppImage  # Linux
```

The output is a 64-character hexadecimal string. It must match — character for character — the corresponding line in the `SHA256SUMS` file from the same release. If it does not match, **delete the file and download it again**; do not run it.

> **Note** — Filenames in the example commands include the version (`2.0.0`). Substitute the actual filename of the installer you downloaded.

## A note on code signing

Phoenix PoCX desktop installers are **not yet code-signed**. Because of this:

- **Windows** will show a Microsoft SmartScreen warning the first time you run the installer.
- **macOS** will show a Gatekeeper "unidentified developer" warning the first time you launch the wallet.
- **Linux** distributions do not enforce code signing for end-user binaries, so no extra warning appears.
- **Android** requires every APK to be signed by its publisher, so there is no extra warning beyond the standard "install unknown apps" permission described below.

The platform-specific instructions below explain how to proceed past each warning. Code signing is on the project roadmap; once implemented, these warnings will disappear and you can ignore the relevant workaround sections.

## Installing on Windows

1. Download `Phoenix-PoCX-Wallet_<version>_x64-setup.exe` from the website or GitHub Releases.
2. Because the installer is not yet signed, your browser **may** warn during the download that the file *"isn't commonly downloaded"* or *"could harm your device,"* and may appear to block it. This is the same unsigned-software caution, just at download time. In Microsoft Edge, hover the blocked download and click the **…** (more actions) button, then choose **Keep**.

    ![Edge flags the unsigned installer at download time â€” open the more-actions menu and choose Keep.](images/processed/ch03-windows-edge-keep-1.png){width=58%}

    Edge then shows a second confirmation — *"This app isn't commonly downloaded…"* — where you click **Keep anyway** (you may need **Show more** first). Other browsers have an equivalent "keep" or "download anyway" step. (If your browser downloads the file without complaint, nothing is wrong — just continue.)

    ![The follow-up confirmation â€” choose Keep anyway.](images/processed/ch03-windows-edge-keep-2.png){width=42%}

3. (Recommended) Verify the SHA-256 checksum as described above.
4. Double-click the installer. Windows SmartScreen **may** appear with the message *"Windows protected your PC"* — the second, run-time warning, again because the installer is not yet signed. If it does, click **More info**, then **Run anyway**.

    ![Windows SmartScreen at run time, expanded to show Run anyway.](images/processed/ch03-windows-smartscreen.png){width=55%}

5. The installer launches. Follow the prompts: choose an installation folder (the default is fine) and click **Install**.
6. By default Phoenix installs *for the current user* and does not require administrator privileges. When the installer finishes, you can launch the wallet from the Start menu.

> **Note** — You may see **both** warnings, **one**, or **neither**. Windows only shows the SmartScreen prompt for files it considers downloaded-from-the-internet and not yet widely trusted, and only when SmartScreen is enabled — so depending on your browser, your settings, and how widely the release has already been downloaded, you may not be prompted at all. Seeing no warning does not mean anything is wrong. (Once the installers are code-signed, in a future release, these prompts disappear entirely.)

> **Tip** — Phoenix runs without administrator rights for normal use. If you intend to plot on Windows, see Chapter 16 — some plot-file allocation paths on NTFS run faster when the wallet is launched as administrator. Phoenix offers a one-click "restart as administrator" option when this matters; you do not have to elevate manually.

## Installing on macOS

1. Download `Phoenix-PoCX-Wallet_<version>_x64.dmg` (Intel Macs) or `Phoenix-PoCX-Wallet_<version>_aarch64.dmg` (Apple Silicon).
2. (Recommended) Verify the SHA-256 checksum.
3. Open the disk image and drag **Phoenix PoCX Wallet** into your **Applications** folder.
4. Eject the disk image (drag it to the Trash or right-click → **Eject**).
5. Open **Applications** in Finder and locate **Phoenix PoCX Wallet**. The first time you launch it, macOS may ask you to confirm that you really want to open an application downloaded from the internet, because the app is not yet signed by an identified developer. The exact prompt varies by macOS version — it ranges from a simple *"are you sure you want to open it?"* confirmation to a fuller *"cannot be opened because the developer cannot be verified"* warning.
6. To get past it, **right-click** (or Control-click) the application icon in Finder and choose **Open** from the menu, then confirm with **Open** in the dialog that appears. macOS remembers your choice, so subsequent launches open normally with no prompt.

> **Note** — On macOS Sonoma (14) and later, you may instead need to allow the application from **System Settings → Privacy & Security**, where a button labelled *"Open Anyway"* appears the first time you try to launch. Whichever form the prompt takes, you only have to do this once. (Once the macOS build is signed and notarised, in a future release, no prompt appears at all.)

## Installing on Linux

You have three packaging options. Pick the one that suits your distribution.

### AppImage (works on most distributions)

1. Download `Phoenix-PoCX-Wallet_<version>_amd64.AppImage`.
2. (Recommended) Verify the SHA-256 checksum.
3. Make the file executable:

    ```bash
    chmod +x Phoenix-PoCX-Wallet_2.0.0_amd64.AppImage
    ```

4. Run it:

    ```bash
    ./Phoenix-PoCX-Wallet_2.0.0_amd64.AppImage
    ```

The AppImage is self-contained and does not need to be installed system-wide. To integrate it into your application launcher, tools such as **AppImageLauncher** can register it automatically.

### Debian / Ubuntu (`.deb`)

1. Download `Phoenix-PoCX-Wallet_<version>_amd64.deb`.
2. (Recommended) Verify the SHA-256 checksum.
3. Install with `apt`:

    ```bash
    sudo apt install ./Phoenix-PoCX-Wallet_2.0.0_amd64.deb
    ```

`apt` resolves dependencies automatically. Phoenix appears in your application menu under **Finance**.

### Fedora / RHEL / openSUSE (`.rpm`)

1. Download `Phoenix-PoCX-Wallet_<version>_x86_64.rpm`.
2. (Recommended) Verify the SHA-256 checksum.
3. Install with `dnf` (Fedora/RHEL) or `zypper` (openSUSE):

    ```bash
    sudo dnf install ./Phoenix-PoCX-Wallet_2.0.0_x86_64.rpm
    # or
    sudo zypper install ./Phoenix-PoCX-Wallet_2.0.0_x86_64.rpm
    ```

## Installing on Android

The Android build is distributed as an APK on GitHub Releases — Phoenix PoCX is not currently published on Google Play or F-Droid.

> **Note** — The Android build is a full **wallet and miner**. It holds its own wallets and can mine into them, without running a local node — it syncs over Electrum servers, the nodeless (remote) model of Chapter 26. It cannot *solo* mine (that needs a full node), but it can send, receive, hold wallets, and pool-mine on its own. Chapter 23 covers Android in detail.

1. On your Android device, open a browser and navigate to the project website or GitHub Releases.
2. Download `phoenix-pocx-wallet-<version>.apk`. Android may warn that the file can be harmful — this caution appears for any APK downloaded outside the Play Store. If prompted, tap **Download anyway**.
3. Open the downloaded APK from your browser's downloads or from the **Files** app.
4. The first time you install an APK this way, Android may tell you that your browser (or file manager) is "not allowed to install apps from this source." If you see this, tap **Settings** in the prompt, toggle **Allow from this source** on, and return to the install screen. (Depending on your device and Android version, and whether you have installed APKs before, you may not see this prompt at all — in which case there is nothing to do.)
5. Tap **Install**. After a moment, the wallet appears in your app drawer as **Phoenix PoCX Wallet**.

When you launch Phoenix on Android for the first time, it will ask for two permissions that mining needs: **All files access** (so the miner can read plot files on external storage) and **Battery optimisation exemption** (so the foreground mining service is not killed when the screen is off). Chapter 23 covers Android-specific setup in detail.

## Updating Phoenix PoCX

Updates are not yet delivered automatically. To install a new version:

- **Windows / macOS / Linux** — download the new installer from the same source, then run it. Your wallet data, settings, and plot configuration are preserved across updates.
- **Android** — download the new APK and install it over the previous version (your data is preserved). You may need to allow the install from the same "Allow from this source" prompt as before.

The wallet itself notifies you when a new version of the underlying Bitcoin-PoCX Core node is available, and offers to download and install the node update with a single click — that is a separate flow from updating Phoenix and is covered in Chapter 12.

## What's next

With Phoenix PoCX installed, you are ready to start it for the first time. The next chapter walks you through the first-launch wizard, where you choose between the **managed** and **external** node modes, pick a network, and watch the node sync to the rest of the chain.
