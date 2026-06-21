# Glossary

Definitions of the terms used throughout this handbook. Where a term has a dedicated discussion, the relevant chapter is noted.

**Aggregator.** A built-in Phoenix server that collects mining submissions from several remote machines and forwards the best of them upstream — to its own wallet (solo) or to a pool. Turns a fleet of mining machines into one coordinated farm. *(Chapter 24)*

**APU (Accelerated Processing Unit).** An integrated GPU that shares system memory with the CPU, common in laptops and low-power desktops. Can plot if it has at least 3 GiB of available memory, often set in firmware. *(Chapter 17)*

**Base target.** A difficulty parameter the network adjusts every block to keep the average block interval near 120 seconds. It converts a plot's *quality* into a *deadline*; a higher base target means easier mining and shorter deadlines. *(Chapter 13)*

**Bech32.** The modern address format Bitcoin-PoCX uses, beginning with `pocx1q` on mainnet or `tpocx1q` on testnet. Lower-case, error-resistant, and what the network expects. *(Chapter 7)*

**BIP39.** The standard that defines the 24-word recovery phrase (mnemonic) from which a wallet's keys are derived. *(Chapters 5, 11)*

**BIP39 passphrase (25th word).** An optional extra secret that combines with the 24-word phrase to produce a different wallet. Adds security but is itself unrecoverable if lost. *(Chapters 5, 11)*

**Block.** A batch of transactions added to the blockchain. In Bitcoin-PoCX a new block is forged roughly every 120 seconds. *(Chapter 2)*

**Block reward.** The BTCX paid to whoever forges a block. Starts at 10 BTCX and halves on the network's halving schedule. *(Chapter 2)*

**BTCX.** The native currency unit of Bitcoin-PoCX. Divides into 100,000,000 satoshis, like Bitcoin. *(Chapter 2)*

**CMR (Conventional Magnetic Recording).** Hard-drive recording technology with non-overlapping tracks and consistent write performance. The recommended technology for plot storage. *(Chapter 14)*

**Coinbase.** The special transaction in each block that pays the block reward. Coinbase rewards must mature before they can be spent. *(Chapters 9, 13)*

**Coinbase maturity.** The waiting period before a newly forged block reward becomes spendable. Until then it shows as *immature*. *(Chapter 9)*

**Cookie authentication.** An RPC authentication method where Bitcoin-PoCX Core writes a rotating `.cookie` file that clients read. Preferred for local or trusted nodes. *(Chapters 12, 25)*

**Deadline.** The number of seconds a plot would have to wait before being eligible to forge a given block. The smallest deadline on the network wins. Smaller is better. *(Chapter 13)*

**Descriptor (output descriptor).** Bitcoin Core's expression for a whole family of addresses derived from a key, used for watch-only wallets and behind the scenes for ordinary wallets. *(Chapter 5)*

**Difficulty.** A measure of how hard it is to forge a block, adjusted by the network via the base target. *(Chapters 13, 20)*

**Direct I/O.** A setting that bypasses the operating system's file cache when reading or writing plots, often improving performance on large workloads. *(Chapters 15, 22)*

**Effective capacity.** An estimate of how much usable plot space your miner *appears* to have, computed from your recent deadlines rather than from raw drive size. Converges over time toward your true participating capacity. *(Chapters 20, 22)*

**External mode.** The node mode in which Phoenix connects to a Bitcoin-PoCX Core instance you run yourself, rather than one it manages. *(Chapter 25)*

**Forging.** Producing a block in proof-of-capacity — the equivalent of "mining a block" in proof-of-work. Done by reading plots and signing the winning block. *(Chapters 2, 13)*

**Forging address.** The address whose key signs blocks for a plot. By default the same as the plot address; a forging assignment can delegate it to another address. *(Chapter 19)*

**Forging assignment.** An on-chain delegation that transfers the right to forge with a plot from the plot owner to a nominated forging address, without transferring ownership. The basis of pool mining and cold/hot key splits. *(Chapter 19)*

**Generation signature.** A value derived from the previous block that determines which scoop each plot must read for the current block. Unpredictable in advance, which prevents precomputation. *(Chapter 13)*

**Halving.** The periodic halving of the block reward, on a schedule roughly every four years, preserving Bitcoin-PoCX's ~21 million total supply. *(Chapter 2)*

**HBA (Host Bus Adapter).** A card that connects many drives to a host, used to scale a rig beyond the motherboard's drive ports. A modern HBA can drive on the order of two dozen disks. *(Chapter 14)*

**Immature.** The state of a block reward that exists on the chain but has not yet passed its coinbase maturity period, so it cannot be spent. *(Chapter 9)*

**JBOD (Just a Bunch Of Disks).** Presenting each drive to the host individually, with no RAID. The correct way to attach plot drives. *(Chapter 14)*

**Managed mode.** The default node mode, in which Phoenix downloads, runs, and updates Bitcoin-PoCX Core for you. *(Chapters 4, 12)*

**Mempool.** The buffer of broadcast-but-unconfirmed transactions waiting to be included in a block. *(Chapters 7, 9)*

**Mnemonic.** See *recovery phrase*.

**Network capacity.** An estimate of the total plot space across the entire Bitcoin-PoCX network. Your share of it is roughly your share of blocks. *(Chapter 20)*

**Node.** The Bitcoin-PoCX Core program that connects to the network, downloads and validates the blockchain, and holds the wallet. Phoenix drives a node; it is not itself the node. *(Chapters 2, 6)*

