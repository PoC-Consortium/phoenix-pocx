# Troubleshooting

Most problems with Phoenix fall into a small number of categories, and most have a quick diagnosis once you know where to look. This chapter is organised by *symptom* — find the heading that matches what you are seeing, and work through the checks beneath it. Two general-purpose tools come up repeatedly, so they are covered first: the logs, and the data directories.

## Two tools you will keep coming back to

### Finding the logs

When something is wrong and the cause is not obvious, the logs usually have the answer. Phoenix keeps everything reachable from **Settings → Debug & Logs** (Chapter 12), so you do not need to hunt through the filesystem.

That tab gives you one-click access to:

- **App log** — Phoenix's own log. *Open folder* opens the directory; the most recent log file is inside. Start here for problems with the wallet interface, connections, or mining control.
- **Bitcoin Core log** — the node's `debug.log`. *Open* launches it directly. This is the authoritative place for node-side problems: sync failures, RPC errors, block validation issues.
- **Config files** — the node, mining, aggregator, and `bitcoin.conf` files, each with an *Open* button, when you need to inspect or compare what Phoenix has actually saved.

> **Tip** — When asking for help (Chapter 30), a recent slice of the relevant log is the single most useful thing you can provide. Take the **last few hundred lines**, not the whole file — logs grow large, and the recent tail almost always contains the error. Be aware that logs can contain your addresses; review before sharing publicly.

### The data directories

Phoenix and the node each keep their state in a data directory, and several recovery procedures involve them. There are two, and they are different:

- **Phoenix's application data directory** — contacts, settings, mining configuration, aggregator configuration, Phoenix's own logs. Reachable via **Settings → Debug & Logs → App Data Directory → Open folder**.
- **Bitcoin-PoCX Core's data directory** — the blockchain, the wallet database (your keys), the node's `debug.log`, and `bitcoin.conf`. In managed mode this is the directory Phoenix configured for the node; in external mode it is wherever you pointed your node.

The crucial distinction: **your keys live in the *node's* wallet database, not in Phoenix's data directory.** Wiping Phoenix's data directory loses settings and contacts but never your funds; wiping the node's data directory can destroy the wallet.

> **Warning** — Before deleting *anything* from the node's data directory, confirm you have your **24-word recovery phrase** written down and tested (Chapter 11). The node's wallet database holds your keys; if you remove it without your recovery phrase, your funds are unrecoverable.

## Wiping data directories cleanly

Sometimes the fix really is "start that part over." Here is how to do it safely.

### Resetting Phoenix's configuration (safe)

If Phoenix's settings, mining configuration, or contacts have become tangled, you can reset them without any risk to funds:

1. Note anything you want to keep (your contacts list, your mining settings).
2. Use **Settings → Danger Zone** (Chapter 12) for the targeted resets — *Reset mining configuration* or *Reset wallet* (which clears Phoenix-side bookkeeping, not node keys) — or, for a full reset, close Phoenix and clear its application data directory.
3. Restart Phoenix. It will behave like a fresh install: the setup wizard runs again, but your **node wallet and its keys are untouched**, so re-adding the wallet (Chapter 5) brings everything back.

Because plot files live on your drives — not in Phoenix's data directory — resetting Phoenix never touches your plots. You re-point the mining configuration at the same drives and the existing `.pocx` files are re-detected.

### Wiping the node's data (destructive — read first)

Wiping the node's data directory is sometimes necessary — a corrupted blockchain database that will not sync, for instance. But it can destroy the wallet, so treat it with care:

1. **Confirm your recovery phrase first.** Non-negotiable. If the wallet lives only in this node and you have no phrase, stop — there is no recovery after this.
2. Decide what you actually need to remove. A corrupt *chainstate* can often be repaired by re-syncing without deleting the wallet file; you rarely need to delete everything.
3. Stop the node (in managed mode, stop it from **Settings → Node Configuration**; in external mode, stop your node yourself).
4. Remove the appropriate files from the node's data directory. The blockchain data re-downloads on next start; the wallet database does **not** come back unless you restore it from your phrase.
5. Restart. The node re-syncs (this can take a while on mainnet), and you re-import your wallet from the recovery phrase if you removed it.

