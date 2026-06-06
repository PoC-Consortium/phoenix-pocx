# Benchmarking & Performance Tuning

This chapter closes Part III with the practical question every miner eventually asks: *am I getting the most out of my hardware?* It covers the device benchmark you met in the setup wizard, what its number means, and how to use it — together with the effective-capacity figure from the dashboard — to find and fix the bottleneck in your rig.

Performance tuning matters most for **plotting**, which is the only heavy, time-bound workload you control. Mining itself is light; the tuning there is about making sure all of your capacity actually *participates*, not about raw speed.

## Two numbers that matter

Almost all of your tuning revolves around two figures Phoenix already gives you:

- **Benchmark throughput (MiB/s)** — how fast a given device can *generate* plot data. Measured directly by the device benchmark in the setup wizard. This is your *plotting* speed metric.
- **Effective capacity (TiB)** — how much of your plotted storage is actually *competing* for blocks, derived from your deadlines on the dashboard (Chapter 20). This is your *mining* outcome metric.

The benchmark tells you how fast you can build capacity; effective capacity tells you whether the capacity you built is fully in the game. Tuning is the process of pushing the first as high as your hardware allows during plotting, and keeping the second as close to your physical capacity as possible during mining.

## The device benchmark

In **step 2 of the setup wizard** (Chapter 15), each detected device — every GPU and the CPU — has a **Benchmark** button. Clicking it runs a short, self-contained plotting workload on that device and reports the result in **MiB/s**.

![Benchmark results (MiB/s) shown next to each plotting device.](images/processed/ch15-plot-device.png){width=72%}

### What it measures

The benchmark runs the real plotting kernel for a fixed amount of work and times it, so the MiB/s it reports is a genuine measure of how fast that device will plot — not a synthetic score. A GPU that benchmarks at 600 MiB/s will plot at roughly that rate, subject to whether your drives can absorb the writes that fast (more on that below).

### Using it to choose a device

The benchmark's first job is device selection:

1. Run the benchmark on **every** device — each GPU, and the CPU.
2. Compare the MiB/s figures.
3. Select the fastest as your plotter (Chapter 15).

The gap is usually dramatic — a discrete GPU often benchmarks an order of magnitude above the CPU. The benchmark turns "which should I plot with?" into a measured decision rather than a guess.

### Using it as a sanity check

A successful benchmark also confirms a device *works* — particularly useful right after installing or updating a GPU driver (Chapter 17). A GPU that benchmarks is one Phoenix can plot with; a GPU that errors on the benchmark has a driver or capability problem to resolve before plotting.

## Tuning plotting speed

