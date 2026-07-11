# Backup, Security & Recovery

This chapter is the most important one in this part of the handbook. Bitcoin-PoCX puts every piece of financial security in your hands: there is no support line that can recover lost keys, no fraud-reversal mechanism, no "forgot password" link that ends with you back in your wallet. The compensating benefit is that no third party can freeze your funds or seize them either — but the compensation only works if you have done the preparation described here.

Most of what follows is short and practical. Read it once before you have anything serious in the wallet, do the steps it asks for, and then forget about it until the day you need it.

## What you are protecting against

A useful mental model: walk through each of these scenarios and confirm you have an answer.

- **Your computer or phone dies** — hard drive failure, fried board, lost device.
- **Your computer or phone is stolen** — and unlocked.
- **A house fire or flood** destroys everything you keep at home.
- **You forget the wallet password** you set during creation.
- **Malware infects your computer** — clipboard hijacker, keylogger, ransomware.
- **A family member needs to access your funds** when you are not around.

If your honest answer to any of these is *"I don't know what would happen,"* this chapter is for you.

## The single source of truth: your 24-word recovery phrase

Your **24-word recovery phrase** (generated in Chapter 5, also known as a BIP39 mnemonic) is the master key from which every private key in your wallet is derived. Anyone who has the phrase can recreate the wallet on any computer, on any Bitcoin-PoCX-compatible software, and move the funds. You cannot — *cannot* — recover it if you lose it. There is no second copy on a server somewhere.

This shapes everything about how it should be stored.

### Three rules

1. **Offline.** Never store the phrase on any device that ever touches the internet. Not in cloud notes, not in a password manager that syncs to the cloud, not in e-mail to yourself, not in a screenshot, not in a `.txt` file, not in a chat. Cloud services get breached; password managers get phished; phones get sold without proper wiping.
2. **Durable.** Paper is acceptable but flammable, fadeable, and easy to lose. Metal backup plates — stamped or engraved — survive fire, water, and time. Several open-source plate designs exist for around the cost of a few hours of GPU plotting; spend the money once.
3. **Never typed into anything except a Phoenix recovery prompt.** A fake Phoenix website asking you to "re-verify your phrase" is the most common scam in the Bitcoin ecosystem. Real Phoenix asks for the phrase exactly once — when you import a wallet — and never again. If anything else asks, walk away.

### Storage approaches, ranked

| Approach                                            | Verdict                                                                                  |
|-----------------------------------------------------|------------------------------------------------------------------------------------------|
| Metal plate, kept somewhere safe (+ optional second copy off-site) | **Recommended.** Survives fire, water, decades.                                |
| Paper in a fire-resistant safe                      | Acceptable for small amounts. Keep two copies in two locations.                          |
| Split among multiple sealed envelopes in different locations | Reasonable; reduces single-point loss. Decide a clear recombination procedure now. |
| Memorised, no physical copy                         | Discouraged. Memory is unreliable over years; sudden illness ends access.                |
| Anywhere on a connected device                      | **Unacceptable.** This is the failure mode behind the largest cryptocurrency thefts on record. |

> **Warning** — Do not split the phrase across services that *individually* see usable parts. Splitting the words 8/8/8 across three locations is fine because no location alone is useful. Splitting them 23+1 across two locations is fine *(one missing word is brute-forceable but slow without context)*. But never store any subset in a cloud service alongside hints about which words they are or which wallet they belong to.

## The BIP39 passphrase — the optional 25th word

Chapter 5 introduced this as an opt-in extra: a passphrase that combines with the 24 words to produce a different wallet. It is *not* the same thing as the wallet encryption password.

- If you use a BIP39 passphrase, store it **separately from the phrase itself** — same medium, different location. A passphrase next to the phrase defeats the purpose: anyone who finds the metal plate also finds the passphrase.
- If you lose the passphrase, your funds are unrecoverable even with the 24 words. Test your restore *with the passphrase included* before relying on it (see the section below).
- A BIP39 passphrase makes plausible deniability possible: the 24 words by themselves open an empty wallet, which is what someone coercing you into a restore can be shown.

Most users should not enable this until they are comfortable with the basic recovery process. The extra security comes at the cost of an additional unrecoverable secret to manage.

## Wallet encryption — what it protects, what it does not

Phoenix's wallet encryption (also from Chapter 5) is a *password on the spending keys*, enforced by Bitcoin-PoCX Core, not Phoenix. Its job is to defend against local attackers who get hold of an unlocked machine.

| Wallet encryption defends against…                | Wallet encryption does **not** defend against…                                              |
|----------------------------------------------------|---------------------------------------------------------------------------------------------|
| Someone walking up to your unattended logged-in computer and clicking *Send*. | Loss of the recovery phrase or the device itself.                                          |
| A casual thief who powers on your laptop and opens Phoenix.                  | An attacker who already has your recovery phrase.                                           |
| Light-touch malware that watches the wallet but cannot supply the password.  | Malware that captures your keystrokes or memory while you unlock to sign a transaction.    |

