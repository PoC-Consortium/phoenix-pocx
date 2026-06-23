# Creating Plot Files

With the setup wizard complete (Chapter 15), Phoenix knows which drives to plot, which device to plot with, and which address to embed. This chapter covers the act of actually generating the plots: starting the plotter, reading its progress, pausing and resuming, and what happens when a drive finishes.

This chapter focuses on the plotting workflow itself. GPU-specific driver concerns are in Chapter 17; managing plots and drives *after* they exist is in Chapter 18.

## The plot plan

Phoenix does not plot drives blindly. From your drive configuration, it builds a **plot plan** — an ordered list of tasks that, executed top to bottom, fills every allocated drive. You do not write this plan; Phoenix generates it whenever the relevant configuration changes (when you save the wizard, when you first enter the mining section, or after a hard stop). It exists only at runtime and is not something you back up or edit by hand.

A plan is made of three kinds of task:

| Task type        | What it does                                                                                  |
|------------------|-----------------------------------------------------------------------------------------------|
| **Plot**         | Generate a fresh chunk of plot file on a drive that has space allocated for new plots.        |
| **Resume**       | Continue a partially written `.tmp` file left over from an interrupted earlier session.       |
| **Add to miner** | Hand a finished drive over to the miner so it joins the next mining round. No disk work.      |

The plan is ordered so that resumable `.tmp` files are dealt with sensibly, fresh plotting follows, and each completed drive is added to the miner as it becomes ready.

> **Note** — Each **Plot** task produces one plot *file*. The size of those files is the **Plot file size** set in the wizard's step-3 (Drives) advanced options (Chapter 15) — 1 TiB by default. A drive's allocation is split into as many full-size files as fit, plus a smaller remainder file for whatever is left over. This is also the unit a *soft stop* completes before pausing (see *Stopping plotting* below).

> **Tip** — You can inspect the full plan before or during plotting. The Mining Dashboard's plotter area includes a **plan viewer** that lists every task with its drive, size, and status. It is the most direct way to answer "what is Phoenix about to do, and in what order?"

## Where plotting is controlled

Everything in this chapter happens on the **Mining Dashboard** (sidebar → *Mining Dashboard*). Near the top of the dashboard is the **plotter card** — a compact control that changes shape depending on what the plotter is doing.

![The plotter card in the ready state, with the Start button and plan size.](images/processed/ch16-plotter-ready.png){width=55%}

The plotter card has four states. You will see exactly one at a time.

### Ready

A drive is configured with space to plot (or a resumable `.tmp` exists), but the plotter is not running. The card shows a green **Start** button and a one-line summary — either how much is left in the current plan, or how much is queued and ready.

Click **Start** to begin executing the plan.

### Plotting

The plotter is actively working. The card switches to a red **Stop** button plus a live progress display:

- **Task counter** — *"Task 3 of 12"* — which plan item is being worked and how many there are.
- **Speed** — the current plotting throughput, in MiB/s. This reflects your plotting device and the *memory escalation* / *parallel drives* settings from the wizard.
- **Progress bar** — completion of the current batch.
- **ETA** — Phoenix's estimate of when the *whole plan* will finish, not just the current task.

![The plotter card while plotting: task counter, speed, and ETA.](images/processed/ch16-plotter-plotting.png){width=55%}

### Stopping

You have asked the plotter to stop, but it is finishing its current unit of work first (see *Stopping plotting* below). The card shows the stop in progress; it transitions to *Ready* or *Complete* once the plotter has wound down.

### Complete

Every allocated drive is fully plotted and there is no outstanding work. The card simply reports how many drives are plotted. From here, mining takes over (Chapter 20); there is nothing more for the plotter to do until you allocate new space.

## Starting plotting

1. Open the **Mining Dashboard**.
2. Confirm the plotter card is in the **Ready** state and the plan summary matches what you expect (use the plan viewer if you want the detail).
3. Click **Start**.

Phoenix validates one thing before it begins: a **plotting address** must be configured. If it is missing or invalid, plotting does not start — instead Phoenix shows a *"Plotting address required"* dialog directing you back to the setup wizard (Chapter 15) to set a valid bech32 address. This guard exists because a plot file with no valid address embedded would be worthless: it could never pay a reward.

Once started, the card switches to the **Plotting** state and the first task begins. You can navigate away from the dashboard — plotting continues in the background — but leaving the dashboard open is the easiest way to watch progress.

