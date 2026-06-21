# Hardware Planning

You have the mental model from Chapter 13. The next question is what to *buy* — or, more often, what of your existing hardware to *use*. This chapter walks through the decisions in roughly the order they matter: storage first (it dominates everything else), then the plotting machine, then the mining machine, then network and clock, then a quick word on rig shapes and what you do not need.

The good news, before any of this: Bitcoin-PoCX is intentionally hardware-friendly. Most of what you already own can mine; a meaningful share of what other industries throw away can mine too.

## Storage: the choice that matters most

Plot storage is what determines how much you mine. Everything else in this chapter is a supporting role.

### The hierarchy, briefly

| Storage type            | Role in a Bitcoin-PoCX rig                                                                     |
|-------------------------|------------------------------------------------------------------------------------------------|
| **CMR HDDs**            | The default. Cheapest per terabyte, sequential reads are exactly what mining wants.            |
| **SMR HDDs**            | Good for mining only. **Avoid for plotting.** See the next section.                            |
| **SATA SSDs**           | Uncommon. Wasted cost-per-TB for plot storage; rarely the right answer.                        |
| **NVMe SSDs**           | Specialist use only — see *Where SSDs and NVMe actually help* below.                           |

Read the next two sections in full before buying anything; the CMR/SMR distinction is the single biggest hardware decision you will make.

### CMR vs SMR — the critical distinction

All modern spinning HDDs use one of two recording technologies. The difference looks invisible on the label but is enormous in practice.

- **CMR — Conventional Magnetic Recording.** Tracks are laid down side by side without overlap. The drive can re-write any sector in place without disturbing its neighbours. Sustained write performance is consistent.
- **SMR — Shingled Magnetic Recording.** Tracks are partially overlaid, like roof shingles, to pack more data into the same platter. Re-writing a track may require rewriting many neighbouring tracks. To hide this from the OS, SMR drives include an on-disk cache (CMR-style "media cache" or host-managed/host-aware schemes), but the cache only buys time — sustained writes still collapse onto the rewrite penalty eventually.

For **plotting**, an SMR drive is poison. Plotting is a sustained, multi-hour write workload. The on-disk cache fills within minutes; from then on the drive crawls. A plot operation that should take six hours on a CMR drive can take two or three days on an equivalent-capacity SMR drive — and consume the drive's write-cycle budget far faster.

For **mining**, an SMR drive is perfectly fine. Forging only reads. There is no rewrite penalty during a mining round, no cache to fill, and no sustained-write workload. An SMR drive that has been plotted (somehow) and then handed to the miner mines just as well as a CMR drive.

### How to tell CMR from SMR before you buy

It is not visible from a typical retail listing. Reputable manufacturers publish the recording technology in their **data sheets**, usually as a single line like *"recording technology: CMR"* or *"recording technology: SMR / drive-managed shingled magnetic recording."*

For drives where the manufacturer is less forthcoming — including many lower-end consumer "white-label" drives — community-maintained references fill the gap. The patterns to look for:

- The manufacturer's own published CMR/SMR table (Western Digital, Seagate, and Toshiba have all published one at various points).
- Independent drive databases compiled by enthusiast communities (the Storage Review and Server-the-Home databases, the BackBlaze drive-stats reports, and similar) — they routinely list recording technology alongside capacity and performance metrics.

> **Tip** — Three minutes of research before clicking *buy* is worth dozens of wasted plotting hours after delivery. If a model number is not clearly identified as CMR or SMR, *assume SMR* and look for a different drive.

### Working with SMR drives you already own

If you have SMR drives — bought before knowing the distinction, inherited, repurposed from a backup setup — they are not useless. The proven workflow:

1. **Plot on a CMR drive as a staging area.** A single high-capacity CMR drive doubles as your plotting workbench. Generate the plot file there at the speed CMR allows.
2. **Move the finished plot file to the SMR drive.** A move is a single linear-write workload at near-sequential rates; even SMR drives handle that adequately. The destination drive only ever sees one large write per plot, not the many small ones plotting actually performs.
3. **The miner picks up the moved file.** From then on the SMR drive is read-only as far as your rig is concerned, and it mines at full effective capacity.

