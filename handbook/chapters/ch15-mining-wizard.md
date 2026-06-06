# The Mining Setup Wizard

The first time you open **Mining** in Phoenix, the wallet does not show you a dashboard — it shows you the **setup wizard**. The wizard collects everything Phoenix needs to mine on your behalf: which chains to mine against, which hardware to use for plotting, where the plot files should land, and a handful of advanced knobs. This chapter walks through it screen by screen.

You can re-open the wizard at any time after the initial run; it remembers your previous answers and pre-fills them. Use it the same way to add a new chain, swap your plotter device, or add another drive.

## Opening the wizard

From the sidebar, click **Mining Dashboard**. If you have not yet completed setup, Phoenix redirects you into the wizard automatically. Otherwise, a small **Setup** action on the dashboard re-opens it.

![Mining wizard step 1: the three-step indicator and chain configuration.](images/processed/ch15-chain-config.png){width=72%}

A step indicator at the top of every wizard page shows where you are: **Miner → Plotter → Drives**. Each step has its own section of options plus a collapsible *Advanced options* block. The footer holds the navigation: **Back** / **Next** while you are mid-wizard, **Save & close** once you reach the end (or, on a re-run, on any step).

## Step 1 — Miner

The first step configures **who** you are mining for: which chains your miner reports into, and the CPU budget that mining itself is allowed to use.

### Chain configuration

A *chain* in Phoenix is a target the miner submits solutions to. Solo-mining your own node is one kind of chain; a pool is another; a custom endpoint (a private pool, a development node, a relay) is the third.


The list shows every chain you have configured, with the priority slot on the left and a drag handle for re-ordering.

| Element        | What it means                                                                                  |
|----------------|------------------------------------------------------------------------------------------------|
| **Priority slot** | When more than one chain has a new block to mine, this sets which one the miner works first. Drag the handle to reorder. |
| **Chain name** | Your label for the chain.                                                                      |
| **URL / hint** | For solo, *"Solo mining via local node"*. For pool and custom, the `transport://host:port`.    |
| **Mode badge** | *Solo* or *Pool* — see the chain mode below.                                                   |
| **Aggregator badge** | A small *hub* icon appears on solo chains when the aggregator is enabled (Chapter 24).   |
| **Edit / Remove** | The pencil edits; the cross removes the chain. Confirmations protect destructive actions. |

A first-time setup starts with the list empty. Click **Add chain** to open the chain modal.

### Adding a chain — the modal

The modal asks three things in sequence: the chain name, the mode, and the mode-specific connection details.

**Chain name.** Anything you can recognise later — *"Local node"*, *"Pool A"*, *"Friend's pool"*. Useful when you have several chains and need to spot one in the priority list.

**Mode.** Three radio buttons:

- **Solo.** Mine via the local Bitcoin-PoCX Core node Phoenix is already connected to. No URL or credentials required; everything stays in-process.
- **Pool.** Mine into a pool you select from a built-in list of known pools (the list is curated by the project; you do not type a URL yourself).
- **Custom.** Mine into a URL you supply. Used for private pools, development nodes, or relays. You also specify whether the endpoint runs in *solo* or *pool* mode and what block time to assume.

**Connection and authentication.** Pool and custom modes show an *authentication* section with three options:

| Auth        | When to use it                                                                                |
|-------------|-----------------------------------------------------------------------------------------------|
| **None**    | The endpoint accepts unauthenticated submissions.                                             |
| **User + password** | The endpoint expects HTTP-Basic-style credentials.                                    |
| **Cookie**  | The endpoint accepts a cookie file path you supply.                                           |

Solo mode also exposes a small **Aggregator** toggle in the modal. Enable it here if this Phoenix instance is going to be the aggregator for a multi-machine farm (Chapter 24); leave it off otherwise.

> **Tip** — A typical first setup has exactly one chain: a solo chain against your local Bitcoin-PoCX Core. Pool mining usually requires an on-chain forging assignment to the pool's forging address before submissions are accepted, which is a Chapter 19 concern. Set the solo chain up first, get mining working, and revisit pool configuration once you understand how assignments work.

