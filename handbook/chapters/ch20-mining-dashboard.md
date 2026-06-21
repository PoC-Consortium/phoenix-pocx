# Running the Miner & the Mining Dashboard

Plotting builds the capacity; the miner puts it to work. This chapter covers the day-to-day of mining: starting and stopping the miner, reading every panel on the Mining Dashboard, and — most importantly — recognising at a glance whether everything is actually working.

By now you have a configured setup (Chapter 15), plotted drives (Chapter 16), and, if you are pooling, an active forging assignment (Chapter 19). The dashboard is where all of that comes together.

## The dashboard at a glance

Open **Mining Dashboard** from the sidebar. The screen is organised into a row of summary cards across the top, then a detail area below with chains and deadline history on the left and your drives on the right.

![The Mining Dashboard: summary cards, chains, deadline history, and drives.](images/processed/ch20-dashboard-full.png){width=98%}

| Panel                   | What it tells you                                                                             |
|-------------------------|-----------------------------------------------------------------------------------------------|
| **Mining Status**       | Whether the miner is running, what it is doing right now, and the start/stop control.         |
| **Best Deadline**       | The best deadline found for the current block, and the accounts that produced this round's deadlines. |
| **Capacity**            | Your total plot capacity and its plotted/ready/to-plot breakdown, plus the plotter controls (Chapter 16). |
| **Effective Capacity**  | A rolling estimate of your usable capacity, derived from recent deadlines, drawn as a sparkline. |
| **Active Chains**       | One row per chain: height, difficulty, PoW scaling level, and status.                         |
| **Best Deadline History** | A scrollable log of your best deadline per block, filterable by chain and exportable to CSV. |
| **Drives**              | The drives participating in mining and their state.                                           |

## Starting and stopping the miner

The **Mining Status** card carries the control.

- A coloured **status dot** and a text label show the current state.
- A **Start** / **Stop** button toggles the miner.
- An **Auto-start** checkbox makes the miner start automatically whenever Phoenix launches (after the node is ready).

To begin mining, click **Start**. The miner connects to your configured chains, loads your plot capacity, and begins responding to new blocks. To stop, click **Stop** — mining halts immediately; there is no batch to finish as there is with the plotter.

> **Tip** — **Auto-start** is what you want for an unattended rig: after a reboot, power restoration, or a Phoenix update, the miner comes back by itself once Bitcoin-PoCX Core is ready. Leave it on for any machine whose job is to mine. The one thing auto-start *cannot* do is unlock an encrypted wallet — see the clock and wallet section below.

### Mining status states

The status text and dot reflect what the miner is doing:

| State        | Meaning                                                                                         |
|--------------|-------------------------------------------------------------------------------------------------|
| *Stopped*    | The miner is not running.                                                                       |
| *Starting*   | The miner is connecting to chains and loading capacity.                                         |
| *Scanning*   | A new block arrived; the miner is reading its plots to find a deadline. A progress bar shows how far through the scan it is. |
| *Idle*       | The miner is running and has finished scanning the current block; it is waiting for the next one. |
| *Error*      | Something is wrong — the message names the problem.                                              |

Most of a healthy miner's life is spent flipping between *Scanning* (briefly, when a block arrives) and *Idle* (waiting for the next block). On Bitcoin-PoCX's ~120-second block interval, you will see a short scan every couple of minutes.

## Best Deadline card

This card shows the best **deadline** your miner found for the *current* block, plus the per-account deadlines that made up this round.

Recall from Chapter 13: a deadline is the number of seconds your plots would have to wait before being eligible to forge, and **smaller is better**. The card shows your best value for the live block, and below it a short list of the accounts (addresses) that produced deadlines this round — useful when you mine with more than one plotting address, or when a forging assignment means several plot owners report through you.

If you see *"No deadlines this round"* it usually just means the scan has not finished yet, or this particular block's scoop did not turn up a competitive number for you — which is entirely normal (see *Reading whether it is working* below).

## Capacity card

The **Capacity** card serves double duty: it summarises your storage and it hosts the plotter controls covered in Chapter 16.

The upper section shows your **total plot size** and, while plotting is ongoing, the breakdown into *ready* (mining now), *plotted* (complete), and *to plot* (allocated but not yet generated). Once everything is plotted, it simply reports that the capacity is ready for mining.

The lower section is the plotter's Start/Stop control and progress display — the same controls described in Chapter 16. Mining and plotting share this card because, in practice, you watch both from the same place.

## Effective Capacity card

**Effective capacity** is Phoenix's estimate of how much usable plot space your miner *appears* to have, computed from your recent deadlines rather than from the raw terabytes on your drives. The card shows the current figure and a **sparkline** of how it has trended over recent history.

- With **enough deadline data**, the sparkline plots effective capacity over time.
- With **only one data point**, it shows the single value and a *"collecting data"* note.
- With **no deadline data yet**, it shows *"no deadline data."*

Effective capacity will not exactly equal your physical plot size — it is a statistical estimate that converges over time. Watching it is the best way to confirm your *whole* farm is participating: if effective capacity sits well below your physical capacity over a long period, something is keeping part of your plots out of the game (an I/O bottleneck, a scaling-level mismatch halving older plots, or drives that are not being read in time — see *Reading whether it is working*).

