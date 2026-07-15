# Handbook screenshot to-do

Outstanding captures for the doc-sync pinned at `a77c853` (handbook v2.1.2).

**Workflow:** drop a capture into `handbook/images/raw/` using the *exact*
filename below. It gets crop-checked, copied to `images/processed/`, and the
`![caption](…){width=…}` tag is wired into the chapter. `images/raw/` is
gitignored — only `images/processed/` ships with the build. A referenced image
that is missing from `processed/` breaks the PDF build, so tags are only added
once the PNG exists.

## ✅ Done (copied + tag wired)

| File | Chapter |
|------|---------|
| `ch09-balance-details.png` | 9 |
| `ch09-cpfp.png` | 9 |

## 🔴 Must — new screens (this sync)

| File | Capture | Chapter | Notes |
|------|---------|---------|-------|
| `ch05-wallet-v30-badge.png` | Wallet selector row showing the upgrade affordance | 5 | **On hold** — wallet-selection screen is being redone; see note below |
| `ch05-upgrade-dialog.png` | Core-mode **"Upgrade this wallet"** dialog (phrase field + amber rescan note) | 5 | |
| `ch23-mobile-coins.png` | Mobile **Coins & Addresses** stacked-card layout | 23 | |
| `ch08-high-fee-warning.png` | Remote-mode send confirm with the red high-fee warning + acknowledge checkbox | 8 | Needs the dev-threshold tweak to reproduce (won't fire on a healthy server) |

## 🟡 Optional — small

| File | Capture | Chapter |
|------|---------|---------|
| `ch12-check-v30-funds.png` | Settings → the **Check for older (v30) funds** button | 12 |
| `ch23-upgrade-v31-menu.png` | Mobile row menu with **Upgrade to v31** | 23 |

## ⚫ Backlog — remote mode + Android (never captured since 2.1.0)

| File | Capture | Chapter |
|------|---------|---------|
| `ch04-wizard-remote.png` | Wizard **"Remote Node (Electrum)"** mode card | 4 |
| `ch12-settings-remote.png` | Settings → Node Configuration, the **Electrum server list** (remote mode) | 12 |
| `ch25b-electrum-status.png` | Toolbar **Electrum status** indicator | 25b |
| `ch23-wallet-setup.png` | Android **"Set up your wallet"** onboarding | 23 |
| `ch23-wallet-home.png` | Android wallet home with the **"Mine to this wallet"** card | 23 |
| `ch23-nav-drawer.png` | Android **navigation drawer** | 23 |
| `ch23-mobile-send.png` | Android **Send** screen | 23 |
| `ch23-mobile-receive.png` | Android **Receive** screen | 23 |
| `ch23-restore-report.png` | Android **restore branch report** / second-wallet offer | 23 |

## 🚫 Dropped — not retaking (UI change too minor)

`ch06-toolbar`, `ch07-receive`, `ch08-send`, `ch09-bump-fee`, `ch20-dashboard-full`

---

## Note — the v30 badge and `ch05-wallet-v30-badge.png`

There are **two** distinct v30/v31 affordances on the wallet-selector row, and
they don't appear in the same mode:

- **The amber "v30" text chip** (`isV30()` → `wallet_legacy_badge`) renders
  **only in remote / Electrum mode**, read from the BDK wallet registry
  (`policy.coinType === 0`). A Core (managed/external) wallet **never** shows
  it. It's hard to stage: Phoenix only ever creates v31 BDK wallets now, so a
  v30 BDK wallet exists only for users who had one before v31 shipped.
- **The upgrade button** (`system_update_alt` icon, tooltip *"To stay
  compatible with v31 wallets, this wallet needs to upgrade."*) shows in **Core
  mode** via `needsV31Upgrade()` whenever the wallet has an active
  `wpkh(84'/0')` / `tr(86'/0')` descriptor.

A throwaway mainnet Core wallet **"Alice"** was created via `bitcoin-cli`
(`createwallet`, with private keys) to stage the **Core-mode upgrade button** —
its auto-generated coin-0' descriptors trigger `needsV31Upgrade`. Delete it
after the shot (`unloadwallet` + remove the wallet dir) if it's no longer
needed.

**The wallet-selection screen is being redone first**, so both this screenshot
and the surrounding ch05 wording are on hold until that redesign lands — the
badge/button layout and copy may change.
