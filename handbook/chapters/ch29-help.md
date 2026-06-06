# Where to Get Help

This handbook covers Phoenix PoCX as it works today, but software and networks evolve, and some questions are best answered by the community and the project's live resources. This chapter points you to them.

## Official resources

These are the canonical, project-run sources. Bookmark the website — it is the hub that links to everything else, and returning to it directly protects you from imitation sites.

| Resource           | Where                                                          | What it is                                                       |
|--------------------|---------------------------------------------------------------|------------------------------------------------------------------|
| **Website**        | <https://bitcoin-pocx.org>                                    | The project hub, with download links and links to everything below. |
| **Documentation**  | <https://poc-consortium.github.io/bitcoin-pocx-docs/>         | Technical documentation for Bitcoin-PoCX itself.                |
| **Whitepaper**     | <https://bitcoin-pocx.org/btcx_whitepaper_eng.pdf>            | The design document behind proof-of-capacity and Bitcoin-PoCX. |
| **Block explorer** | <https://explorer.bitcoin-pocx.org/>                          | Look up transactions, addresses, and blocks on the live chain. |

> **Tip** — The **block explorer** is the single most useful diagnostic tool outside Phoenix. When a payment seems missing or a transaction is stuck (Chapter 26), looking up the transaction ID on the explorer tells you immediately whether the network has seen it and how many confirmations it has.

## Community channels

The community is the fastest route to help with day-to-day questions — other miners and users have usually hit the same issue before.

| Channel        | Where                                  |
|----------------|----------------------------------------|
| **Discord**    | <https://discord.gg/enQ57bgJdq>        |
| **Telegram**   | <https://t.me/+aqavnqlq2vg0Mzhk>       |
| **Reddit**     | <https://reddit.com/r/bitcoin_pocx>    |
| **X (Twitter)**| <https://x.com/PoC_Consortium>         |

Discord and Telegram are best for real-time troubleshooting; Reddit is better for longer write-ups and searchable history; X is where project announcements appear.

## Source code and issues

Phoenix PoCX and Bitcoin-PoCX are open source. If you have found a bug, want to request a feature, or simply want to read the code, these are the repositories:

| Repository            | Where                                                  | What it is                                          |
|-----------------------|--------------------------------------------------------|-----------------------------------------------------|
| **Organisation**      | <https://github.com/PoC-Consortium>                    | The umbrella for all project repositories.          |
| **Phoenix Wallet**    | <https://github.com/PoC-Consortium/phoenix-pocx>       | This wallet — issues and source.                    |
| **Bitcoin Core PoCX** | <https://github.com/PoC-Consortium/bitcoin>            | The node software Phoenix manages.                  |
| **PoCX Framework**    | <https://github.com/PoC-Consortium/pocx>               | The underlying mining/plotting libraries, including the command-line plotter and miner. |

Bug reports and feature requests go in the **Issues** tab of the relevant repository — the Phoenix Wallet repo for wallet and mining-UI problems, the Bitcoin Core PoCX repo for node-level or consensus issues.

## How to ask a good question

Whether on a community channel or in a GitHub issue, you will get help faster if you provide the right detail up front. A good report includes:

1. **What you were trying to do** — "I was starting the miner," not just "it's broken."
2. **What you expected to happen.**
3. **What actually happened** — the exact error message, if any.
4. **Your platform** — Windows / macOS / Linux / Android, and the Phoenix version (shown in the sidebar).
5. **A recent log slice** — the last few hundred lines of the relevant log (Chapter 26 explains where to find them via **Settings → Debug & Logs**). The *Copy all* button on the Debug Logs tab gathers your version and platform for you.

> **Warning** — When sharing logs or screenshots for support, **never include your recovery phrase, and review for anything sensitive.** Logs can contain your addresses (public, but linkable to you); your 24-word phrase must *never* appear anywhere you share. No legitimate helper will ever ask for it, and anyone who does is trying to steal from you (Chapters 1 and 11).

## Checking the network's status

Questions about whether the network is live, what BTCX is worth, or what the current mining difficulty is are best answered by live sources rather than this handbook, because they change over time:

- The **website** and **announcement channels** (X, Discord, Telegram) carry official status news.
- The **block explorer** shows the live chain — recent blocks, current height, and network activity — which is the most direct confirmation that the network is producing blocks.

## A final word

Phoenix PoCX puts a full wallet, node, plotter, miner, and farm coordinator into a single application, and proof-of-capacity makes mining accessible on hardware most people already own — or that others are throwing away. The learning curve is real, but it is front-loaded: once your wallet is backed up, your drives are plotted, and your miner is running cleanly, the day-to-day is quiet.

The two things worth repeating one last time, because they are the ones that matter most:

- **Your recovery phrase is everything.** Write it down, store it offline, test a restore, and never share it. Everything else can be rebuilt; the phrase cannot.
- **Mine the hardware you have.** You do not need new drives, a powerful GPU for mining, or any coins to stake. A clean clock, some honest disk space, and a little patience are enough to participate.

Welcome to Bitcoin-PoCX.
