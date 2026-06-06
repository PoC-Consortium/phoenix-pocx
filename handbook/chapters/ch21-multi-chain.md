# Multi-Chain Mining

Phoenix's mining configuration is built around a *list* of chains rather than a single fixed one, and the miner can in principle scan your plots for several chains at once. Today, in practice, there is **one** Bitcoin-PoCX chain to mine, so this chapter is mostly forward-looking: it explains what the multi-chain machinery is for, the one advanced situation where it is useful right now, and the constraint that will govern it when more chains exist.

If you are an ordinary miner on the live network, you can treat this as background reading. You will configure exactly one chain (Chapter 15) and never think about this again.

## What a "chain" is here

In Phoenix, a *chain* is a distinct blockchain the miner submits solutions to. It is **not** the same thing as the *mode* you mine in:

- **Solo versus pool** is a choice about *how* you participate in a chain — directly via your own node, or through a pool that forges on your behalf (Chapters 15 and 19). Both are still the *same* chain.
- **A separate chain** is a genuinely different network with its own blocks, its own difficulty, and its own block height.

This distinction is why the chain list exists: it is designed to hold more than one *network*, not more than one *way of mining a single network*.

## The state of play today

At the time of writing, Bitcoin-PoCX is a single live network. That means:

- A normal miner configures **one chain** — the Bitcoin-PoCX chain — in either solo or pool mode, and that is the whole story.
- The multi-chain capability (the priority list, the per-chain configuration, the scan queue) is present and working, but there is not yet a *second* production chain to point it at.

So multi-chain mining is, for now, a capability waiting for a use rather than a daily-driver feature. There are two situations where it is relevant.

### Future: additional proof-of-capacity chains

If further Bitcoin-PoCX-style chains are launched, the same plots could be offered to more than one of them at once. Because plot files are tied to an address and a format rather than to a specific network, one set of plots can in principle compete on several compatible chains simultaneously — committing the storage once and earning on each chain it is eligible for. When that becomes a reality, this chapter's *priority* and *scan-contention* sections (below) are how it will behave.

### Advanced/developer: mainnet and testnet together

The one place multi-chain is usable today is **development and testing** — running the miner against **mainnet and testnet at the same time**. This is squarely advanced/developer territory: it is useful for someone testing software against the network, not for earning. An ordinary miner has no reason to do it, and testnet coins have no value.

## How priority will work

When more than one chain is configured, the **priority list** (the draggable order in the setup wizard, Chapter 15) decides what the miner does when **two or more chains each have a new block to scan at the same moment**.

The miner cannot scan everything at once — a scan reads across your plots and takes real time. So when several chains present new work together, the miner scans them **in priority order**: the chain at the top of the list first, then the next. A scan queue tracks what is waiting, and the dashboard's miner status shows which chain is being scanned and what is queued behind it.

Crucially, priority is **preemptive**, not just a waiting order. If the miner is part-way through scanning a lower-priority chain when a new block arrives on a higher-priority one, it does not wait for the current scan to finish — it **pauses** the secondary scan, scans the higher-priority block immediately, and then **resumes** the paused scan from where it left off. The higher-priority chain therefore never waits behind a lower one; the lower chain absorbs the interruption. (This is why the miner reports scan states like *scanning*, *paused*, and *resumed* — a paused scan is one that yielded to a higher-priority block.)

Priority is therefore a *ranking of importance*, not a timetable. It only matters in the moments when blocks on different chains coincide; the rest of the time each chain's block is scanned as it arrives, with no contention. When they do coincide, the top chain is served first and at once, even mid-scan of another.

## The constraint that will govern it: scanning takes time

The reason priority exists at all — and the reason there is a natural ceiling on how many chains are worthwhile — is that **a scan is not instant**. When a block arrives, the miner reads the relevant slice across *all* of your plots to find its best deadline; on a large farm that takes a meaningful fraction of the block interval (Chapter 14).

Each chain that presents a new block needs its own scan. If several chains produce blocks close together, their scans queue, and a scan that waits too long may not finish before its block interval closes — that chain then gets no competitive deadline from you that round. Beyond the point where your plots can be scanned for every chain within their intervals, adding chains stops helping.

This same property is a security feature of proof-of-capacity: because every fork costs a real scan and I/O bandwidth is finite, an attacker cannot cheaply mine many competing forks at once. The whitepaper discusses this as the reason proof-of-capacity avoids the "nothing-at-stake" problem. Time Bending (Chapter 13) makes block intervals more regular but does not remove the underlying limit — your I/O is shared across every chain you scan for.

## What to do today

For mining on the live network right now: **configure one chain** (Chapter 15), solo or pool, and ignore the rest of this chapter. The multi-chain machinery is there for the future and for development; it is not something a normal miner needs to engage with while a single production chain is the whole network.

## What's next

The next chapter — **Benchmarking & Performance Tuning** — returns to firmly practical ground: measuring your rig with the device benchmark, understanding what the numbers mean, and using them to get the most plotting speed and effective capacity out of your hardware.
