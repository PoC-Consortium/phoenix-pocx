# Screenshots to capture — 2.3.0 sync (based on `2d92ad5`)

The 2.3.0 unified-UI release restyled several documented screens. Wired images
keep working until replaced; this list is what needs a retake (or is new).
Desktop shots can be captured from a dev session; Android shots need a device
running the hybrid (Phoenix Suite) build unless noted.

## Desktop — retakes

| Image | Why |
|-------|-----|
| ~~`ch06-main-window.png`~~ | DONE 2026-07-23. |
| ~~`ch06-sidebar.png`~~ | DONE 2026-07-23 (extracted from main-window). |
| ~~`ch06-toolbar.png`~~ | DONE 2026-07-23 (extracted from main-window). |
| ~~`ch07-receive.png`~~ | DONE 2026-07-23. |
| ~~`ch08-send.png`~~ | DONE 2026-07-23. |
| ~~`ch08-send-confirm.png`~~ | DONE 2026-07-23 (retaken with the BTCX copy fix). |
| ~~`ch09-transactions-list.png`~~ | DONE 2026-07-23. |
| ~~`ch09-transaction-detail.png`~~ | SKIPPED per Johnny — existing shot still good. |
| ~~`ch19-assignment-tabs.png`~~ | DONE 2026-07-23 (card crop; ch19 text reworked to the tabless card). |
| ~~`ch19-create-assignment.png`~~ | REMOVED per Johnny — prose only. |
| ~~`ch19-check-status.png`~~ | REMOVED per Johnny — the card shot covers status. |

## Android — retakes (device required)

| Image | Why |
|-------|-----|
| `ch23-toolbar.png` | Miner status icon next to the Electrum bolt; the "Wallet" app-name text is gone. |
| `ch23-nav-drawer.png` | MINING group (Mining Dashboard + Forging Assignment); balance shrinks-to-fit. |
| `ch23-wallet-setup.png` | Create flow now shows the BIP39 passphrase (25th word) option. |
| `ch23-mobile-receive.png` | Receive redesigned (selector-first; amount/label collapse on phones). |
| `ch23-mobile-send.png` | Send redesigned (compact fee chips, amount+MAX row). |
| `ch23-v30-receive-blocked.png` | Same receive redesign around the blocked state. |
| `ch23-notification.png` | Notification now shows "Block N — best deadline Xs" (once per round). |

## Android — new shots

| Proposed name | Content |
|---------------|---------|
| `ch23-bottom-nav.png` | The bottom navigation bar: Wallet · Mining · Dashboard. |
| `ch23-mining-in-shell.png` | Mining dashboard inside the wallet shell (drawer + adapted toolbar visible, miner icon green). |
| `ch23-settings-notifications.png` | The mobile Settings Notifications card (master + payment/connection toggles, mining-always-on hint). |
| `ch23-launcher-flavors.png` | *(nice-to-have)* Home screen with Phoenix Suite / Phoenix Wallet / Phoenix Miner icons side by side. |
| `ch09-history-phone-funnel.png` | *(optional)* Phone transactions header with the funnel open (filter row + load-limit inside). |

## Notes

- The remote-mode transaction **detail** page renders the same layout as the
  Core-mode shot (`ch09-transaction-detail.png`), so no separate remote capture
  is needed.
- Wizard (`ch15-*`) and plotter (`ch16-*`) shots are unchanged — the drives
  summary only re-sizes at phone widths, which the desktop shots do not show.
