# Managing Your Plots & Drives

Plotting is rarely a one-and-done event. You add drives as your farm grows, retire drives that fail, and occasionally move plot files between machines. This chapter covers life after the first plot: reading the drive cards in their steady state, understanding the three states a plot file can be in, resolving the *orphan* files that block plotting, importing externally-generated plots, and adding or removing drives cleanly.

Everything here happens in the **drives** view — step 3 of the setup wizard (Chapter 15), which doubles as your ongoing drive-management screen. Re-open the wizard any time to reach it.

## The three states of a plot file

Every file on a configured plot drive is in one of three states. Phoenix shows them on each drive card's segment bar and in the summary totals.

| State          | On disk        | Meaning                                                                                      |
|----------------|----------------|----------------------------------------------------------------------------------------------|
| **Complete**   | `.pocx`        | A finished plot file, full size, ready for mining. This is what every plot becomes eventually. |
| **Unfinished** | `.tmp`         | A partial plot the plotter can **resume**. Carries its seed and how many warps are done. Normal after a stop or interruption. |
| **Orphan**     | `.tmp`         | A partial plot the plotter **cannot resume under the current configuration**. Blocks plan generation until resolved. |

Complete and unfinished files are the happy path — Chapter 16 covered how unfinished files get resumed automatically. The state that needs your attention is the orphan.

## Orphan files: what they are and why they happen

An orphan is a `.tmp` file that was started under one configuration and no longer matches the configuration Phoenix is set to plot with now. Because a half-finished plot is locked to the settings it was begun with, Phoenix cannot safely continue it under different settings — so it sets the file aside as an orphan and refuses to generate a plot plan until you decide what to do with it.

There are three reasons a file becomes an orphan.

| Reason                  | What changed                                                                                  |
|-------------------------|-----------------------------------------------------------------------------------------------|
| **Address mismatch**    | The `.tmp` was started with a different *plotting address* than the one currently configured. |
| **Compression / scaling mismatch** | The `.tmp` was started at a different *PoW scaling level* (Xn) than the current setting. |
| **Duplicate seed**      | Two `.tmp` files share the same seed — only one can be resumed, so the other is an orphan.     |

The first two are the common ones, and they almost always mean you changed something in the wizard between plotting sessions: you edited the plotting address, or you changed the PoW scaling level. The half-finished file from before the change cannot be reconciled with the new setting.

## Resolving orphans