Once you have picked the fastest device, four settings (all in the wizard's step-2 advanced options, Chapter 15) determine how close to its benchmark you actually plot.

### Memory escalation — the biggest lever

Push it as high as your RAM allows, leaving ~1–2 GiB for the operating system. A larger plotter cache lets the plotter accumulate bigger contiguous chunks before flushing, which turns plotting into longer linear writes to the HDD and raises sustained throughput. This is usually the single most effective plotting-speed setting, because plotting is so often limited by how efficiently data reaches the disk rather than by raw compute.

### Drives in parallel — match device to disks

A fast plotting device can feed several drives at once. Match the parallelism to the ratio of the device's throughput to a single drive's write speed: a GPU that benchmarks at ~600 MiB/s can keep about four drives busy at ~150 MiB/s each, so *drives in parallel = 4* keeps the GPU saturated without starving any drive.

- Set it **too low** and the device idles, waiting on the one drive it is feeding.
- Set it **too high** and each drive starves, with the device's output spread too thin.

The benchmark number is exactly what you need to size this: divide the device's MiB/s by a typical drive's write speed to get a sensible starting parallelism.

### Direct I/O and async write

- **Direct I/O (plotter)** bypasses the OS file cache when writing plots — faster on the large sustained writes plotting produces.
- **Async write** overlaps disk writes with compute so the device is not stalled waiting for the disk. It is the default on the v2 plotter and should generally stay on.

Both default sensibly; leave them unless you have a specific reason and a measurement to justify the change.

## Finding the plotting bottleneck

With the benchmark in hand, you can identify what is actually limiting your plotting speed by comparing the *observed* plotting rate (shown in the plotter card during a run, Chapter 16) against the benchmark:

| Observation                                              | Bottleneck                                            | Fix                                                                 |
|----------------------------------------------------------|-------------------------------------------------------|---------------------------------------------------------------------|
| Plotting rate close to the benchmark rate                | The device is the limit — it is fully utilised.       | You are done; this is the goal. Buy/borrow a faster device only if the speed is unacceptable. |
| Plotting rate well **below** benchmark, drives at full write speed | Disk write throughput is the limit.            | Add more drives in parallel (if the device has headroom), or accept it — your device out-runs your disks. |
| Plotting rate **below** benchmark, drives **not** at full write speed | Not enough parallelism or too little cache.    | Raise *drives in parallel* and *memory escalation*.                 |
| Plotting rate drops over time on a particular drive      | Likely an SMR drive hitting its rewrite penalty.      | Stop plotting directly to SMR; stage on CMR and move (Chapter 14).  |

> **Tip** — A well-tuned GPU plotter is usually bottlenecked by *drive write speed*, not by the GPU. When adding parallel drives stops raising the observed rate, you have reached your rig's practical plotting ceiling — the GPU is faster than your disks can absorb, which is a good problem to have.

## Tuning the mining side

Mining performance is not about speed — forging is light — it is about making sure **all** of your plotted capacity participates in every block. The metric is **effective capacity** (Chapter 20): if it sits close to your physical plot size, every byte is in the game; if it lags persistently, something is holding capacity back.

The mining-side settings that matter:

- **Mining direct I/O** (wizard step 3) — bypasses the OS file cache for plot scans. Often improves performance on rigs with many drives, where the cache is useless anyway.
- **HDD wakeup** (wizard step 3) — gives drives that spin down (cheap USB enclosures) enough lead time to be ready when a block arrives. A drive still spinning up when the scan starts contributes nothing to that round.
- **I/O bandwidth headroom** (Chapter 14) — the structural one. If your plots cannot all be read within the block interval, the un-read portion does not participate. This shows up as effective capacity below physical capacity and is fixed by adding HBAs, spreading drives across more controllers, or splitting across machines.

### Target scan times

The single most useful number for mining-side tuning is **how long a full scan of your plots takes** — visible in the miner's scan progress and in how quickly *Scanning* gives way to *Idle* (Chapter 20). For Bitcoin-PoCX, with its 120-second target block interval, aim for:

- **Under 40 seconds** — the maximum you should target. Above this, short block intervals increasingly close before your scan finishes, and the un-scanned capacity sits out those rounds.
- **Under 20 seconds** — recommended for high effectiveness. At this scan time, effective capacity tracks physical capacity closely because your plots are almost always fully read in time, even on the shorter block intervals that Time Bending still permits.

If your scans run longer than 40 seconds, your I/O is the bottleneck: too many drives behind one controller, an over-subscribed USB host, or a single HBA serving more disks than its bus can sustain. The remedy is the I/O work from Chapter 14 — add HBAs, redistribute drives across controllers, or split the farm across machines (Chapter 24) — not anything in the plotter.

## Reading effective capacity as a performance gauge

A persistent gap between physical and effective capacity is the clearest signal that mining is leaving something on the table. The usual causes, in rough order of likelihood:

| Effective capacity is…                          | Likely cause                                                              | Where to look |
|-------------------------------------------------|---------------------------------------------------------------------------|---------------|
| Below physical, steadily                        | I/O bandwidth ceiling — plots not all readable in time.                   | Chapter 14    |
| Exactly half (or a quarter) of physical         | Plots a PoW scaling level (or two) behind the network — each level halves. | Chapters 15, 18 |
| Dropped suddenly                                | A drive went unavailable, or the network stepped up a scaling level.      | Chapter 20 drives panel |
| Far below physical right after adding drives     | New drives not finished plotting yet, or an I/O controller now saturated. | Chapters 14, 16 |

> **Note** — Effective capacity is a *statistical estimate* that converges over time, so short-term wobble is normal — judge it over hours, not minutes. A single low block, or a quiet stretch with no forged blocks, tells you nothing; a sustained gap between physical and effective capacity tells you plenty.

## A tuning workflow

Putting it together, the order to tune in:

1. **Benchmark every device** and select the fastest as your plotter.
2. **Push memory escalation** as high as RAM allows (leave 1–2 GiB for the OS).
3. **Set drives-in-parallel** from the benchmark: device MiB/s ÷ per-drive write speed.
4. **Plot, and watch the plotter card's observed rate** against the benchmark; use the bottleneck table above to close the gap.
5. **Once mining, watch effective capacity** against physical capacity over hours; use the effective-capacity table to chase down any persistent shortfall.

Do the plotting tuning once, properly, before you plot many terabytes — the gains compound across every drive. Revisit the mining-side tuning whenever you add hardware or the network changes scaling level.

## What's next

That completes Part III. Part IV covers special topics that not every miner needs: **Chapter 23 — Mining on Android**, **Chapter 24 — the multi-machine Aggregator**, and **Chapter 25 — Running Your Own Node**. If none of those apply to you, skip ahead to Part V for troubleshooting, the FAQ, and the glossary.
