# Phoenix Wallet 2.2.0

The biggest update since 2.1 — a redesigned wallet model built around **pockets**, more reliable balance syncing, and full translations across every supported language.

## Wallet pockets

Your wallet is now organized around a single recovery phrase with switchable **pockets**, instead of a cluster of separate sibling wallets and upgrade/recover buttons:

- **One wallet, one recovery phrase.** Each wallet shows as a single entry, and inside it are its pockets — **SegWit** (recommended; the one that receives mining rewards), **Taproot**, and, if you hold older coins, a **legacy (v30)** pocket. Switch pockets from the wallet selector, or from the pocket chip next to the wallet name in the toolbar.
- **Restoring is simpler.** Restore your recovery phrase and all of its pockets are set up for you automatically — no more "Upgrade to v31", "recover old funds", or create-both prompts.
- **Older (v30) coins are spend-only.** They show up as a spend-only pocket you can drain into your current SegWit or Taproot pocket. Receiving into a legacy pocket is blocked, so no new funds ever land back in the retired branch.
- **Rename or delete** a wallet and all its pockets together — swipe a wallet in the selector on mobile, or use the selector on desktop.

## Balances that stay correct

- **Funds sent to another device's address now show up.** If you use the same recovery phrase on more than one device, money sent to an address a *different* device handed out is now discovered automatically — no more balance appearing "stuck" at an older value while the block height keeps climbing.
- **Incoming payments appear right away** instead of waiting for the next block to confirm.

## Now fully translated

The app is now translated across all 25 supported languages. Previously many screens — including much of the wallet and settings — fell back to English.

## Also improved

- **Coins** page: a cleaner stacked-card layout on mobile.
- **Mining**: the network-capacity chart is now a live trailing-window graph.
- **Fees**: more reliable first-attempt fee bumping, and finer fee-rate control and display.
- Numerous **Android / mobile** fixes for Send, Receive, and forging assignments.