This is the *only* recommended way to use SMR drives in a Bitcoin-PoCX rig. Plotting directly onto SMR is not worth the time it costs.

### Where SSDs and NVMe actually help

SSDs and NVMe drives are typically a poor choice for *plot storage* — the cost per terabyte is far too high to justify what is essentially a long-term sequential read workload. But there is a specialist case where NVMe earns its keep:

- **Very small high-density rigs.** A miniature mining setup where a single NVMe is the entire storage budget — competition-level fast in absolute terms, modest in capacity. Niche; rarely the right shape.

For *plotting*, the most useful workflow we have seen is the **CMR-staging-then-move** approach described above. CMR plotting drives outperform NVMe for plotting too on a cost-per-warp basis, because plotting is much more about sustained sequential writes than peak random IOPS — exactly what CMR is built for.

### Capacity: bigger is usually better

Within reason, the highest-capacity CMR drives you can afford win on every relevant axis:

- **Cost per TB** drops with capacity, then plateaus around the largest sizes a generation can produce.
- **Power per TB** also drops — one 24 TB drive draws less than three 8 TB drives doing the same job.
- **Slot count** matters when you scale. A motherboard with eight SATA ports holds dramatically more plot space at 22 TB per drive than at 8 TB per drive.

The exception is when a particular *capacity* is unusually expensive at a given moment because of supply or generation transitions. Check current prices against the recent baseline before buying.

### The system drive is special

The drive your operating system lives on needs working room — for the OS itself, swap, logs, updates, the Phoenix install, and Bitcoin-PoCX Core's blockchain copy. Plotting it to the brim breaks the host before it benefits mining.

Phoenix's mining setup wizard (Chapter 15) recognises the system drive automatically and caps the plot allocation on it (the default is conservative — leave around a quarter of the drive free). Override only if you know exactly how much working space the host actually needs.

Every other drive — internal, external, USB, JBOD — should be plotted to its **full available capacity**. As Chapter 11 put it: every byte of plot is mining power.

### Internal, external, JBOD — all fine

The interface and packaging do not matter much for mining performance. SATA, SAS, USB, eSATA, an enterprise JBOD enclosure over an HBA — all of them deliver plot data fast enough that mining is not the bottleneck. Pick whatever maximises *capacity per dollar* and *slots per host* for your budget.

One caveat worth knowing:

- **USB enclosures** vary in quality. Inexpensive enclosures sometimes spin drives down aggressively to save power; Phoenix's mining settings include an *HDD wakeup* timer that compensates for this, but a well-behaved enclosure is better than a workaround.

> **Warning — no RAID. JBOD only.** Every layer of RAID is wrong for plot storage. Striping (RAID 0) buys you nothing useful — mining reads are already comfortably below sequential drive bandwidth. Mirroring (RAID 1) halves your effective capacity to duplicate work the protocol is happy to have you regenerate. Parity arrays (RAID 5 / 6 / Z) eat capacity on redundancy you do not need *and* add write penalties that punish plotting. Every time RAID appears in a Bitcoin-PoCX rig design, the design is wrong. If you have a hardware RAID card you want to repurpose, set it to **JBOD** or **HBA / pass-through** mode so each drive presents to the host individually.

### I/O bandwidth: the second hidden constraint

Disk *capacity* sets your share of network capacity in theory. Disk *I/O* sets it in practice. During a mining round, the miner has to read its scoop across every nonce in every plot before the next block lands. Although Bitcoin-PoCX targets 120-second blocks, individual intervals vary, and you want your read to complete well within the shorter ones. As a planning target, keep your full scan **under 40 seconds**, and ideally **under 20 seconds** for high effectiveness — Chapter 22 covers how to measure and tune this. A drive whose contribution cannot be read in time does not participate in that round.

Saturate your I/O and the consequence is *less effective capacity than your terabytes-on-the-shelf would suggest*. Time Bending (Chapter 13) mitigates this considerably — it reshapes the deadline distribution so very short blocks are less common — but the underlying constraint remains: if you cannot read fast enough, capacity beyond your I/O ceiling does not participate in fast rounds.

Rough bandwidth budgets to plan around:

- **A single USB 3.x host controller** typically saturates at three to four disks. Past that point, each additional drive on the same controller shares the same slice of bandwidth.
- **A modern HBA card** can drive on the order of twenty-four disks before its PCIe lanes or SAS link become the bottleneck, depending on the card and the PCIe generation.
- **Onboard SATA** sits in between, limited by the chipset's combined throughput across all its ports.

These are rules of thumb, not specifications. The planning rule is straightforward: **know where your I/O saturates before you add the next drive**, and either add HBAs, redistribute drives across additional USB host controllers, or split across machines as you approach the limit.

## Drive health for 24/7 operation

Plot storage in a mining rig runs continuously, which makes drive health more important than for a typical workstation drive. The model is *aim for long life, accept graceful failure*.

- **Monitor SMART.** A SMART-aware tool will flag the early-warning indicators — reallocated sectors, pending sectors, UDMA CRC errors, temperature creep — long before a drive becomes unusable. Read the metrics weekly, not daily.
- **Plan a cooling concept.** A 24/7 HDD spends most of its life warm; an HDD that runs hot spends most of its life *failing*. Adequate airflow across the drive cage, a few degrees of headroom on ambient, and conservative enclosure spacing are all cheap insurance.
- **Watch NVMe thermals if you use any.** NVMe drives throttle hard at temperature thresholds you can hit with no cooling at all in a typical case.

> **Note** — Recall from Chapter 11 that Bitcoin-PoCX mining is *graceful* about partial failure: a drive with five percent unreadable sectors keeps mining at roughly 95% of its previous capacity. Treat SMART warnings as a planning signal, not an emergency. Replace at your convenience; do not back up plots and do not mirror them with RAID.

### End-of-life drives are an asset

Because mining tolerates partial read failures and does not need write reliability, drives that have aged out of more demanding roles are unusually well-suited to Bitcoin-PoCX. Drives that a server farm has rotated out, drives someone returned under warranty as "questionable," workstation drives whose SMART has started creeping — all of them produce real mining capacity at zero acquisition cost beyond shipping. This is one of the practical reasons proof-of-capacity has a smaller environmental footprint than proof-of-work: drives that the rest of the world is recycling can keep earning.

## The plotting machine

Plotting is the only sustained compute load in the entire Bitcoin-PoCX workflow, and it is one-time work per piece of capacity. You can plot fast or slow; the question is how long you are willing to wait per drive.

### CPU plotting

Works on every machine Phoenix runs on, no special hardware required. Modern multi-core CPUs plot a 10 TB drive in roughly a day at full utilisation; older CPUs take longer but eventually finish.

- **Cores matter more than clock speed.** Plotting parallelises cleanly across cores.
- **Don't oversubscribe.** Allocating every available core to the plotter starves the rest of the system; leave one or two free for the OS and node.

CPU plotting is the right choice if you have no GPU, if your GPU is a low-end integrated chip, or if you only plot occasionally and waiting a couple of days is acceptable.

### GPU plotting (OpenCL)

A GPU accelerates plotting by an order of magnitude or more. Phoenix's plotter uses **OpenCL** with **dynamic loading**, so:

- You do **not** need to install an OpenCL SDK.
- You **do** need up-to-date OpenCL runtime drivers.
- Any modern **Nvidia**, **AMD**, or **Intel** GPU with current drivers works. The performance difference between vendors is far smaller than the performance difference between a mid-range GPU and CPU-only plotting.

A discrete GPU is a sensible investment if you plan to plot more than a few drives. The same GPU is then idle during mining — forging is CPU-only and reads-only — so its role is genuinely one-time per drive.

Chapter 17 covers OpenCL driver setup per platform.

### Plotting in parallel

Phoenix's mining configuration includes a *drives in parallel* setting. Plotting several drives at once shares the CPU/GPU more efficiently than plotting them sequentially, up to the point where one of them becomes the bottleneck. Two to four drives in parallel is a sensible range for most rigs; more than that only pays off on very high-end plotting hardware.

## The mining machine

This is the easy part. Forging is read-only, low-CPU, and runs comfortably on hardware that would feel underpowered for any other task.