The recovery phrase is the ultimate backup. The wallet password is a *use-time* lock. Forgetting the wallet password does not lose your funds — you can wipe Phoenix and re-import from the phrase. Losing the phrase does.

### The mining caveat

If this wallet holds keys that the miner uses to sign blocks, **wallet encryption forces a manual unlock after every restart of Phoenix** (Windows update, power blip, scheduled reboot — same as Chapter 5 warned about). Mining will not resume until a human types the password. The standard solution is the cold/hot split described in Chapter 19: keep the encrypted *owner* wallet offline where it just collects rewards, and assign forging rights to a separate, unencrypted *forging* wallet on the rig. Re-read the relevant section of Chapter 5 if this trade-off matters to you.

## What a seed restore brings back

When you reinstall Phoenix on a fresh machine, run through the setup wizards, and choose **Import** with your 24-word phrase (and BIP39 passphrase, if you used one), Bitcoin-PoCX Core derives every private key the wallet ever produced and re-scans the chain. After the rescan completes, you will see:

- Every **address** the wallet has ever used or could use.
- Every **balance** that belongs to those addresses.
- Every **incoming and outgoing transaction**, with correct amounts and confirmations.

This is, mechanically, a complete restoration of your *funds*. The wallet on the new machine spends the same way the old one did.

## What a seed restore does **not** bring back

The phrase derives keys, nothing else. Several pieces of data live elsewhere:

| Data                                  | Where it lives                                              | Effect of a phrase-only restore        |
|---------------------------------------|-------------------------------------------------------------|----------------------------------------|
| **Address labels & transaction labels** | Bitcoin-PoCX Core's wallet database, separate from keys      | Lost. You will see addresses by their hex form. |
| **Contacts**                          | Phoenix's local application storage on the previous machine | Lost. Empty contact list on the new install. |
| **Settings & preferences**            | Phoenix's settings file                                     | Lost. Theme, language, fee defaults reset. |
| **Mining configuration**              | Phoenix's mining config file                                | Lost. Re-run the mining setup wizard.   |
| **Plot files**                        | The drives you plotted onto                                 | Lost — but plot files are *designed* to be regenerated, not restored. *See below.* |
| **Aggregator config & accumulated stats** | Phoenix's aggregator state                              | Lost. Reconfigure and accept new stats. |
| **Wallet password (encryption)**      | Bitcoin-PoCX Core's wallet file                              | The new wallet starts un-encrypted unless you set it again during restore. |

None of these are catastrophic on their own. They are inconveniences, not financial losses. But planning for them in advance turns the worst day of your wallet's life into a routine reinstall.

## Backing up the rest

Two categories matter beyond the recovery phrase.

### Phoenix's application data

A periodic copy of Phoenix's data directory — onto an external drive, an encrypted USB key, or your normal computer backups — captures contacts, settings, and mining configuration in one go. The exact directory location depends on your operating system, but you do not need to know it: **Settings → Debug & Logs → App Data Directory → Open folder** opens it directly in your file manager. Chapter 27 explains the two data directories and what each subdirectory contains.

> **Note** — Backing up the application data directory is *helpful*, not *essential*. The recovery phrase alone is sufficient to recover funds. Everything else is convenience and is reconstructable in an hour or two. Do this if losing a long contact list would annoy you; do not lose sleep if you do not.

### Plot files

Plot files are intentionally **disposable** in Bitcoin-PoCX's design — and the design implies how they should be handled.

- **Do not back them up.** Plot files are large (terabytes), expensive to copy at backup speed, and trivially regenerable. Spending a backup pipeline on plot files is wasted disk and wasted time. If a plot drive dies, you re-plot what was on it. That cost is part of running a miner; it is not a disaster.
- **Do not mirror them with RAID.** RAID-1 halves your effective plot capacity, and capacity *is* your mining edge. Spending a second drive on duplication of work the protocol is happy to have you regenerate is a poor trade.
- **Fill drives as much as you can.** Every byte of plot is mining power. The only exception is the system drive, which needs working room for the operating system, swap, logs, and updates. Phoenix's mining setup wizard (Chapter 15) lets you cap the system drive's plot allocation specifically for this reason; on every other drive, plot to the limit.
- **Treat drives well — that is your protection, not backups.** A 24/7 mining drive will outlive a poorly cooled or unmonitored one by a wide margin. Run a SMART-monitoring tool, watch the reallocated-sector and pending-sector counters, and plan a cooling concept: adequate airflow for HDDs, conservative ambient temperatures for NVMe, sensible enclosure spacing. The economics of mining favour drives that last; an extra year of life is an extra year of revenue from work you have already paid for.

> **Note** — A failing drive is not an emergency, and *partial* failure is barely an event. Bitcoin-PoCX mining is **graceful** about read errors in a way that primary storage is not: a drive with five percent unreadable sectors keeps mining at roughly 95% of its previous capacity, because the protocol only "loses" the part of the plot it cannot read on a given block. The reallocated-sector and pending-sector counters that would alarm a database administrator are mostly slow capacity erosion to a miner, not a fault line. Replace failing drives on a schedule that suits you; the protocol does not force the issue.