> **Note** — Recall the cross-generation compatibility cost from Chapter 15: plots one PoW scaling level behind the network contribute at *half* their size, two levels behind at a quarter, and so on. A persistent gap between physical and effective capacity, right after a network scaling step, often means your plots need upgrading (re-plotting at the new level).

## Active Chains table

One row per enabled chain, showing the live state of each:

| Column         | What it shows                                                                                |
|----------------|----------------------------------------------------------------------------------------------|
| **Chain**      | The chain name. Hovering shows more detail in a tooltip.                                     |
| **Height**     | The current block height the chain is at.                                                   |
| **Difficulty** | The chain's current mining difficulty.                                                      |
| **PoW scale**  | The scaling level (Xn) currently in force on the chain — the minimum level your plots should meet. |
| **Status**     | A coloured dot plus label showing whether the chain is healthy, scanning, or has a problem.  |

This table is the first place to look when mining seems stalled: a chain stuck at an old height, or showing an error status, points straight at a connectivity or configuration problem with that specific chain.

> **Tip** — Watch the **PoW scale** column after the network advances a scaling level. If it shows a level higher than what your plots were generated at, your effective capacity is being penalised and it is time to upgrade plots (Chapter 18). The chains table is where you notice the network has moved before your earnings tell you.

## Best Deadline History

A scrollable log of your best deadline for each block over recent history. Each row shows the time, block height, chain, account, and the deadline value.

- A **chain filter** dropdown narrows the log to a single chain or shows *all chains*.
- An **Export CSV** button saves the history to a file — useful for tracking performance over time, comparing rigs, or feeding a spreadsheet.

This is your performance record. A healthy miner produces a steady stream of best-deadline entries, one per block it scanned. Gaps in the history mean the miner was not running, not connected, or not reading its plots during those blocks.

## Drives panel

The right side of the detail area lists the drives currently participating in mining, mirroring the drive information from the setup wizard (Chapter 15) but in a read-only, at-a-glance form. Use it to confirm that the drives you expect to be mining actually are — a drive that has gone unavailable (an unplugged USB enclosure, a failed disk) shows here, and its missing capacity explains a drop in effective capacity.

## Reading whether it is working

The dashboard packs a lot of numbers; here is how to read them as a single answer to *"is my miner healthy?"*

**A healthy miner looks like this:**

- Mining Status flips between *Scanning* (briefly) and *Idle* every couple of minutes.
- The Active Chains table shows each chain's height **advancing** over time, with a healthy status dot.
- Best Deadline History gains a new row roughly every block.
- Effective Capacity tracks somewhere near your physical capacity and holds steady.

**Bursty results are normal, not a fault.** A small solo miner can go a long time without forging a block — that is the nature of single-resource mining (Chapter 13). "No deadlines this round" on any individual block, or no *forged blocks* for an extended stretch, does not mean something is broken. The signals above (scanning, advancing heights, deadline history filling) are what tell you the miner is working; *forging a block* is the lottery win that those signals make you eligible for.

**The things that genuinely indicate a problem:**

| Symptom                                          | Likely cause                                                                                 |
|--------------------------------------------------|----------------------------------------------------------------------------------------------|
| Chain height not advancing                       | Node not synced or chain disconnected. Check node status (Chapter 6) and the chain's row.    |
| Effective capacity far below physical, persistently | I/O bottleneck (Chapter 14), or plots a scaling level behind (upgrade, Chapter 18).       |
| Effective capacity dropped suddenly              | A drive went unavailable (check the drives panel), or the network stepped up a scaling level. |
| Miner shows *Error*                              | Read the message; common causes are connectivity, a locked wallet, or a chain misconfiguration. |
| Deadline history stopped filling                 | Miner stopped, lost connection, or — after a restart — the signing wallet is locked.         |

### Clock health

Because Bitcoin-PoCX enforces a **15-second** timestamp tolerance (Chapters 3 and 14), a drifting system clock is one of the most insidious mining problems: the miner appears to run normally, scans complete, deadlines are found — but blocks you forge are rejected by peers as "too far in the future" or "too far in the past," and you quietly earn nothing.

If your miner seems healthy on the dashboard but never successfully forges over a long period, **suspect the clock**. Confirm your operating system's network time synchronisation (NTP) is enabled and that a power-saving profile is not suspending it. A correctly synchronised clock is a prerequisite for mining, not an optional nicety.

### The locked-wallet-after-restart trap

If you use an **encrypted** wallet for signing and the rig restarts (a reboot, a power blip, a Phoenix update), the wallet comes back **locked** — and a locked wallet cannot sign blocks. Auto-start will bring the *miner* back, but mining silently stalls because there is no key available to sign with. The dashboard symptom is a miner that looks like it is running and scanning, but whose deadline history stops producing forged blocks after the restart.

The fix is the one described in Chapters 5, 11, and 19: either do not encrypt the mining wallet, or — better — use the **cold/hot key split** via a forging assignment, so the rig's signing wallet is an unencrypted forging-only wallet that needs no manual unlock. If you must run an encrypted signing wallet, you have to unlock it manually after every restart for mining to resume.

## What's next

You can now run the miner and read its health. The next chapter — **Multi-Chain Mining** — covers running against more than one chain at once: adding chains, setting their priority, and what changes when your miner is reporting into several targets simultaneously.
