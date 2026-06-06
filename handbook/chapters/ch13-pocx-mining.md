# Understanding Proof-of-Capacity Mining

This is the first chapter of Part III. Everything from here on is mining-specific. If you have skipped ahead and are not interested in mining, you can safely stop after Chapter 12 — the wallet half of Phoenix is fully covered by now.

Chapter 2 introduced the broad shape of proof-of-capacity: plot files store precomputed answers, forging consists of reading the right answer when the network asks for it, and the miner with the smallest *deadline* wins each block. That sketch is enough to explain what you are about to do; it is *not* enough to explain why your miner does the specific things it does, or why the dashboard shows the numbers it shows. This chapter extends the primer just far enough to make the rest of Part III legible.

You do not need to memorise the technical terms. They appear once here for orientation; later chapters reference them when they actually matter for configuration. The mental model is what counts.

## From plot files to blocks

When you plot a drive, the plotter fills it with **plot files** (extension `.pocx`). Each plot file is internally organised into a few standard units worth knowing the names of, because Phoenix's mining UI uses them:

- **Nonce.** The smallest meaningful unit of plot data: a 256 KiB structure derived from your plotting address, a per-plot seed, and a 64-bit nonce index. A typical plot contains millions of nonces.
- **Scoop.** A 64-byte slice inside a nonce. Each nonce has exactly 4096 scoops, numbered 0 to 4095.
- **Warp.** A storage-level container of 4096 nonces (1 GiB). Plot files are arranged as a sequence of warps. Most progress and capacity figures in Phoenix's UI are quoted in warps.

When a new block arrives on the network, the miner does one job: it reads a *small slice* of every plot it owns, evaluates the result for each nonce, and submits its best answer. The slice it has to read depends on the new block.

### Scoop selection: which slice to read

The previous block carries a number called the **generation signature** — 256 bits of entropy that depends on the previous block's signer. From this, the miner computes a **scoop index** between 0 and 4095. Every plot file's contribution to this block is the data at that one scoop index, across every nonce.

This is what makes mining cheap: although each plot file may be terabytes in total, only roughly *one four-thousandth* of it has to be read for any given block. A 10 TB plot drive reads about 2.5 GB per block — done in seconds on a healthy HDD.

The scoop index cannot be predicted in advance, because the generation signature depends on whoever signed the previous block. This is what stops miners from precomputing answers before the block is announced.

### Quality: turning a slice into a number

For each nonce, the miner takes the slice at the selected scoop, hashes it with the current generation signature, and produces a 64-bit **quality** value. Lower quality is better. The miner keeps track of the lowest quality it has seen across all of its nonces.

### Deadline: turning a quality into a wait

The miner converts its best quality into a **deadline** — a number of seconds it would need to wait before being eligible to forge this block. The conversion uses the network's current **base target** (an inverse difficulty number that the network adjusts every block to keep the average block interval close to 120 seconds). The basic relationship is intuitive:

- Smaller quality → smaller deadline → better chance of winning.
- Higher base target (lower difficulty) → smaller deadlines all round.
- Larger plots produce smaller average deadlines, because more nonces give more chances to land on a low number.

The miner with the *shortest* deadline forges the block once that deadline has elapsed since the previous block.

### Time Bending: smoothing out the wait

Left alone, deadlines follow an exponential distribution: most are short, but a long tail of very large deadlines occasionally produces noticeably late blocks. Bitcoin-PoCX applies a mathematical transformation called **Time Bending** that reshapes the distribution into something tighter without changing the average block interval. The practical consequence is that blocks arrive more reliably around the 120-second target, with fewer outliers in either direction.

You do not have to do anything about Time Bending. It happens inside the protocol; the miner's dashboard reports the *bended* deadlines.

## Network capacity, your share, and effective capacity

Two capacity figures appear throughout Phoenix's mining UI; understanding what each is helps the rest of Part III make sense.

- **Network capacity.** A rolling estimate, derived from recent base targets and the block interval, of how much plot space exists across the entire Bitcoin-PoCX network. Typically reported in TiB or PiB.
- **Effective capacity.** A rolling estimate, computed from *your* recent deadlines, of how much usable plot space *your miner appears to have*. It will not match the literal terabytes of `.pocx` files on your drives exactly — the calculation samples your luck, not your inventory — but over time it tracks your true capacity.