- **CPU.** Any multi-core CPU from the last decade. The miner does light cryptographic work once per block; that is the entire compute load.
- **RAM.** A few gigabytes is enough. Bitcoin-PoCX Core itself wants ~2 GB for the mempool and indices; the miner adds a small constant; the OS uses the rest of whatever is in the machine.
- **Power.** Drives dominate. A typical 16-drive rig draws far more from the disk shelf than from the host. Switch to mining-rated low-RPM "archive" drives if power matters most, or 7200-RPM drives if marginal mining throughput matters most.

For most home miners, the *mining machine* and the *plotting machine* are the same physical computer with different workloads, configured by Phoenix as you go. Larger operations split them: dedicated plotting machine (transient, high-power), dedicated mining machines (continuous, low-power).

## Plotting and mining on the same machine

Phoenix handles the interaction between the plotter and the miner automatically — they do not compete for the same resources at the same time, and you do not have to schedule them by hand. The one rule that matters:

> **Do not plot and mine the same drive at the same time.**

A drive that is being filled with plot files cannot serve mining reads at the same time without crippling the plotter. Phoenix prevents this by design: a drive participates in *one* of the two roles at any given moment.

The typical lifecycle of a plot drive in a Phoenix rig is therefore:

1. You add a drive to the configuration; Phoenix queues it for plotting.
2. The plotter generates plot files on it. While this is happening, the drive is exclusively the plotter's.
3. When the drive is full, Phoenix hands it over to the miner. It joins the next mining round.
4. The drive mines indefinitely from that point on.

You can comfortably plot one drive while mining several others — Phoenix juggles which drive is in which role.

## Network and clock

Two requirements that catch beginners.

- **A reliable internet connection.** Bandwidth is modest — small per-block traffic, light RPC chatter — but uptime matters. A miner that loses connectivity for fifteen minutes misses the deadlines for seven or eight blocks.
- **A clock that stays synchronised.** Bitcoin-PoCX enforces a **15-second** timestamp tolerance — much tighter than Bitcoin's two hours. A drifting clock causes blocks to be silently rejected. The default network time service on Windows, macOS, and Linux is sufficient; check it is enabled, and that no aggressive power-saving profile is suppressing it. We mentioned this back in Chapter 3 because it bites first-time miners; we mention it again here because hardware planning is the right time to think about NTP.

## Realistic rig shapes

A short, opinion-free survey of where you can land, by way of orientation.

- **Home miner / starter.** A laptop or desktop with two to four external HDDs over USB. Tens of terabytes of plot space; modest expectations on solo rewards; usually pools to smooth out income. The right shape for learning.
- **Dedicated home rig.** A desktop motherboard with eight to twelve SATA ports, plus optional HBA cards for more. 100–300 TB of plot space; usable for solo at the low end, profitable in a pool at any scale.
- **Disk shelf or JBOD farm.** A small-form-factor server fronted by one or more external disk shelves over SAS. Several hundred TB to multiple PB. The aggregator (Chapter 24) is genuinely useful at this scale.
- **Distributed farm.** Multiple machines, each hosting several disk shelves, coordinated by one aggregator. Designed for capacity beyond what one host can hold.

These are not product recommendations; they are *shapes*. The best version of any of them uses the hardware available cheapest in your region at the moment.

## What you do not need

A few things people sometimes try to buy that are not actually required.

- **A "mining GPU."** GPUs only help during *plotting*. Mining is CPU-only and very light. Buying a high-end GPU expressly for mining is overkill.
- **A coin to "stake."** Bitcoin-PoCX is proof-of-capacity, not proof-of-stake. You do not need to hold a balance to mine. *(There are economic relationships between holding and mining in pool arrangements, but at the protocol level the only requirement is plot storage.)*
- **Brand-new drives.** Used drives, EOL drives, and drives flagged for retirement by primary-storage workloads all work fine. The economics of mining favour cheap drives that last another year.
- **Many machines.** A single well-equipped host can carry a meaningful operation. Add machines when you exceed what one host can hold; not before.
- **A dedicated network connection.** Bandwidth use is modest and bursty around new blocks. A normal home connection is fine.

## What's next

Chapter 15 walks you through the mining setup wizard — the first thing you encounter when you open Mining for the first time. It is where the hardware decisions you have just made are translated into a working configuration: chains, drives, devices, plotting address, and a few advanced options worth knowing about.