> **Note** — On Android, and on desktop setups where the host might sleep, make sure the machine is configured to stay awake during plotting. A multi-hour plot does not survive the computer suspending itself. On Android specifically, Phoenix's foreground service and wake-lock handle this (Chapter 23); on desktop, check your OS power settings.

## How long plotting takes

Plotting time depends on three things: the amount of space allocated, the plotting device, and your memory/parallelism settings.

- **CPU plotting** of a single large HDD typically runs on the order of a day at full utilisation; older CPUs take proportionally longer.
- **GPU plotting** (Chapter 17) is commonly an order of magnitude faster, turning the same drive into a matter of a few hours.
- **Parallelism and memory** (the wizard's *drives in parallel* and *memory escalation* settings) raise total throughput up to the limits of your device and RAM.

The ETA in the plotter card is your best live estimate; it sharpens as the plotter measures actual throughput on your hardware.

> **Tip** — Plotting is a one-time cost per piece of capacity. It is worth getting the wizard's plotter settings right (a GPU if you have one, memory escalation pushed as high as your RAM allows, sensible parallelism) *before* you plot many terabytes — the difference between a well-tuned and a poorly tuned plotter compounds across every drive.

## Stopping plotting

Clicking **Stop** while plotting opens a dialog with two distinct ways to stop, plus cancel. The difference matters for how cleanly you can resume later.

![The stop-plotting dialog: Soft stop versus Hard stop.](images/processed/ch16-stop-dialog.png){width=50%}

### Soft stop

**Finishes the current batch, then pauses.** The plan is preserved. This is the efficient option: because the plotter completes whatever batch it is mid-way through before stopping, resuming later picks up cleanly at the next batch boundary with no wasted work.

Use soft stop for anything routine — you need the machine's resources for a while, you want to reboot, you are done for the day.

### Hard stop

**Stops as soon as the current item finishes, then clears and regenerates the plan.** Less efficient: any batch that was mid-flight becomes a partial `.tmp` file, and the plan is rebuilt from scratch (which is also how Phoenix re-detects those `.tmp` files for resuming). Use hard stop only when you need plotting to end promptly and you accept that the next start will be a little less efficient.

### Resuming

Either way, when you next click **Start**, Phoenix resumes from where it left off. Partially written files carry their own metadata (the seed and how many warps were completed), so the plotter targets the exact `.tmp` that needs finishing rather than starting it over. A soft-stopped plan resumes most efficiently; a hard-stopped one resumes file-by-file.

> **Note** — Unfinished `.tmp` files are normal and safe. They are not corruption; they are simply plots that have not reached full size yet. The plotter knows how to continue them, and the setup wizard's drive cards count them in the *Unfinished* total.

## When a drive finishes

As each drive's allocated space is fully plotted, the plan's **Add to miner** task hands that drive to the miner. From that moment:

- The drive's `.pocx` files are included in the next mining round.
- The drive transitions from a plotting role to a mining role — and, as Chapter 14 stressed, a drive is only ever in one role at a time.
- The dashboard's capacity figures update to include the newly available plots.

You do not have to do anything to "activate" a finished drive. Phoenix moves it from plotter to miner automatically as part of executing the plan.

When every allocated drive is finished, the plotter card reaches the **Complete** state and stays there until you allocate more space (by adding drives or increasing allocation in the wizard, Chapter 18).

## A typical first plotting session

Putting it together, the normal flow for a new miner:

1. Complete the setup wizard (Chapter 15) — chain, plotter device, plotting address, at least one drive with space allocated.
2. On the Mining Dashboard, confirm the plotter card shows **Ready** and the plan size looks right.
3. Click **Start**. Watch the speed and ETA settle over the first few minutes.
4. Let it run. Soft-stop if you need the machine; resume later.
5. As drives finish, they join the miner automatically — you can begin earning before *every* drive is done.
6. When the card shows **Complete**, plotting is finished and mining carries on alone.

## What's next

If you plot with a GPU — strongly recommended for any meaningful capacity — Chapter 17 covers the OpenCL driver requirements per platform, how Phoenix detects your GPU, and how to confirm it is actually being used. If you plotted on CPU and are happy, you can skip ahead to Chapter 18, which covers managing plots and drives over time: adding capacity, handling unfinished and orphaned files, and what to do when a drive changes.