**Nonce.** The smallest meaningful unit of plot data — a 256 KiB structure derived from the plotting address, a seed, and an index. Each nonce contains 4096 scoops. *(Chapter 13)*

**NTP (Network Time Protocol).** The standard service that keeps a computer's clock synchronised. Essential for mining, given Bitcoin-PoCX's 15-second timestamp tolerance. *(Chapters 14, 26)*

**OpenCL.** The open standard Phoenix's plotter uses to run on GPUs. Requires runtime drivers but no SDK. *(Chapter 17)*

**OP_RETURN.** A standard way to write a small amount of data onto the blockchain without creating spendable coins. Forging assignments are published this way. *(Chapter 19)*

**Orphan (file).** A partially written plot (`.tmp`) that cannot be resumed under the current configuration — because the plotting address or scaling level has changed since it was started. Must be resolved before plotting can continue. *(Chapter 18)*

**Plot / plotting.** A plot is a large file of precomputed data (`.pocx`) used for mining; plotting is the one-time process of generating it. *(Chapters 13, 16)*

**Plot address / plotting address.** The address embedded in a plot file when it is generated, identifying who owns the plot and (by default) who receives its rewards. *(Chapters 7, 15)*

**PoCX (Proof-of-Capacity, NeXt Generation).** The consensus mechanism of Bitcoin-PoCX: mining power derives from committed disk space rather than computation. *(Chapters 2, 13)*

**Pool.** A service that aggregates many miners' submissions, forges blocks on their behalf, and distributes rewards by contribution. Requires a forging assignment to the pool's address. *(Chapters 13, 19)*

**PoW scaling level (Xn).** The amount of proof-of-work embedded in a plot's warps. The network raises the minimum level over time; plots below the current level mine at reduced effective capacity (each level behind halves it). *(Chapters 13, 15, 20)*

**Proof-of-capacity.** See *PoCX*. A consensus model where mining power comes from stored data. *(Chapters 2, 13)*

**Proof-of-work.** Bitcoin's original consensus model, where mining power comes from continuous computation. Bitcoin-PoCX replaces it with proof-of-capacity. *(Chapter 2)*

**Quality.** A 64-bit value computed for each nonce from the selected scoop and the generation signature; lower quality yields a smaller (better) deadline. *(Chapter 13)*

**RBF (Replace-By-Fee).** A flag that lets a broadcast transaction be re-sent later with a higher fee to speed up confirmation. *(Chapters 8, 9)*

**Recovery phrase.** The 24-word BIP39 mnemonic that is the master backup of a wallet. Anyone with it controls the funds; losing it (without another copy) loses the funds. *(Chapters 5, 11)*

**Regtest.** A local-only test network for development, with instant low-difficulty blocks. Not exposed in Phoenix's wizard; reached via external mode. *(Chapters 4, 25)*

**RPC (Remote Procedure Call).** The interface Phoenix uses to talk to Bitcoin-PoCX Core. *(Chapters 12, 25)*

**Satoshi.** The smallest unit of BTCX; one hundred-millionth of a BTCX. *(Chapter 2)*

**Scoop.** A 64-byte slice within a nonce. Each block selects one scoop index (0–4095); only that scoop is read from each nonce when mining. *(Chapter 13)*

**Seed.** A per-plot value that lets one address have multiple non-overlapping plots without manual coordination. *(Chapter 13)*

**SMART.** Drive self-monitoring data (reallocated sectors, temperature, and so on) used to spot a failing drive early. *(Chapter 14)*

**SMR (Shingled Magnetic Recording).** Hard-drive technology with overlapping tracks that packs more data per platter but collapses under sustained writes. Fine for mining (reads), poison for plotting (writes). *(Chapter 14)*

**Solo mining.** Mining for yourself against the network, keeping the full reward when you win — at the cost of rare, bursty wins for a small miner. *(Chapters 13, 19)*

**Testnet.** A public test network where coins have no value, used for development and experimentation. *(Chapter 4)*

**Time Bending.** A protocol transformation that reshapes the distribution of deadlines to make block intervals more regular without changing the average. *(Chapter 13)*

**UTXO (Unspent Transaction Output).** A discrete piece of received, not-yet-spent BTCX. Wallets spend UTXOs and create new ones, including change back to themselves. *(Chapters 8, 9)*

**vByte (virtual byte).** The unit transaction fees are quoted in (`sat/vB`), accounting for the discount given to signature data. *(Chapter 8)*

**Wake lock.** An Android mechanism Phoenix holds to keep the CPU running with the screen off, so background mining continues. *(Chapter 23)*

**Wallet (in Bitcoin-PoCX Core).** The keys, addresses, and balance held inside the node. Phoenix is the interface to it; the keys themselves never live in Phoenix. *(Chapter 6)*

**Warp.** A storage container of 4096 nonces (1 GiB), the structural unit of plot files and the unit most capacity figures are quoted in. *(Chapter 13)*

**Watch-only wallet.** A wallet that holds no private keys — it observes addresses or descriptors and reports their balance and history but cannot spend. *(Chapter 5)*

**WIF (Wallet Import Format).** A standard encoding of a single private key, importable into a wallet via Settings. *(Chapter 12)*

**Xn.** See *PoW scaling level*.

## What's next

The final chapter — **Where to Get Help** — points you to the project's community, support channels, and source material for anything this handbook does not cover.