### CPU / Performance

![Step 1: the CPU section and mining-threads slider.](images/processed/ch15-cpu.png){width=72%}

This section detects the host's CPU and shows you what it can offer:

- **Name** — e.g. *Intel Core i7-14700K* / *AMD Ryzen 9 7950X*.
- **Threads available** — the total logical thread count the OS reports.
- **Features** — relevant instruction sets the plotter or miner can use (AVX2 and similar).

The **Mining threads** slider sets how many of those threads the *miner* may consume (this is independent of the *plotter*, which has its own settings in step 2). Mining is cheap on the CPU; the default is usually a small fraction of the available thread count, and there is rarely a reason to push it higher.

> **Tip** — Leave at least one or two threads unallocated for the operating system, Bitcoin-PoCX Core, and Phoenix itself. The marginal gain from squeezing every thread into mining is small; the cost when the host becomes sluggish is much larger.

### Advanced options (step 1)

A collapsible block at the bottom of the step exposes two pairs of knobs.

| Setting                       | What it controls                                                                                |
|-------------------------------|-------------------------------------------------------------------------------------------------|
| **Poll interval (ms)**        | How often the miner asks the chain for new mining info. Default is 1 second.                    |
| **Request timeout (ms)**      | How long a single chain RPC call is allowed before it is considered failed. Default is 5 seconds. |
| **Enable on-the-fly compression** | Lets the miner use plot files from an *older* PoW scaling generation against the current one. The plotter normally writes files at the network's current minimum scaling level (X1, X2, …); when the network steps up a level, files from the previous level still work with this enabled — the miner adapts them at scan time. The catch: each scaling level you are behind **halves** the effective size of those older files. Upgrading the plots (re-plotting at the new level) is always preferable; this option keeps you mining in the meantime rather than going dark the moment the network advances. |
| **Thread pinning**            | Pins worker threads to specific CPU cores. Improves cache locality on consistent hardware; sometimes hurts on hybrid-core CPUs. |

These defaults work for nearly every setup; touch them only if you know what they will improve.

When you are happy with step 1, click **Next**.

## Step 2 — Plotter

Step 2 configures **how** plot files are generated: the device that does the heavy lifting, the address embedded in every plot, and the small set of plotter performance options.

### Plotting device

![Step 2: the plotting-device list (GPU, APU, and CPU) with Benchmark buttons.](images/processed/ch15-plot-device.png){width=72%}

Phoenix scans the host and lists every device that can plot: discrete GPUs, integrated GPUs (APUs — accelerated processing units), and the CPU as a fallback. Each row shows:

- **Name and type** — e.g. *Nvidia GeForce RTX 4070*, with an *APU* badge when relevant.
- **Memory / threads** — GPU VRAM or CPU thread count.
- **OpenCL version** — for GPU devices.
- **Benchmark button** — runs a short throughput benchmark on this device.

You pick **one** device as the plotter via the radio selector. The benchmark is the practical way to compare candidates: run it on every device and pick the one with the highest MiB/s.

If no GPUs are detected, the wizard shows an info box reminding you that CPU plotting works but is slower; a discrete GPU is the easiest way to plot meaningfully faster (Chapter 14).

**Thread / compute-unit count.** Each device row has a small input that bounds how many threads (CPU) or compute units (GPU) the plotter may use. For GPUs, the maximum is the device's reported compute unit count; for CPUs, it is the available thread count. The same "leave headroom for the OS" rule applies as for mining threads.

### Plot address

![Step 2: the plot address â€” here using a custom address (no wallet on this instance).](images/processed/ch15-plot-address.png){width=72%}

Every plot file embeds the address that will receive rewards from blocks it forges. The wizard offers two options.

- **Use wallet address** *(recommended)* — Phoenix pre-fills the *first* address derived from your active wallet's descriptor. This address has a fixed position in the HD key tree, so it is the same every time the wallet is re-derived from its seed. It is the simplest, most recognisable choice for almost every miner.
- **Custom address** — type any Bitcoin-PoCX address. Validation runs as you type and the wizard shows a small badge:

