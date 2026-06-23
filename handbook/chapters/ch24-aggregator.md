# Orchestrating Multiple Machines with the Aggregator

Once a mining operation grows past a single machine, you face a coordination problem: each machine has plots and a miner, but the *solution* each one finds has to reach a wallet that can sign the block (Chapter 13). Running a full node and wallet on every machine is one answer; the **aggregator** is the better one. It lets a single Phoenix instance act as the hub of a farm — collecting submissions from any number of remote miners and forwarding the best of them upstream.

This chapter covers what the aggregator does, when to use it, how to turn it on, how to point your other machines at it, and how to read its dashboard.

## What the aggregator is

The aggregator is a built-in server inside Phoenix. When you enable it, that Phoenix instance starts **listening** for mining submissions from other machines on your network. Remote miners send it the deadlines they find; the aggregator collects them, picks the best, and forwards that upstream — either to its own local node and wallet, or onward to a pool.

The result is a clean division of labour across a farm:

- **Remote machines** do the heavy, parallel work: holding plots and scanning them. They need no wallet, no node, and no keys — only a miner and a network path to the aggregator.
- **The aggregator machine** does the coordination: it holds the wallet (or the pool relationship), receives everyone's submissions, and handles the upstream connection.

This is the multi-machine expression of the three-pieces architecture from Chapter 13: plots and miners spread across many machines, one signing wallet (or one pool relationship) at the hub.

## When to use it

The aggregator earns its place as soon as you have **more than one mining machine** and want them to act as a single farm. Concretely:

- You have outgrown what one host's drive slots and I/O can serve (Chapter 14) and are adding machines.
- You want to fold an Android device (Chapter 23), a second desktop, or a disk shelf on another box into one coordinated operation.
- You want the signing keys to live on exactly *one* machine — the aggregator — rather than being copied onto every mining box.

If you run a single machine, you do not need the aggregator; the local miner and wallet already talk to each other in-process.

## Turning the aggregator on

The aggregator is configured in the setup wizard's chain modal (the **Aggregator** toggle on a solo chain, Chapter 15) and managed from its own dashboard. Its settings are:

| Setting               | What it is                                                                                  |
|-----------------------|---------------------------------------------------------------------------------------------|
| **Listen address**    | The address and port the aggregator accepts submissions on. Defaults to `0.0.0.0:8080` — `0.0.0.0` means "all network interfaces," so remote machines on your LAN can reach it. |
| **Upstream mode**     | *Wallet* or *Pool* — what the aggregator does with the submissions it collects. See below.  |
| **Upstream RPC**      | The host and port of the upstream the aggregator forwards to (its own node in wallet mode, or the pool's endpoint in pool mode). |

Once enabled and started, the aggregator's dashboard appears in the sidebar's *Mining* group (it is hidden until you enable it), and its status shows *Listening on {address}*.

![The aggregator dashboard: status, network info, machines, accounts, and activity.](images/processed/ch24-aggregator-running.png){width=98%}

## Wallet mode vs. pool mode

The upstream mode is the most important aggregator setting, because it changes *what* the aggregator forwards — and the difference is not cosmetic.

### Wallet mode (solo farm)

In **wallet** mode, the aggregator forwards only the **single global best** solution per block — the best deadline out of *everything* every machine submitted, regardless of which account or address produced it. It then hands that one solution to its local node and wallet to sign and forge.

This is correct for a **solo** farm because solo mining only needs *one* winning solution per block. Whoever among your machines found the best deadline is the one that forges; the rest do not matter for that block. Forwarding just the global best keeps traffic minimal.

In this mode, the aggregator's wallet must be able to sign for the plots reporting in — either it holds their plotting addresses' keys, or those addresses have forging assignments to an address it controls (Chapter 19).

### Pool mode

In **pool** mode, the aggregator forwards the **best deadline for *each account*** — one best per address, not one best overall. This is more traffic, and it is necessary: a pool has to see each participating address's best deadline in order to measure and credit each participant's capacity. Reward attribution depends on the pool knowing what every address contributed, so the aggregator cannot collapse everything down to a single global best the way solo can.

Use pool mode when your farm's machines mine into a pool through the aggregator as a shared collection point — the aggregator gathers per-account submissions locally and relays them upstream to the pool in one connection.

> **Note** — The distinction in one line: **wallet mode forwards the global best (one solution per block); pool mode forwards the best per account (one per address per block).** Solo needs only the single winner; a pool needs to see everyone's contribution to pay everyone fairly.

## Pointing remote miners at the aggregator

A remote mining machine reaches the aggregator by treating it as a **chain** to submit to. On the remote machine:

1. Open the mining setup wizard (Chapter 15) and add a chain.
2. Choose **Custom** mode.
3. Enter the aggregator's address as the chain URL — the aggregator machine's IP and listen port, for example `http://192.168.1.10:8080`.
4. Set any block time / authentication the modal asks for, save, and start mining.

From then on, that machine scans its plots and submits its deadlines to the aggregator instead of to a node or pool directly.

The remote miner can be either:

- **Another Phoenix instance** — a second desktop, a laptop, an Android device (Chapter 23) — configured with the custom chain above. It needs its plots and the aggregator's address; it does not need a node or a wallet.
- **The standalone command-line miner** from the PoCX framework — a lightweight, headless miner for machines where you do not want a full Phoenix install. It points at the same aggregator address.

Either way, the aggregator does not care what software submitted a solution — only that it arrived. A mixed farm of Phoenix desktops, the CLI miner on a server, and a phone all reporting into one aggregator is entirely normal.

> **Tip** — Use the aggregator machine's **LAN IP address**, not `localhost`, in the remote miners' chain URL. `localhost` on a remote machine points at *itself*, not at the aggregator. Find the aggregator host's LAN address in your OS network settings (often a `192.168.x.x` or `10.x.x.x` address).

## Reading the aggregator dashboard

The aggregator dashboard is your window onto the whole farm. Its panels:

**Status.** Whether the aggregator is *Offline*, *Starting*, *Running*, or *Stopping*, with a **Start** / **Stop** control. *Stopping* is the brief state after you click Stop, while the listener winds down before it reports *Offline*; the Start control returns once it has fully stopped. While offline, it shows *"Press Start to begin accepting submissions."*

**Summary stats.** Headline figures for the farm: how many **machines** and **accounts** are reporting, the current **block height**, total **capacity** across all contributors, the **network capacity** for comparison, and uptime.

**Machines.** One row per connected machine, showing its machine ID, how many accounts it hosts, its total capacity in TiB, its 24-hour submission count and percentage share, when it was last seen, and whether it is currently active. This is where you confirm every machine you expect is actually contributing — a machine that has dropped off shows as inactive or disappears.

**Accounts.** One row per address reporting in, with the same capacity and submission breakdown per account. Useful in pool mode, where per-account contribution is what gets rewarded.

**Recent activity.** A live log of submissions received, accepted, forwarded, and any rejections — the play-by-play of the farm's work.

![The machines table: per-machine capacity and 24-hour submission share.](images/processed/ch24-aggregator-machines.png){width=80%}

> **Note** — The aggregator's accumulated statistics (machines, accounts, submission history) are runtime state, not something backed up by your recovery phrase (Chapter 11). If you reconfigure or move the aggregator, expect the stats to start fresh — they are an operational view, not a permanent ledger.

## Network and operational notes

A few practical points for running an aggregator reliably.

- **Firewall.** The aggregator listens on a port (default `8080`); remote machines must be able to reach it. Allow the port through the aggregator host's firewall for your LAN. Do **not** expose it to the public internet unless you specifically intend to and understand the implications — it is designed for a trusted local network.
- **Static or reserved IP.** Because remote miners point at the aggregator by address, give the aggregator host a stable LAN address (a static IP, or a DHCP reservation). If its address changes, every remote miner's chain URL breaks until updated.
- **Restart order after updates.** Updating the node or Phoenix on the aggregator host stops the aggregator and miner; the settings screen reminds you to restart them afterwards (Chapter 12). Remote miners will reconnect once the aggregator is listening again.
- **Keep the aggregator host up.** The whole farm depends on it. If the aggregator is down, remote miners have nowhere to submit and their work for that period is lost. Treat the aggregator host as the one machine in the farm that should stay running.

## What's next

The aggregator coordinates many machines around one hub. The remaining special topic is the other end of the node question: **Chapter 25 — Running Your Own Node (External Mode)** covers connecting Phoenix to a Bitcoin-PoCX Core instance you run and manage yourself, rather than the managed node Phoenix installs by default.