When plan generation is blocked by orphans, Phoenix surfaces an **orphan resolution dialog** listing every offending file, its drive, its size, and the specific mismatch (with the file's embedded value next to your current configured value).

![The orphan resolution dialog for incompatible .tmp files.](images/processed/ch18-orphan-dialog.png){width=70%}

You have two ways to resolve each orphan, and the dialog explains both:

- **Delete the orphan.** The `.tmp` is incomplete and represents no finished work — deleting it loses only the partial plotting time already spent on it, not any usable plot. This is the right choice when the configuration change was deliberate (you *meant* to switch address or scaling level) and you simply want to plot fresh under the new settings.
- **Restore the matching configuration.** If the orphan exists because you changed a setting by accident, put the setting back. Restore the plotting address and PoW scaling level in the wizard's advanced options to match the value embedded in the `.tmp` (the dialog shows you that value), and the file stops being an orphan — it becomes a normal resumable unfinished file again.

Once every orphan is resolved — deleted or reconciled — the dialog confirms *"All orphan files resolved"* and plotting can proceed.

> **Warning** — Deleting an orphan is safe (it is only ever a partial file), but deleting a **complete `.pocx`** is not — that destroys finished plotting work and the capacity it represents. The orphan dialog only ever offers to delete `.tmp` files; never manually delete `.pocx` files from a plot folder unless you intend to give up that capacity.

## Adding capacity over time

Growing your farm is just re-running the drives step.

### More space on an existing drive

If a drive has free space you did not originally allocate — you under-allocated, or you freed up other data — re-open the wizard, find the drive's card, and push the *To plot* allocation slider further right. Saving regenerates the plan to include the new space, and the next plotting run fills it.

### A new drive

1. Connect the drive and make sure the OS sees it.
2. Re-open the setup wizard and go to the drives step.
3. Click **Add folders** and select the plot folder on the new drive.
4. Allocate its space with the slider (push it to the maximum for any non-system drive).
5. Save. The plan now includes the new drive; start plotting from the dashboard.

Existing plotted drives are untouched — they keep mining while the new drive plots.

### The same-drive guard

Phoenix maps one plot folder to one physical drive. If you try to add a second folder that lives on a drive you have already configured, Phoenix refuses with a *"this drive already has a plot folder configured"* warning. Two folders on one spindle would compete for the same head and cripple both plotting and mining throughput, so the restriction is deliberate. One folder per drive, always.

## Importing plot files made elsewhere

Plot files are not unique to Phoenix — any Bitcoin-PoCX-compatible plotter produces the same `.pocx` format. You may have plots made by the framework's command-line **v1 plotter** (the low-VRAM workaround from Chapter 17), or plots moved from another machine (Chapter 11).

To bring existing plot files into a Phoenix rig:

1. Place the `.pocx` files in a folder on the destination drive.
2. Add that folder as a drive in the wizard (or, if the drive is already configured, use the card's **refresh** button).
3. Phoenix scans the folder, recognises the complete `.pocx` files, and counts them in the *Plotted* total.

For the imported plots to actually earn, the usual rule applies: the wallet that signs blocks must control the plots' embedded plotting address, or a forging assignment must delegate that authority (Chapters 11 and 19). Importing the files is the easy part; arranging the signing path is what makes them productive.

> **Note** — Imported complete plots need no plotting work — they go straight to the *Plotted* state and join mining on the next round. Imported *unfinished* `.tmp` files, however, are subject to the same orphan checks as locally made ones: if they were plotted to a different address or scaling level than your current configuration, they will show up as orphans to be resolved.

## Removing and replacing drives

### Removing a drive cleanly

To stop using a drive — you are repurposing it, or it is failing — open the wizard's drives step and click the **remove** (the cross/close button) on its card. This removes the drive from Phoenix's configuration; it does not delete the files on the drive. If you re-add the drive later, Phoenix re-detects the existing plots.

### A drive that has gone unavailable

If a configured drive disappears — a USB drive unplugged, an enclosure powered off, a drive that has failed — Phoenix still shows it on the drives step, marked **unavailable**, so you can see what is configured but missing. The card shows the configured size and offers **refresh** (to re-check whether it has come back) and **remove** (to drop it from the configuration).

This is expected behaviour for external drives that are not always connected. Reconnect the drive and refresh, and it returns to normal; or remove it if it is gone for good.

> **Tip** — Recall from Chapter 11 that a failing drive is not an emergency. A drive throwing read errors still mines at reduced effective capacity; a drive that has fully died is a re-plot, not a recovery event. When SMART warnings (Chapter 14) tell you a drive is on its way out, plan its replacement on your own schedule — remove it from the configuration when you pull it, add the replacement, and plot the new drive.

### Replacing a failed drive

1. Remove the dead drive's card from the wizard (its plots are gone with the drive — that is expected).
2. Physically replace the drive.
3. Add the new drive's folder, allocate its space, and plot it.

There is no "restore" step because there is nothing to restore — plots are regenerated, not recovered. The only thing that carries forward is your plotting address, which stays the same across the whole farm.

## Keeping a growing farm tidy

A few habits that pay off as a farm scales past a handful of drives:

- **One folder per drive, named consistently.** A predictable folder name (for example, a top-level `plots` folder on every drive) makes the wizard's drive list easy to read.
- **Allocate to the maximum on non-system drives.** Leaving free space on a plot drive is leaving mining power on the table (Chapter 14).
- **Resolve orphans promptly.** An unresolved orphan blocks *all* plan generation, not just the affected drive. If you change your plotting address or scaling level, expect orphans from any in-flight `.tmp` files and clear them before the next plotting run.
- **Watch the system-drive cap.** If you plot the OS drive at all, keep its allocation under the cap (Chapter 15) so the host always has working room.
- **Track drive health, not backups.** SMART monitoring and cooling (Chapter 14) are how you protect a plot farm — never RAID, never plot backups.

## What's next

Your plots exist and are managed. They are also, so far, signing blocks with your own wallet's keys. The next chapter — **Forging Assignments** — covers the on-chain mechanism for delegating that signing authority: pointing your plots at a pool, splitting cold and hot keys, and the chicken-and-egg problem of needing a small amount of BTCX to publish your first assignment.