| Badge                       | Meaning                                                                              |
|-----------------------------|--------------------------------------------------------------------------------------|
| **Invalid** (red)           | The address fails format, checksum, or network checks.                               |
| **Key, green — "mine"**     | The address belongs to your wallet — you hold the signing key directly.              |
| **Key, green — "assigned"** | The address has a forging assignment in your wallet's favour — you can still sign for blocks forged to this address. |
| **Key, amber — warning**    | The address is valid, but neither held by your wallet nor assigned to it. Plots tied to this address can mine, but the block-signing must happen elsewhere — typically via a forging assignment (Chapter 19) or by routing solutions to whoever does hold the key. |

> **Tip** — For most setups, leave **Use wallet address** selected. The Custom address option is the deliberate exception — for example, when you specifically want plots tied to a different wallet you also control, or when you are setting up a delegated mining arrangement where the destination machine should not contain the original wallet's keys.

> **Warning** — If you came here to mine to a *pool*, do **not** set the pool's address as the plot address. Instead, leave the wizard at *Use wallet address* and arrange a forging assignment from your address to the pool's forging address (Chapter 19). The wizard's plot-address field defines the *plot owner*, not the *forger*; trying to bypass the assignment by plotting to the pool's address breaks the recovery story without solving any problem.

### Advanced options (step 2)

The collapsible block in step 2 is the densest part of the wizard. Most of it is safe to leave alone; the parts worth understanding follow.

**Memory estimation.** A box at the top of the advanced block shows Phoenix's estimate of how much RAM the plotter will use, broken down into a *plotter cache* line and an *HDD cache* line (the latter scales with *drives in parallel*). The total is compared against your system's available RAM; the *available RAM* value turns yellow if the estimate exceeds it.

![Step 2 advanced: the estimated-memory box against available RAM.](images/processed/ch15-memory-estimation.png){width=72%}

| Setting                  | What it does                                                                              |
|--------------------------|-------------------------------------------------------------------------------------------|
| **Drives in parallel**   | How many drives the plotter writes to simultaneously. Match this to your plotting device's throughput versus per-drive write speed: a GPU that plots at ~600 MiB/s can keep four drives busy at ~150 MiB/s each, so *drives in parallel = 4* saturates it. Set it too low and the device idles; too high and each drive starves. 2–4 is a reasonable range for most rigs; pushing higher only pays off when the plotting device is fast enough to feed them all. |
| **Memory escalation**    | A multiplier on the per-drive plotter cache budget — **use as much of your RAM as you can spare.** A larger cache lets the plotter accumulate bigger contiguous chunks before flushing, which turns plotting into longer linear writes to the HDD and raises write throughput. Aim for **5 or higher** if your RAM supports it. Use the live memory-estimation box above as your guide: push the value up until the estimated total is close to your available RAM, leaving roughly **1–2 GiB free for the operating system**. Going past that — so the estimate exceeds available RAM — risks swapping, which is far slower than the plotting speed you were trying to gain. |
| **PoW scaling level**    | The X-level the plotter writes — `X1` through `X6`. Higher levels embed exponentially more proof-of-work per warp, in line with the network's halving schedule (whitepaper §6). The wizard defaults to the network's current minimum; you can pre-plot one level higher to avoid an immediate upgrade after the next halving. |
| **Direct I/O (plotter)** | Bypasses the OS file cache when writing plot files. Faster on large workloads; can interfere with cache-aware backup tools (which you should not be using on plot drives anyway). |
| **Async write**          | Issues plotter writes asynchronously to overlap I/O with compute. The default on the v2 plotter. |
| **Low priority**         | Runs the plotter at a lower OS-level process priority. Use if the host needs to remain responsive to other work during plotting. |

Click **Next** when you are happy with step 2.

## Step 3 — Drives

The final step is where you actually point Phoenix at the drives that will hold plots. This is also the step you will most often revisit after the initial run, every time you add or remove a drive.

![Step 3: plot directories, summary totals, and a drive card.](images/processed/ch15-drives.png){width=72%}

### Plot directories

