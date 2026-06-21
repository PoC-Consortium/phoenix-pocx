# Introducing Phoenix PoCX

This chapter introduces the wallet, the network it connects to, and the handful of ideas that explain how Bitcoin-PoCX actually works. If terms like *plotting*, *forging*, or *proof-of-capacity* are new to you, this is the right place to start — everything else in the handbook builds on what is covered here.

If you are already familiar with proof-of-capacity mining, feel free to skim this chapter and continue to Chapter 3 (*Installing Phoenix PoCX*).

## What Phoenix PoCX is

**Phoenix PoCX** is a desktop and mobile wallet for the Bitcoin-PoCX network. From a single application you can:

- Create a wallet, back it up, and restore it from a recovery phrase.
- Send and receive **BTCX**, the native currency unit of Bitcoin-PoCX.
- View your transaction history and address book.
- Run a Bitcoin-PoCX node on your own computer — the program that talks to the rest of the network on your behalf.
- Generate plot files and run a miner against them.
- Create and manage *forging assignments*, the mechanism Bitcoin-PoCX uses to delegate forging rights between addresses.
- Coordinate multiple mining machines from a single Phoenix instance using the built-in **aggregator**.

Phoenix PoCX combines features that traditionally come from several different programs — a wallet, a node, a plotter, and a miner — into a single window. Whether you want to use it only as a wallet, only for mining, or as both at the same time, the application adapts to what you need.

It runs on Windows, macOS, and Linux as a full-featured desktop application, and on Android as a **mining-only** client (no built-in node and no wallet creation; Android is covered separately in Chapter 24).

## What Bitcoin-PoCX is

**Bitcoin-PoCX** is a fork of Bitcoin. It shares Bitcoin's transaction model, address model, fee structure, and overall architecture, but replaces Bitcoin's *proof-of-work* consensus mechanism with *proof-of-capacity*.

In plain terms:

- A Bitcoin-PoCX wallet looks and behaves much like a Bitcoin wallet — addresses, balances, sending, receiving, fees.
- A Bitcoin-PoCX node uses the same protocol style as Bitcoin Core; the node binary that Phoenix manages is a feature-flagged fork of Bitcoin Core itself.
- The crucial difference is **how new blocks are produced**. In Bitcoin, miners race to solve a cryptographic puzzle by computing as many hashes per second as possible. In Bitcoin-PoCX, miners do most of that work *once, in advance*, save the result on disk, and then look up the answer whenever the network needs a new block.

The "PoCX" suffix stands for **Proof-of-Capacity, NeXt Generation** — a refinement of earlier proof-of-capacity designs, adapted to fit cleanly into the Bitcoin model.

Bitcoin-PoCX preserves Bitcoin's economic model: the maximum supply is approximately 21 million BTCX, with halvings spaced roughly four years apart. Block intervals target 120 seconds — five times faster than Bitcoin's 10 minutes — and the per-block reward (10 BTCX initially) is correspondingly smaller, keeping the long-term issuance rate aligned with Bitcoin's original schedule.

> **Note** — *Capacity* in this handbook always means storage capacity (disk space). It has nothing to do with network bandwidth.

## How proof-of-capacity works

Proof-of-capacity replaces *computation* with *storage* as the resource that secures the network. The intuition is straightforward: instead of doing work every time a new block needs to be produced, you do the work once, save the answers on disk, and then read the relevant answer when the network asks for it.

There are two activities a miner performs.

1. **Plotting** — a one-time process that fills empty disk space with precomputed values. A *plot file* is a large, structured binary file — typically hundreds of gigabytes in size — tied to a specific Bitcoin-PoCX address. Plotting can take anywhere from hours to several days, depending on your hardware and the amount of space involved, but you only do it once for each piece of disk space you commit. Plot files have the extension `.pocx`.

2. **Forging** — the ongoing process of using your plot files to produce blocks. Each time the network announces a new block, every miner reads a small, predictable slice of their plot files and computes the best candidate they can find. The miner with the best candidate for that block earns the right to forge it and receives the block's reward.

Because forging only *reads* small slices of disk — it does not compute, and it does not write — it uses very little electricity. A typical mining rig spends a brief moment reading the disk every two minutes (the target block interval) and then sits idle.

> **Tip** — A helpful mental picture: plotting is like solving a giant puzzle book in advance and storing the answers. Forging is the network occasionally calling out a question; the miner who can read out the matching answer fastest wins that round.

### Deadlines: who wins each block

When a new block arrives, your miner produces a *deadline* for it. The deadline is a number, measured in seconds, that represents how long your plot would have to wait before being entitled to forge. The **smaller the number, the better**.