The long-run relationship is simple: your share of forged blocks is roughly your effective capacity divided by network capacity. A miner with 1% of network capacity forges roughly 1% of blocks over a long enough horizon.

> **Note** — *"Long enough"* matters. Small miners in particular see bursty results: weeks of nothing followed by a sudden block, with the long-run average emerging only over months. This is intrinsic to all single-resource mining (proof-of-work or proof-of-capacity) — it is not a bug in your setup. Pool mining (described below) trades the bursty highs for a steady stream of small payouts.

## The three pieces of every mining setup

A working mining setup always has three pieces working together:

1. **Plot files** on disk. Generated once; each file embeds the *plotting address* that identifies who owns the plot.
2. **A miner** that reads the plot files when a new block arrives, computes the best deadline, and produces a *solution*.
3. **A wallet that holds the corresponding signing key.** Every block needs a signature from the key controlling the *effective forging address* — which is the plot's embedded address by default, or a delegated forging address if a forging assignment is active (Chapter 19).

The miner's solution has to *get from the plots to the signing wallet* before it can be turned into a valid block. The way you arrange this is what distinguishes a solo single-machine setup from a multi-machine farm from a pool participant. Three patterns cover almost every real case.

### Pattern 1 — Solo on a single machine

Plots, miner, and wallet all live on the same Phoenix instance. The solution stays in-process; the wallet signs the block locally; the block is broadcast to the network. Nothing extra to configure beyond the mining setup wizard (Chapter 15).

This is the natural starting point and what every later pattern builds on.

### Pattern 2 — Solo across multiple machines

When your storage exceeds what one machine can comfortably host, you start adding machines. Two arrangements work, and they look quite different operationally.

- **Same wallet on every machine.** Each mining machine runs its own Bitcoin-PoCX Core with the *same* wallet imported from the same recovery phrase. Each machine signs its own solutions locally. Simple per machine, but every machine now has the full signing power of the wallet — a compromise on one machine compromises every machine.
- **Aggregator-as-signer.** One Phoenix instance enables the **aggregator** (Chapter 24); the other mining machines forward their solutions to it as their upstream. The aggregator's local wallet does *all* the signing. The plot files on the remote machines never see the wallet keys — only the aggregator machine does. This is the right shape for a farm of any meaningful size.

Both arrangements still count as "solo" — you are competing with the full network on your own behalf, and you keep the full reward when you win.

### Pattern 3 — Pool mining

Instead of trying to win blocks on your own, you join a **pool**: a service that aggregates many miners' submissions, signs blocks with its own wallet, and distributes rewards back to participants according to their submitted shares.

Pool mining requires you to publish a **forging assignment** (Chapter 19) from your plotting address to the pool's forging address. From then on, the pool's wallet — not yours — is the one that signs blocks for your plots. The rewards land at whichever address the pool's policy specifies; in practice this is typically the pool's wallet, which then pays you out from a separate accounting layer.

Wins arrive far more frequently than they would solo (the pool is much bigger than you, so it wins more often), at the cost of each share being correspondingly smaller and dependent on the pool's distribution policy. Chapter 20 covers pool configuration in the mining dashboard.

## A note on where rewards land

By convention, block rewards land at the *effective signer's* address — the plot owner in a solo setup, the delegated forger when an assignment is in place. That is what we usually want, and it is what every configuration option in Phoenix nudges you towards.

It is also worth knowing that "rewards go to the signer" is a *convention*, not a protocol rule. The coinbase output of a forged block can technically pay any address. Pools rely on this flexibility to credit themselves first and pay out their participants from a separate accounting layer; the protocol does not insist that the signer keep the coins. Most miners will never need to know this; it matters mostly for understanding why pool flows work the way they do.

## What's next

You now have the mental model. Chapter 14 — **Hardware Planning** — turns that model into concrete decisions about drives (CMR vs. SMR, where SSDs and NVMe genuinely help and where they do not), CPU and GPU choices, and what a realistic mining rig looks like. From there, Chapter 15 walks through the setup wizard, and the rest of Part III covers plot generation, mining operation, forging assignments, and the multi-machine and pool patterns described above.
