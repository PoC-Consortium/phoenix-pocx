# Frequently Asked Questions

Short answers to the questions that come up most often. Each points to the chapter with the full story.

## Getting started

**What is Bitcoin-PoCX, in one sentence?**
A fork of Bitcoin that replaces proof-of-work mining with *proof-of-capacity* — you commit disk space instead of computing power. See Chapter 2.

**Is Phoenix a wallet or a miner?**
Both, in one application. You can use it purely as a wallet, purely as a miner, or both at once. The wallet half is Parts I–II; mining is Part III. See Chapter 2.

**Do I need to understand the technical details to use it?**
No. To use the wallet, you need none of it. To mine, the working model in Chapters 13–14 is enough; the deep mechanics are optional background.

**Does Phoenix store my coins or my keys?**
No. Your keys live inside Bitcoin-PoCX Core, the node program Phoenix drives. Phoenix is the interface; it generates your recovery phrase, hands it to Core, and forgets it. See Chapter 6.

**Which platforms are supported?**
Windows, macOS, and Linux as full wallets-plus-miners; Android as a full wallet *and* miner that runs without a local node (it syncs over Electrum servers). Android cannot solo-mine, but it holds its own wallets and can pool-mine into them. See Chapters 3 and 23.

**Do I need to run a node?**
No. Choose **remote mode** at first launch and Phoenix keeps a wallet on your computer and syncs over Electrum servers — no blockchain download, nothing to maintain. Run a node (managed or external) if you want the strongest trust model or intend to *solo* mine. See Chapters 4 and 26.

**What is remote (Electrum) mode?**
A node mode where Phoenix runs no local Bitcoin-PoCX Core. Your keys and wallet live on your computer and every transaction is signed locally; the wallet reaches the network through Electrum servers. A server can inconvenience you (stall a broadcast, report stale data) but cannot steal — the chain is verified and the keys never leave your machine. Solo mining, the block explorer, and the peers page are unavailable in remote mode. See Chapter 26.

**Can I use Phoenix on my phone as a real wallet now?**
Yes. The Android app is a full wallet — create or restore wallets, send, receive, keep history and contacts — and it can mine your storage straight into a wallet it holds, with nothing to copy from another machine. See Chapter 23.

## Wallet and funds

**What is BTCX?**
The native currency unit of Bitcoin-PoCX. One BTCX divides into 100,000,000 satoshis, exactly like Bitcoin. See Chapter 2.

**How long do transactions take to confirm?**
A block is produced about every 120 seconds, so a transaction typically gets its first confirmation within a couple of minutes once it is in the mempool. See Chapter 9.

**Why does my balance show some funds as unconfirmed?**
Incoming funds are spendable only after they reach the confirmation threshold (currently six confirmations). Until then they show as unconfirmed. See Chapters 7 and 9.

**Can I reverse a transaction I sent by mistake?**
No. Confirmed Bitcoin-PoCX transactions are irreversible. Always verify the recipient address and amount before confirming. See Chapter 8.

**My transaction is stuck. What can I do?**
If you sent it with Replace-By-Fee enabled, bump its fee (Chapter 9). If not, you generally wait for it to clear or be evicted from mempools. See Chapters 8 and 9.

**Can I have more than one wallet?**
Yes. Phoenix supports multiple wallets; switch between them from the toolbar (desktop) or the header switcher (Android). You can name, rename, and delete them; deletion is safe — the files move to a trash folder and the recovery phrase always restores the funds. See Chapters 5 and 23.