Click **Add folders** in the section header to open the platform's native folder picker. Pick the folder where plots should live on the drive — typically the drive root or a top-level subfolder.

> **Note** — Phoenix uses one folder per drive. Selecting two folders on the *same* physical drive is rejected with a warning, because Phoenix expects a one-to-one mapping between drives and plot folders.

### The summary totals

A row across the top of the drives section summarises your plotting plan across every configured drive:

| Total            | What it counts                                                                              |
|------------------|---------------------------------------------------------------------------------------------|
| **Plotted**      | Complete `.pocx` files already on disk and ready for mining.                                |
| **Unfinished**   | Partial `.tmp` files left over from interrupted plotting sessions. The plotter can resume these. |
| **To plot**      | New space you have allocated for fresh plot generation.                                     |
| **Total**        | The sum of the three.                                                                       |

### Per-drive card

Each configured drive gets a card with three rows.

**Header row.** The drive path on the left; a *total capacity* badge on the right; refresh and remove buttons on the far right. Two badge variants flag problems:

- **System drive warning** — appears when the drive Phoenix detects as your OS drive is configured at the default cap (the wizard caps it for safety; see *Advanced options* below).
- **Same-drive conflict** — appears when you have configured another folder on the same physical drive. Phoenix refuses to plot the same drive twice; resolve by removing one of the folders.

**Segment bar.** A horizontal bar visualises the drive's contents, in this colour-coded order:

| Segment            | What it represents                                                                          |
|--------------------|---------------------------------------------------------------------------------------------|
| **Other data**     | Non-plot files already on the drive (OS, documents, anything else).                         |
| **Plotted**        | `.pocx` files already complete.                                                             |
| **Unfinished**     | `.tmp` files the plotter can resume.                                                        |
| **To plot**        | New space you are about to allocate, in the *Allocated* colour.                             |
| **Free**           | Space left over after all of the above.                                                     |

**Allocation slider.** A slider plus a numeric input on the same row lets you set how many GiB Phoenix should add to the *To plot* segment. Drag the slider to the right (or type a number) to commit more of the drive's free space to plotting; the segment bar updates immediately.

> **Tip** — Per Chapter 14: every byte of plot is mining power. On any non-system drive, push the *To plot* slider as far right as it will go. Phoenix's free segment is sized for safety, not for opportunity.

### Advanced options (step 3)

| Setting                       | What it controls                                                                                |
|-------------------------------|-------------------------------------------------------------------------------------------------|
| **HDD wakeup (s)**            | How early the miner should issue a small wake-up read before each block to spin up drives that may have spun down. Increase for cheap USB enclosures that idle aggressively. |
| **Mining direct I/O**         | The mining-side equivalent of the plotter's Direct I/O option. Bypasses the OS file cache for plot scans. Often improves performance on rigs with many drives. |
| **System drive max %**        | The cap on how much of a *system drive* Phoenix is allowed to plot, expressed as a percentage of total capacity. The default leaves a safety margin for the OS. Override only if you have manually verified that the host has enough working room. |

## Saving and starting

The wizard's footer keeps two buttons handy:

- **Save & close** — commits the current configuration to disk and returns to the Mining Dashboard. Visible on every step after the first wizard run, and on step 3 of the first run.
- **Next** — advances to the next step. Visible on steps 1 and 2.

Saving does *not* automatically start plotting or mining. It commits the configuration so the Mining Dashboard can act on it; you start the actual work from there.

> **Warning — encrypted wallets and mining.** If the wallet whose first address you selected (or the wallet you used as a custom plot address) is encrypted, the miner cannot sign blocks while the wallet is locked, which it will be after every Phoenix restart. Mining will silently stall until a human unlocks it. Re-read the relevant section of Chapter 5 if this trade-off matters, or set up the cold/hot split via forging assignments described in Chapter 19.

## What's next

You have a saved mining configuration. The next chapter — **Creating Plot Files** — covers the act of actually plotting the drives you just configured: starting the plot plan, watching its progress, pausing and resuming, and what to expect when it finishes. Chapter 17 covers GPU-specific concerns; Chapter 18 covers ongoing plot/drive management once plots exist.
