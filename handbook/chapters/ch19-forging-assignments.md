# Forging Assignments

A forging assignment is the on-chain mechanism that separates *who owns a plot* from *who is allowed to forge with it*. It is the single most important concept for pool mining, for keeping mining keys off your main wallet, and for running plots on a machine that should not hold your recovery phrase. This chapter explains what assignments are, walks through the three things you can do with them in Phoenix, and tackles the chicken-and-egg problem that trips up brand-new pool miners.

Chapter 2 introduced assignments briefly and Chapter 13 placed them in the mining architecture. This chapter is the working reference.

## What an assignment actually does

Every plot file embeds a **plot address** — the address set when the plot was generated. By default, the key controlling that address is also the key that must sign any block the plot forges. An assignment breaks that default: it publishes an on-chain declaration that says *"for blocks forged by this plot address, the signer is now this other forging address."*

- The **plot owner** — the key controlling the plot address — never changes. Ownership stays with you.
- The **forging authority** — the right to sign blocks and (by convention) receive their rewards — moves to the **forging address** you nominate.
- The assignment is **reversible**. The plot owner can revoke it at any time and reclaim forging authority.

Assignments are published as ordinary transactions using an `OP_RETURN` output — a small, standard way to write data onto the chain without bloating the spendable-coin set. Creating one costs a normal transaction fee; revoking one costs another. There is no special "assignment fee" beyond the ordinary network fee any transaction pays.

> **Note** — An assignment delegates *forging*, not *ownership*. The forging address can sign blocks for your plots; it cannot move your plots, spend your other funds, or create further assignments. Only the plot owner can assign or revoke. This is what makes pool mining non-custodial: the pool forges for you without ever being able to touch your plots or your wallet.

## The assignment state machine

An assignment is not instantaneous — it moves through a sequence of states with deliberate on-chain delays, so the network stays stable during block races and nobody can rapidly flip forging identities to game the system.

| State          | Meaning                                                                                        |
|----------------|------------------------------------------------------------------------------------------------|
| **Unassigned** | No assignment exists. The plot owner forges and signs for their own plots.                     |
| **Assigning**  | An assignment transaction has confirmed but is still in its activation delay. The plot owner still signs during this window. |
| **Assigned**   | The assignment is active. The forging address signs blocks for the plot.                       |
| **Revoking**   | A revocation has confirmed but is still in its (longer) delay. The forging address *still* signs during this window. |
| **Revoked**    | The revocation has completed. Forging authority has returned to the plot owner.                |

Two timing rules matter, and they are deliberately asymmetric:

- **Activation takes ~30 blocks (roughly one hour).** A new assignment does not take effect immediately; the network waits about 30 blocks before the forging address becomes the signer.
- **Revocation takes ~720 blocks (roughly one day).** Reclaiming forging authority is much slower. During the whole revocation window the *current* forging address keeps signing. This long delay protects pools and shared infrastructure from sudden "assignment hopping."

> **Tip** — Plan around the asymmetry. Pointing your plots at a pool is quick (an hour). Pulling them back — to switch pools, or to return to solo — takes a day, during which the old pool still forges your blocks. Switch deliberately, not on a whim.

## Where assignments live in Phoenix

Open **Forging Assignment** from the sidebar's *Mining* group. The screen shows the current block height at the top (assignments are measured in blocks, so the live height is your clock) and three tabs:

- **Create assignment** — delegate forging rights.
- **Revoke assignment** — reclaim them.
- **Check status** — inspect the current state of any plot address.

![The Forging Assignment screen: three tabs and the live block height.](images/processed/ch19-assignment-tabs.png){width=98%}

## Creating an assignment

The **Create assignment** tab needs two addresses.

![The Create assignment tab: plot address, forging address, and fee.](images/processed/ch19-create-assignment.png){width=60%}

**Plot address.** A *select-or-enter* field: pick one of your wallet's addresses from the dropdown, or paste an address manually. This is the address embedded in the plots whose forging you want to delegate — usually the plotting address you set in the mining wizard (Chapter 15).

**Forging address.** The address you are delegating forging authority *to*. For pool mining, this is the pool's forging address (from the pool's information page). For a cold/hot split, this is the address of the hot wallet on your mining machine. Phoenix enforces one rule here: the forging address must be **different** from the plot address — assigning an address to itself is meaningless and is rejected.

When both are filled, click **Create assignment**. Phoenix builds the `OP_RETURN` transaction, asks Bitcoin-PoCX Core to sign it with the plot owner's key (you will be prompted for the wallet password if the wallet is encrypted), and broadcasts it — exactly like an ordinary send, with the same fee-selection controls. Once the transaction confirms, the assignment enters its **Assigning** state and the ~30-block activation clock starts.

> **Warning** — Creating an assignment requires the plot-owner key, so the wallet holding it must be loaded and (if encrypted) unlocked. You also need a small BTCX balance to pay the transaction fee — which is exactly the chicken-and-egg problem the last section of this chapter addresses.

## Revoking an assignment

The **Revoke assignment** tab takes a single input: the **plot address** whose assignment you want to cancel (again, select-or-enter). A revocation transaction carries only the plot address — it does not need the forging address, because revoking simply says *"return authority to the owner."*