> **Note** — A full re-sync re-downloads and re-validates the chain, which on mainnet takes from a while to a few hours depending on your connection. It is the right fix for a genuinely corrupt chain database, but it is slow — try a restart and a normal resync before resorting to a wipe.

## Node and connection problems

### "Connection failed" on the Wallets screen

Phoenix cannot reach Bitcoin-PoCX Core. The screen offers **Retry**, **Settings**, and **Re-run node setup**. Check, in order:

- **Is the node running?** In managed mode, check **Settings → Node Configuration** — start it if it is stopped. In external mode, confirm your node is up.
- **Is the RPC reachable?** In external mode, use **Test connection** (Chapter 25) to pinpoint whether it is address, port, or credentials.
- **Did the node just start?** It may not have finished initialising. Wait a few seconds and **Retry**.

### "Node started but RPC not ready yet"

Seen briefly during first launch (Chapter 4). The node process started but its RPC interface is not yet answering. Usually it resolves within seconds — wait and retry. If it persists, the node may be failing to start properly: check the **Bitcoin Core log** for the actual error.

### The node will not sync (height not advancing)

- **Check peers.** The **Peers** screen (Chapter 6) shows connections. Zero peers means a networking problem — firewall, no internet, or the node cannot find the network.
- **Check the clock.** A badly wrong system clock can cause peers to reject your node. See *Clock problems* below.
- **Check disk space.** A full disk stops the node from writing new blocks. Free space and restart.
- **Check the log.** The **Bitcoin Core log** names most sync failures directly.

## Clock problems

Bitcoin-PoCX enforces a **15-second** timestamp tolerance — far tighter than Bitcoin's two hours (Chapters 3, 14, 20). A drifting clock is one of the most deceptive problems because the symptoms do not look like a clock problem:

- **As a miner:** everything looks healthy — the miner scans, finds deadlines, the dashboard fills — but you **never successfully forge**, because the blocks you produce are rejected by peers as too far in the future or past.
- **As a node:** valid incoming blocks may be rejected, stalling sync.

**The fix:** make sure your operating system's network time synchronisation (NTP) is enabled and actually working, and that no power-saving profile is suspending it. After correcting the clock, the symptoms clear immediately. If your miner looks perfect on the dashboard but has not forged over a long period, **suspect the clock first** — it is the most common cause of a healthy-looking miner that earns nothing.

## Mining problems

### The miner stopped, or stopped earning after a restart

The most common cause is the **locked-wallet-after-restart trap** (Chapters 5, 11, 20). If your signing wallet is encrypted and the rig restarted — a reboot, power blip, or Phoenix update — the wallet comes back **locked**, and a locked wallet cannot sign blocks. Auto-start brings the *miner* back, but mining silently stalls.

- **Quick fix:** unlock the wallet (toolbar wallet selector, Chapter 6). Mining resumes.
- **Permanent fix:** use the cold/hot key split via a forging assignment (Chapter 19), so the rig's signing wallet is an unencrypted forging-only wallet that needs no manual unlock — the recommended setup for any unattended miner.

Other causes of a stopped or non-earning miner:

- **Miner shows *Error*.** Read the message; common causes are a lost node connection, a misconfigured chain, or a locked wallet.
- **External node missing the key.** If you mine against an external node, its wallet must hold the signing key for your plots (Chapter 25). If it does not, deadlines are found but blocks cannot be signed.
- **Clock drift.** As above — looks healthy, never forges.

### Effective capacity is lower than my physical plot size

Expected to some degree — effective capacity is a statistical estimate (Chapter 20). A *persistent, significant* gap has a few usual causes:

- **Plots a PoW scaling level behind the network.** This is the classic one: when the network steps up a scaling level (Xn), plots made at the old level contribute at **half** their size — two levels behind, a quarter, and so on. Check the **PoW scale** column in the Active Chains table (Chapter 20) against the level your plots were made at. The fix is to **upgrade the plots** by re-plotting at the new level (Chapter 18); the *on-the-fly compression* option keeps you mining in the meantime, at the reduced effective size.
- **I/O bottleneck.** If your plots cannot all be read within the block interval, the un-read portion sits out. Target a full scan under 40 seconds (under 20 for high effectiveness); if scans run longer, your I/O is the limit (Chapters 14, 22).
- **A drive went unavailable.** Check the drives panel (Chapter 20) — an unplugged or failed drive removes its capacity.

### Effective capacity dropped suddenly

Either a drive went offline (check the drives panel), or the network just stepped up a scaling level and your plots are now one level behind (check the PoW scale column).

### Plotting is extremely slow

- **Plotting onto an SMR drive.** The classic cause (Chapter 14). SMR drives collapse under sustained writes. Stop plotting directly to SMR — stage on a CMR drive and move the finished file to the SMR drive instead.
- **Plotter not tuned.** Memory escalation too low, parallelism too low, or plotting on the CPU when a GPU is available (Chapters 15, 22). Benchmark your devices and raise memory escalation.
- **No GPU acceleration.** If a GPU you expected to use is not being used, see *GPU not detected* below.

### Plotting will not start, or is blocked

- **"Plotting address required."** No valid plotting address is configured. Set one in the setup wizard (Chapter 15).
- **Orphan files blocking the plan.** Plan generation is blocked by incompatible `.tmp` files (Chapter 18). Resolve them in the orphan dialog — delete the partial files, or restore the matching plotting address / scaling level. An unresolved orphan blocks *all* plan generation, not just its own drive.

### GPU not detected

Covered in detail in Chapter 17. In short: update the GPU's driver (the most common fix), confirm the GPU is OpenCL-capable, check switchable-graphics power profiles, ensure the Linux OpenCL ICD is installed, and confirm the GPU has at least **3 GiB** of free VRAM — below that the plotter cannot use it.

## Transaction problems

### A send failed

Phoenix shows the error in a red banner (Chapter 8). Common cases: insufficient balance, invalid or wrong-network address, a fee below the minimum, or a locked wallet. A failed send consumes nothing — fix the cause and try again.

### A sent transaction is stuck unconfirmed

- **If it was sent with RBF enabled**, bump its fee (Chapter 9) to move it along.
- **If it was sent without RBF and is stuck**, your options are to wait for it to be evicted from mempools, or — once the *abandon transaction* feature ships (Chapter 9) — to abandon it and free its inputs. Until then, a non-RBF stuck transaction generally has to wait out the mempool.

### A payment I was expecting has not arrived

- Confirm with the sender that they actually broadcast it, and ask for the **transaction ID**.
- Look the txid up on a block explorer. If it is in the mempool with a low fee, it is waiting to confirm. If the explorer has never seen it, it was not broadcast, or the address was wrong.
- Confirm you gave the sender the correct address and the correct **network** (a mainnet payment to a testnet address, or vice versa, will not appear).

## When all else fails

If a problem resists every check here:

1. **Read the relevant log** (Bitcoin Core log for node/mining/sync issues, App log for interface/connection issues) — the actual error is usually named there.
2. **Restart cleanly** — stop the miner and aggregator, stop the node, restart Phoenix. A surprising number of transient problems clear with a clean restart.
3. **Ask for help** with specifics — what you did, what you expected, what happened, and a recent log slice (Chapter 30). "It doesn't work" is hard to help; a log excerpt and a clear sequence of steps is easy.

## What's next

The next chapter — **Frequently Asked Questions** — collects the short, common questions that do not need a full chapter to answer. After that, the glossary defines every term used in this handbook, and the final chapter points you to the project's community and support channels.