- The miner with the *smallest* deadline wins the block.
- Larger plots produce smaller deadlines on average, because more disk space means more chances for any single block to land on a low value.
- A run of unlucky deadlines is normal — proof-of-capacity rewards are inherently bursty for small miners. Over time, however, your share of blocks tends towards your share of the network's total disk space.

You will see deadlines reported throughout Phoenix PoCX's mining dashboard, often alongside an *effective capacity* number — an estimate, derived from your recent deadlines, of how much usable plot space your miner appears to have.

### Solo and pool mining

You can earn block rewards in two ways.

- **Solo mining.** You forge against the network on your own. When *your* plot wins a block, you receive the *full* reward. With a small plot, you may go a long time between wins; but every win is large.
- **Pool mining.** Many miners contribute their plots to a shared pool. The pool earns rewards collectively and distributes them in proportion to each miner's contribution. Wins arrive far more frequently, and each individual share is correspondingly smaller.

Phoenix PoCX supports both. Part III explains when to prefer one over the other and how to configure each.

### Forging assignments: letting someone else forge for you

A *forging assignment* is a Bitcoin-PoCX-specific feature that separates *who owns a plot* from *who is allowed to forge with it*. Each plot file is tied to a **plot address** — the address embedded in the file when it was created. By default the same address forges with the plot. But the plot's owner can publish an on-chain *assignment* transaction that hands the **forging rights** for that address to a different **forging address**.

This is most commonly used to:

- Point your plots at a mining pool, so the pool can forge with them on your behalf without ever taking custody of the plot keys.
- Keep the *plot owner* key safely offline (cold) while a separate *forging* key on the mining machine (hot) signs blocks. If the hot key is ever compromised, only the forging right is at risk — the plots and their rewards remain anchored to the offline owner key, and the assignment can be revoked.
- Move forging between two of your own wallets without re-plotting.

Assignments are deliberately slow to change. A new assignment becomes active after about 30 blocks (roughly one hour), giving the network time to confirm it. A *revocation* takes longer to complete — about 720 blocks, or roughly one day — so that pools and shared infrastructure cannot be destabilised by sudden re-assignment.

Chapter 19 covers assignments in depth, including how to create, check, and revoke them from inside Phoenix.

## The pieces of the system

When you run Phoenix PoCX as a complete mining setup, several cooperating components are at work. You do not need to start, stop, or configure them individually — Phoenix manages all of them from one window — but it is helpful to know what each one does.

| Component                    | What it does                                                                                                                                                              |
|------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Wallet**                   | Holds your keys, signs transactions, displays balances, history, and addresses.                                                                                           |
| **Node**                     | Connects to other Bitcoin-PoCX nodes, downloads the blockchain, and validates new blocks.                                                                                 |
| **Plotter**                  | Generates plot files on your drives. Runs once for each piece of new space, then is no longer needed.                                                                     |
| **Miner**                    | Reads your plot files whenever a new block arrives, finds deadlines, and submits them to the network.                                                                     |
| **Aggregator** *(optional)*  | Coordinates multiple mining machines into one farm. When enabled, it accepts submissions from remote miners and forwards the best of them upstream — to your own node or to a pool. |

If you only want to *use* the wallet, the plotter, miner, and aggregator stay quietly out of the way; the wallet and node are always running together. If you want to mine, you switch the plotter and miner on from the **Mining** section. If you run more than one mining machine, you can additionally enable the aggregator on the Phoenix instance of your choice and have your other miners report into it — covered in Part IV.

## What you will need

For everyday wallet use:

- A Windows, macOS, Linux, or Android device.
- A few gigabytes of free disk space for the node's blockchain data (this grows slowly over time).
- A reliable internet connection.
- A safe, offline place to store your recovery phrase.

For mining, you will additionally want:

- Disk space dedicated to plots. Even a few hundred gigabytes works for getting started, but a meaningful chance of forging solo blocks usually means *terabytes* of storage. Pool mining works well at any scale.
- A multi-core CPU (works on any computer) or — for much faster plotting — a GPU with up-to-date OpenCL drivers (Nvidia, AMD, or Intel). The GPU is only needed during plotting; forging itself runs on the CPU and uses little of it.

Chapter 14 (*Hardware Planning*) goes into specifics: how much storage is enough, why the *type* of hard drive matters far more than the price tag (the CMR vs. SMR distinction is critical for plotting), CPU vs. GPU plotting, and what a realistic mining setup looks like in practice.

## What's next

You now have a working mental model of Phoenix PoCX, Bitcoin-PoCX, and proof-of-capacity. The next chapter walks you through installing the wallet on your operating system. From there, Chapter 4 takes you through your first launch, and Chapter 5 helps you create your first wallet.

If your end goal is to mine, complete Chapters 3 through 5 first to get the wallet working — then jump ahead to Part III, where the mining and plotting chapters begin.