Click **Revoke assignment**, sign and broadcast as before, and the assignment enters the **Revoking** state. Remember the ~720-block (~1 day) delay: the existing forging address keeps signing throughout, and authority only returns to you once revocation completes.

You cannot revoke an assignment that is not active, and you cannot create a new one while an address is mid-transition — Phoenix shows a *"cannot create/revoke assignment: address is in {state} state"* message when the state machine does not allow the action yet. Use the status tab to see where an address is in the cycle.

## Checking status

The **Check status** tab is read-only and the safest place to start. Enter (or select) a plot address and click **Check status**; Phoenix queries the chain and reports:

- Whether an assignment **exists** at all (*"No assignment exists for this address — you can create one"*).
- The current **forging address**, if assigned.
- The block the assignment was **created at** and the block it **activates at**, with a live **blocks remaining** countdown during the activation or revocation window.

![The Check status tab, showing an active assignment.](images/processed/ch19-check-status.png){width=60%}

Use this tab to confirm an assignment activated before you rely on it, to see how many blocks remain in a pending transition, and to verify a pool actually received the delegation you sent it.

## Use case 1 — Pool mining

The most common reason to create an assignment. A pool forges blocks on behalf of many miners and distributes rewards; to forge with *your* plots, it needs forging authority over your plot address.

The flow:

1. Choose a pool and open its information page. Note its **forging address**.
2. In Phoenix, **Create assignment**: your plot address → the pool's forging address.
3. Wait ~30 blocks for activation. Use **Check status** to confirm.
4. Configure the pool as a chain in the mining wizard (Chapter 15) so your miner submits to it.

From then on, the pool forges your plots and pays you according to its policy. To leave, revoke the assignment (and remember the ~1-day delay) before re-pointing your plots elsewhere.

## Use case 2 — Cold/hot key split

This is the answer to the encrypted-wallet-versus-mining problem raised in Chapters 5, 11, and 15. The goal: keep the wallet that *owns* the plots (and receives the rewards) encrypted and offline, while a separate, disposable wallet on the mining machine does the block-signing.

The arrangement:

- **Owner wallet (cold).** Holds the plot address. Encrypted, ideally on a machine that is not the mining rig. Receives the rewards. Almost never needs to be online.
- **Forging wallet (hot).** A fresh wallet on the mining machine. Unencrypted, so the miner can sign blocks without a manual unlock after every reboot. Holds *only* forging authority — if the rig is stolen or compromised, the attacker gets the ability to forge blocks (which pay the owner anyway) but cannot touch the owner's funds.

Set it up by creating an assignment from the owner wallet's plot address to the forging wallet's address. The owner wallet only has to come online briefly to publish the assignment (and later, if ever, to revoke it).

> **Tip** — This is the recommended setup for any serious unattended miner. It resolves the dilemma from Chapter 5 — *"encrypt for safety, but then mining stalls after every reboot until I type the password"* — by making the rig's wallet one that is safe to leave unlocked, because it holds no funds and no ownership, only delegated forging authority.

## Use case 3 — Moving plots to new hardware

When you move plot files to a different machine (Chapter 11), the destination needs to be able to sign for the plots' embedded address. Rather than importing your main wallet onto the new machine, you can create an assignment from your plot address to a forging address on the new machine. The plots keep forging, the rewards keep flowing to you, and the new machine never holds your recovery phrase.

## The chicken-and-egg problem (and how to solve it)

Here is the trap that catches new pool miners:

> To mine in a pool, you must publish a forging assignment. Publishing an assignment is a transaction. A transaction costs a fee. The fee is paid in BTCX. But you have no BTCX yet — *earning some is the reason you wanted to join the pool in the first place.*

It is a genuine circular dependency, and it has a clean solution: **most pools run an integrated faucet** precisely to break it. A faucet dispenses a tiny amount of BTCX — just enough to cover the assignment transaction fee — to new miners.

The practical flow for a brand-new miner with an empty wallet:

1. Choose your pool and open its **information page**.
2. Find the pool's **faucet** (pools that expect new miners almost always provide one; the link is typically on the same page as the pool's forging address).
3. Request a small amount of BTCX to your wallet's receive address (Chapter 7). It arrives as an ordinary incoming transaction.
4. Once it confirms, you have enough to pay the fee. **Create the assignment** from your plot address to the pool's forging address.
5. Wait for activation, configure the pool chain, and start mining.

> **Tip** — The faucet amount is intentionally tiny — enough for a transaction fee, not a windfall. Its only job is to bootstrap your first assignment. After that, your pool earnings cover any future assignment or revocation fees, and the chicken-and-egg problem never returns.

If your chosen pool does not provide a faucet, the alternatives are the ordinary ones for acquiring a small amount of any cryptocurrency: receive a little from someone who already has BTCX, or mine solo briefly until you forge enough to cover the fee (slower, but entirely self-contained). But for most miners, the pool's own faucet is the path of least resistance.

## What's next

You can now delegate and reclaim forging authority, which completes the picture of *who signs your blocks*. The next chapter — **Running the Miner & the Mining Dashboard** — covers the day-to-day of mining itself: starting and stopping the miner, reading the dashboard's chains, deadlines, and capacity figures, and recognising at a glance whether everything is working.