**A block explorer shows a different balance (or an address I don't recognise). Why?**
Almost always *change addresses*. When you spend, the leftover comes back to a fresh address your wallet owns but you never see — so any single address on an explorer shows only part of the story. Your wallet's total is the sum across all its addresses, which Phoenix tracks for you; trust the wallet's balance, not one address on an explorer. See Chapters 8 and 9.

**Why does restore find addresses I didn't expect?**
A recovery phrase can hold funds on several *derivation branches* — different address types and coin types. Phoenix restore scans them all and imports every branch that holds coins, then shows a short branch report of what it found, so nothing stays hidden. You do not choose or configure anything. See Chapter 5.

**What is the BTCX coin type, and do I need to do anything about it?**
Bitcoin-PoCX has its own registered coin type (SLIP-44 `1347371864`); new wallets use it automatically, and restore still finds funds derived under the older Bitcoin coin type. It is invisible in normal use — there is nothing for you to set. See Chapter 5.

**Can I import a wallet from a descriptor or a single private key?**
In the nodeless (remote) wallet and on Android, yes — paste one or two output *descriptors*, or wrap a single WIF key as `wpkh(WIF)` to import it as a one-address wallet (handy for a vanity or plotting address). See Chapters 23 and 26.

**Can I create a shared wallet that needs several people to approve a spend?**
Yes — a *multisig* wallet. Click **Multisig** on the Wallets screen and pick an *M-of-N* policy such as 2-of-3. Every participant runs the same wizard with the same set of public keys. See Chapter 5.

**Why is Send greyed out on my wallet?**
Because that wallet cannot produce a complete signature on its own — it is either *watch-only* or *multisig*. Spend it through the **Transaction Builder** instead, which builds a PSBT that is signed (and, for multisig, co-signed) before broadcast. See Chapters 5 and 8.

## Security and backup

**What is the most important thing to protect?**
Your 24-word recovery phrase. It is the only way to restore your wallet, and anyone who has it can take your funds. Write it down offline and test a restore. See Chapter 11.

**If my computer dies, are my funds gone?**
Not if you have your recovery phrase. Install Phoenix on a new machine, import the phrase, and your wallet — keys, balance, history — is restored. See Chapter 11.

**Should I encrypt my wallet?**
For an everyday wallet, yes — it protects against local theft. For a *mining* wallet, encryption means mining stalls after every restart until you unlock it; use the cold/hot key split instead. See Chapters 5, 11, and 19.

**Will anyone from the project ever ask for my recovery phrase?**
Never. No legitimate person or service will. Anyone who asks is trying to steal from you. See Chapters 1 and 11.

**Is my wallet backed up to the cloud on Android?**
No — and this is deliberate. Android's automatic app-data backup is disabled for Phoenix specifically so your seed can never reach Google Drive. The 24-word phrase, written on paper, is the only backup. Set a device passphrase to protect the seed stored on the phone, and treat the phone wallet as a hot wallet — spending money, not a vault. See Chapter 23.

**Do my contacts and settings get backed up by my recovery phrase?**
No. The phrase restores *funds* only. Contacts, settings, and mining configuration live in Phoenix's data directory and are not derived from the phrase. See Chapters 10 and 11.

## Mining basics

**Do I need to buy or stake coins to mine?**
No. Bitcoin-PoCX is proof-of-capacity, not proof-of-stake. You commit disk space, not a coin balance. The one exception is the tiny fee to publish a forging assignment for pool mining — and pools usually provide a faucet for that. See Chapters 13 and 19.

**How much can I earn?**
Your share of blocks roughly equals your share of the network's total plotted capacity, over a long enough period. Small miners see bursty results and usually pool to smooth income. See Chapters 13 and 20.

**Why have I not forged a block yet?**
Bursty results are normal for single-resource mining — small miners can wait a long time between solo blocks. As long as the dashboard shows scanning, advancing chain heights, and a filling deadline history, the miner is working. See Chapter 20.

**What is plotting, and how long does it take?**
Plotting is the one-time process of filling disk space with precomputed data. CPU plotting runs on the order of a day per large drive; a GPU is roughly ten times faster. See Chapters 13, 16, and 17.

**Does mining use a lot of electricity?**
No. Forging only reads small slices of disk every couple of minutes; the rig is idle the rest of the time. Plotting is the only heavy phase, and it is one-time. See Chapters 2 and 13.

**Solo or pool — which should I choose?**
Solo gives full block rewards but rare, bursty wins. Pool gives frequent small payouts. Small miners usually pool. See Chapters 13 and 19.

## Hardware

**What kind of drives should I use?**
CMR hard drives for plot storage — cheapest per terabyte and ideal for mining's sequential reads. Fill every drive except the system drive. See Chapter 14.

**Can I use SMR drives?**
For *mining*, yes — mining only reads, and SMR reads fine. For *plotting*, no — sustained writes collapse on SMR. The workaround: plot on a CMR drive, then move the finished file to the SMR drive. See Chapter 14.

**Can I use old or failing drives?**
Yes — this is a strength of proof-of-capacity. A drive with bad sectors still mines at reduced capacity (5% bad sectors means roughly 95% capacity), and end-of-life drives that are unfit for real data make perfectly good mining drives. See Chapters 11 and 14.

**Do I need a powerful GPU?**
Only for faster *plotting*, and only during plotting — mining is CPU-only and light. A GPU needs at least 3 GiB of free VRAM and up-to-date OpenCL drivers. See Chapters 14 and 17.

**Should I use RAID?**
No. Never RAID plot storage — use JBOD. Striping gains nothing, mirroring halves your capacity for regenerable work, and parity wastes capacity and slows plotting. See Chapter 14.

**Should I back up my plot files?**
No. Plot files are disposable by design — if a drive fails, you re-plot. Don't back them up and don't mirror them; protect drives with SMART monitoring and cooling instead. See Chapters 11 and 14.

## Pools and forging assignments

**What is a forging assignment?**
An on-chain delegation that lets another address (a pool, or your own hot wallet) sign blocks for your plots without owning them. It is how pool mining and cold/hot key splits work. See Chapter 19.

**I want to pool-mine but have no BTCX for the assignment fee. What now?**
Most pools run an integrated faucet that dispenses a tiny amount of BTCX to cover exactly this. Check your pool's information page. See Chapter 19.

**How long does an assignment take to activate?**
About 30 blocks (~1 hour). Revoking one takes longer — about 720 blocks (~1 day), during which the old forging address keeps signing. See Chapter 19.

**Can a pool steal my funds through an assignment?**
No. An assignment delegates *forging only* — the right to sign blocks. It cannot move your plots or spend your other funds, and you can revoke it. That is what makes pool mining non-custodial. See Chapter 19.

## Operations

**My miner looks healthy but never forges. Why?**
The most common cause is a drifting system clock — Bitcoin-PoCX rejects blocks more than 15 seconds off, so your blocks get rejected even though everything looks fine. Enable NTP. See Chapters 20 and 27.

**Mining stopped after my computer restarted.**
If your signing wallet is encrypted, it came back locked and cannot sign until unlocked. Unlock it, or set up the cold/hot key split so the mining wallet needs no unlock. See Chapters 19, 20, and 27.

**My effective capacity is much lower than my plotted terabytes.**
Usually one of: plots a PoW scaling level behind the network (each level halves effective size — upgrade them), an I/O bottleneck (scans taking too long), or a drive that went offline. See Chapters 18, 20, and 22.

**Can one computer run my whole farm?**
Up to the point where its drive slots and I/O saturate. Beyond that, add machines and coordinate them with the aggregator. See Chapters 14 and 24.

**Where are the logs if I need to diagnose something?**
Settings → Debug & Logs has one-click access to Phoenix's log and the node's log. See Chapters 12 and 27.

**Is the network live? Does BTCX have value?**
Refer to the official project channels (Chapter 30) for the current network status and any market information — it changes over time and is not something this handbook can state authoritatively.

## What's next

The next chapter is the **Glossary** — every term used in this handbook, defined in one place. The final chapter points you to the project's community and support channels.
