# Phoenix Wallet 2.3.0

One app, every device. 2.3.0 unifies the desktop and mobile experience into a single set of responsive pages, brings full transaction details and dramatically faster history to Electrum mode, and integrates mining into the wallet on hybrid builds.

## One experience across desktop and mobile

Every main page — dashboard, transactions, send, receive, coins, contacts, forging assignment, and the transaction builder — is now a single component that adapts to your screen, instead of separate desktop and mobile versions. What you learn on one device applies on the other, and improvements land everywhere at once:

- Consistent page headers, titles, and spacing at every window size.
- Transaction lists page to fit your screen automatically — no more items-per-page pickers.
- On phones, the transactions page tucks its search and filters behind a funnel button, so the header never crowds.
- The receive page puts address selection first, with older (v30) addresses labeled.

## Electrum mode: full transaction details, much faster

- **Tap any transaction** to see everything — inputs and outputs with amounts, size and fee, block info, raw hex, and forging-assignment details — served instantly from the local wallet, with zero extra server traffic.
- **Transaction history loads in a blink.** Large wallets (1000+ transactions) used to take many seconds to list; the same list now appears near-instantly, and background refreshes skip entirely when nothing changed.

## Mining, integrated (hybrid builds)

- The **mining dashboard and setup wizard live inside the wallet** now — same menu, same toolbar, no jarring switch into a separate mining screen.
- A **miner status icon** in the toolbar shows at a glance whether you're mining — on desktop and mobile.
- **Calmer notifications**: instead of a ping for every deadline found, the mining notification updates once per round with the round's best deadline.
- **Direct I/O is now enabled by default on Android**, matching desktop for better plotting and scanning performance.

## More control over notifications

Mobile settings gained a **Notifications** card: switch payment and connection notifications on or off. (Mining status notifications stay on — Android requires them while mining in the background.)

## Also improved

- Android app flavors now install under their proper names: **Phoenix Suite** (hybrid), **Phoenix Wallet** (wallet-only), **Phoenix Miner** (mining-only).
- Wallet and pocket selectors collapse to compact icons on narrow screens; balances shrink to fit instead of wrapping.
- The time-sync indicator only appears when running with a local node, where it matters.
- Restore flow: paste your entire recovery phrase into any word box to fill the whole grid.
- Fully translated across all 25 supported languages.
