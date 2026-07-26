# Phoenix Wallet 2.4.0

The wallet-lifecycle release: creating, restoring and switching wallets is now ONE set of flows across desktop and mobile, Core and Electrum — plus a structural fix that makes running several Phoenix instances safe.

## Added

- **BIP39 25th word for multisig.** The multisig wizard's seed step now offers the optional 25th word — folded into the m/48' share derivation on both "generate new" and "I already have a seed", so a passphrase-protected share round-trips to the identical key.
- **Locked wallets are usable from desktop.** Opening or switching to a passphrase-locked Electrum wallet prompts for the passphrase everywhere (wallet page, toolbar switcher) instead of failing silently; unlocking opens and activates the wallet. Fee bump (RBF) and CPFP now also prompt on a locked Core wallet instead of showing a raw RPC error.
- **Wallet rename & delete on desktop (Electrum mode)** — the mobile switcher's swipe actions arrive on desktop via the shared wallet menu.
- **"Generate new" phrase button** on the mobile create flow (desktop parity).
- **Forging assignments: check any address.** The plot-address field accepts free entry again (with the wallet's addresses as suggestions) — paste any address to check its assignment status.

## Changed

- **One create wizard.** Desktop and mobile share the same 4-step create flow (name · phrase+25th word · verify · protect) with step progress, prefilled wallet names, and visible name-conflict messages — Core and Electrum alike.
- **One restore page.** Desktop "Import Wallet" is now the same single restore page as mobile, including the branch report and the scan-again retry on an empty verdict.
- **One wallet switcher (Electrum mode).** The desktop toolbar uses the mobile wallet menu: one open wallet, no fake load/unload rows, lock badge only when a wallet is genuinely locked. "Manage Wallets" just visits the page (the open wallet stays active); Logout closes and locks the wallet.
- **Deterministic mining address.** The mining setup wizard and the assignment page suggest the wallet's FIRST derivation (index 0) in every mode — the same address for the same wallet, everywhere, shown immediately.
- **Recovery phrases copy cleanly.** Selecting and copying a displayed phrase yields only the words — the numbering is no longer copyable text. Secret fields show a single reveal toggle (the browser's own extra eye icon is gone).

## Fixed

- **Running two Phoenix instances no longer corrupts the wallet registry.** Config saves are merge-safe under a cross-process lock and only happen when something actually changed — a second instance (or a stale one) can no longer overwrite freshly created wallets.
- **Send/fee-bump errors surface the real reason** (e.g. an amount below the dust limit) instead of a generic "transaction failed".
- **Lock indicators tell the truth** — an open, unlocked wallet no longer shows a locked padlock on the wallet page.

# Phoenix Wallet 2.3.2

A small patch on 2.3.1.

## Fixed

- **Tablet dashboard flicker.** On mid-sized screens (tablets in landscape, mid-width windows) the dashboard's Recent Transactions table could oscillate between layouts several times a second — the row count and the column widths were feeding back into each other. The table now uses fixed column sizing with tidy single-line rows (long addresses and transaction ids shorten with an ellipsis; the full values are one tap away). The same hardening is applied to the Transactions page.