> **Tip — this is the green angle.** Because mining tolerates partial failure so gracefully, Bitcoin-PoCX is an unusually good home for drives that have aged out of primary storage: former server drives, workstation drives whose SMART is creeping up, warranty replacements that were not actually faulty, second-hand drives that nobody else trusts with real data. A drive that would be recycled or landfilled by an organisation that depends on every byte being correct can still produce a meaningful share of mining revenue. Keeping such drives in service — rather than melting them down — is one practical reason proof-of-capacity has a smaller environmental footprint than proof-of-work, on top of the obvious electricity savings.

### Moving plot files between machines

Plot files can be moved (or copied, for a brief overlap) between machines without re-plotting. The mechanical step is just transferring the `.pocx` files to the destination drive and adding that drive to Phoenix's mining configuration on the new machine (Chapter 18); the existing plots are detected and joined to the next mining round.

The non-mechanical part is making sure the *rewards* still reach you. A plot file embeds a *plotting address*; for any block you forge, the protocol expects a signature from the key that controls that address — or from the key for the *delegated* forging address, if a forging assignment is active (Chapter 19). The miner on the new machine therefore needs a path for its solutions to reach a wallet that holds the relevant signing key.

There are several legitimate ways to wire that up — restoring the same wallet on the new machine, running a Phoenix aggregator on one machine that signs for the others, or routing through a pool. Each one shapes the rest of the setup differently. Chapter 13 walks through the options as part of the proof-of-capacity primer; Chapters 15, 19, 20, and 24 cover the actual configuration steps.

> **Warning** — Whichever routing you pick, finish setting up the solution-to-signing-wallet path before you start mining. If you send solutions to a wallet, node, or pool that does not hold the signing key for the plot's effective forging address, it cannot sign the block — your miner sees the submission rejected with a missing-key error and the would-be block is never produced. You do not forge to the wrong address; you simply do not forge at all.

## Test your restore before you need it

The single biggest mistake in cryptocurrency self-custody is "I wrote it down, that's fine" without ever proving the written copy works. A backup that has never been tested is, statistically, more likely to be unreadable than usable when you need it.

Here is the practical recipe — set aside a quiet hour.

1. **Send a small test amount** to a fresh address from your real wallet — enough to verify but small enough not to matter if you fumble.
2. **Note your wallet's first receive address** (Chapter 7) so you can confirm later that the restored wallet derives the same address.
3. **On a different machine** (or after wiping Phoenix on this one — only do this if you are confident), install Phoenix, complete the setup, and choose **Import** with your written 24 words (and BIP39 passphrase, if used).
4. **Wait for the rescan** to complete. Verify that the test amount and the first receive address both appear.
5. **Spend the test amount** back to your real wallet. This proves the restored wallet can actually sign and broadcast — not just display.

A passing test moves your recovery phrase from "I think it works" to "I know it works." Repeat the test annually if your phrase is meant to last decades.

## If you suspect a compromise

A few cases worth knowing how to respond to.

- **You typed the phrase into a website, or into anything other than Phoenix's import screen.** Treat the wallet as compromised. Move every coin to a new wallet (new phrase, new device) immediately. Mining rewards still flowing to addresses derived from the old phrase need to be redirected — re-plot, or use a forging assignment from the old wallet to the new wallet's address (Chapter 19) so old plot files keep paying to new keys.
- **Your device is lost or stolen, no wallet password.** The thief can spend at will. Same response: import on a new device, move everything out, then assume the funds are racing the thief.
- **Your device is lost or stolen, with a strong wallet password.** The window is wider. Move funds at the next opportunity anyway, on the assumption that the password may eventually fall.
- **You found malware on your machine.** Phoenix's process is fine, but the underlying OS is not. Wipe the OS, reinstall, restore from the phrase on the clean machine, and *only then* keep using the wallet.

In all four cases, the recovery phrase makes the response routine: a new wallet on a new device, restored from the same phrase, with a sweep to a different phrase if compromise is confirmed.

## A practical checklist

For most users, the bar is the following five items. Check them all today.

- [ ] I have written my 24-word recovery phrase down on something durable.
- [ ] At least one copy is stored offline, in a location I will remember.
- [ ] I have tested a restore from this written copy and confirmed it works.
- [ ] If I use a BIP39 passphrase, I have stored it separately and tested with it included.
- [ ] I treat plot drives as disposable: a failed drive means a re-plot, not a recovery event. I rely on SMART monitoring and a sensible cooling concept — not backups or RAID — to keep them alive as long as possible.

For miners specifically, add two more.

- [ ] My mining wallet is either unencrypted, or set up as part of a cold/hot key split via forging assignment (Chapter 19) — so a reboot does not silently halt mining.
- [ ] If I run the aggregator, I know that its configuration and stats are not backed up by the recovery phrase, and I have written down what I would need to re-enter (listen address, upstream, mode).

## What's next

This was the heavy chapter for Part II. The next one — **Settings & Preferences** — is a tour of the application's settings screen: theme, language, network, fee defaults, the spendable-confirmation threshold, and the few advanced options that occasionally matter.
