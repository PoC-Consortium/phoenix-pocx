# Screenshots to capture — 2.3.0 sync (based on `2d92ad5`)

The 2.3.0 unified-UI release restyled several documented screens. Wired images
keep working until replaced; this list is what needs a retake (or is new).
Desktop shots can be captured from a dev session; Android shots need a device
running the hybrid (Phoenix Suite) build unless noted.

## Desktop — retakes

| Image | Why |
|-------|-----|
| `ch06-main-window.png` | Unified dashboard layout (recent list, view-all). |
| `ch06-sidebar.png` | Version tag now lives in the sidenav header. |
| `ch06-toolbar.png` | Miner indicator styling; if shot in remote mode, the clock-drift icon is gone there now. |
| `ch07-receive.png` | Receive redesigned: selector-first, first-unused preselect, "(v30)" tags, address + payment-URI copy rows. |
| `ch08-send.png` | Fee selector is the compact 4-across chip row; the separate estimated-fee line is gone (summary carries it). |
| `ch08-send-confirm.png` | Confirm dialog is the (converged) review step. |
| `ch09-transactions-list.png` | New header: export / load-limit icon-menu / one-tap refresh; fit-derived paging (no page-size picker). |
| `ch09-transaction-detail.png` | Header aligned to the balance-band height (minor). |
| `ch19-assignment-tabs.png` | Page unified on the mobile design (section labels, spacing). |
| `ch19-create-assignment.png` | Same + the pre-existing TODO (select-or-enter forging address). |
| `ch19-check-status.png` | Same restyle. |

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
