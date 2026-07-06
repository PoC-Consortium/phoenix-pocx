# Sending Bitcoin-PoCX

Sending BTCX is a one-screen workflow: tell Phoenix who you are paying, how much, and how urgently — Phoenix asks Bitcoin-PoCX Core to build and sign the transaction, then broadcasts it to the network. This chapter walks through the **Send** screen field by field, the confirmation dialog, what happens after you click send, and the most common errors.

> **Warning** — Bitcoin-PoCX transactions are **irreversible**. Once a transaction is broadcast and confirmed, no one — not the network, not the project, not your bank — can reverse it for you. Verify the recipient address, the amount, and the network you are on *before* you confirm.

## Opening the Send screen

From the sidebar, click **Send** under the *Transactions* group. The page opens with a small header strip at the top:

- **A back arrow** — returns you to the previous screen.
- **The title** *Send*.
- **Your available balance** in the upper-right, in BTCX. This is what is currently spendable. Funds that are still unconfirmed are *not* included until they reach your spendable threshold (Chapter 12).

Below the header, a single card holds every input the wallet needs.

![The Send screen: recipient, amount, fee, options, and summary.](images/processed/ch08-send.png){width=98%}

## Recipient

The first section is the **recipient address** field with a contacts shortcut beside it.

### Typing or pasting an address

Type or paste the recipient's bech32 Bitcoin-PoCX address. Phoenix validates the address as you type and shows a small icon at the right edge of the field:

- **Green check** — the address is valid and matches the network you are on (`pocx1q…` on mainnet, `tpocx1q…` on testnet).
- **Red error** — the address fails one of several checks. Hovering over the icon shows the reason: invalid format, wrong network, bad checksum, and so on. A matching error message also appears below the field.

> **Tip** — Verify the address even when it looks correct. The classic attack on cryptocurrency users is *clipboard hijacking*: malware that swaps the address you copied for one belonging to the attacker. Compare at least the first six and last six characters of the address you pasted against what your recipient sent you. If anything is off, do not send.

### Selecting from contacts

To the right of the address field is a small **contacts** button (a person icon). If you have saved any contacts (Chapter 10), clicking it opens a menu listing each contact's name and address; choosing one fills in the recipient field. If you have no contacts yet, the button is greyed out.

## Amount

Below the recipient is the **amount** field. Type the number of BTCX you want to send. Phoenix accepts up to eight decimal places (1 BTCX = 100 000 000 satoshis, or *sats*).

### The Max button

Next to the amount field, **Max** asks Phoenix to use every spendable unit in your wallet. It populates the amount with your full available balance.

A reasonable use of **Max** is "send everything to my new wallet" or "consolidate this UTXO set into a fresh address." Phoenix handles the math for you: clicking **Max** also turns on **Subtract fee from amount** below, so the resulting send is always within your balance — the recipient gets *balance − fee*, your wallet ends at zero confirmed.

> **Tip** — If you flip **Subtract fee from amount** *back off* after clicking **Max**, the total now exceeds your balance and Phoenix blocks the send. That is intentional: with the maximum balance in the amount field there is no room left to add a fee on top.

## Fee

Sending requires a network fee, paid to whichever miner forges the block that includes your transaction. The fee is expressed in **sat/vB** — satoshis per virtual byte of transaction data — and the wallet shows you both the rate and the resulting fee amount.

> **Note** — *vBytes* are a Bitcoin-style unit that account for the discount given to witness data (signatures). A typical bech32 send is roughly 140–200 vBytes; a `5 sat/vB` rate translates to a fee of `5 × 140 = 700` sats, or `0.000007` BTCX. Higher-priority sends use higher rates.

### Priority options

Phoenix offers four buttons in this section:

| Option       | Goal                                                                                  | Confirmation target                |
|--------------|---------------------------------------------------------------------------------------|------------------------------------|
| **Slow**     | Cheapest. Acceptable when you do not care when it confirms.                           | Aim to confirm within ~144 blocks. |
| **Normal**   | Default. Reasonable trade-off between cost and speed.                                 | Aim to confirm within ~6 blocks.   |
| **Fast**     | Highest standard option. Use when you want the next block.                            | Aim to confirm in the next block.  |
| **Custom**   | Type your own rate in sat/vB. Useful for advanced control or unusual mempool shapes.  | Whatever your rate buys.           |

Each non-custom option also shows the **estimated rate** (in sat/vB) and a rough **time-to-confirm** label. The rate itself is computed by Bitcoin-PoCX Core's fee estimator, which watches recent blocks and adapts to the chain's actual block production — so the *"confirm within 1 block"* rate really is the rate that gets you into the next block on Bitcoin-PoCX, not on a 10-minute Bitcoin chain.

> **Note** — The accompanying time labels (such as *"~10 min"*) are rough priority hints baked into the user interface. On Bitcoin-PoCX, blocks target a **120-second** interval, so the actual wait once a sufficient fee is paid is generally shorter than the label suggests. Read the labels as *fast / normal / slow* indicators rather than exact timings; the underlying rate is what determines how quickly you confirm.

The **refresh** icon at the right edge of the section re-runs the fee estimator if you want fresher numbers.

### Custom fees

Selecting **Custom** opens a small input where you type your own rate in `sat/vB`. The estimated fee figure beneath the priority buttons updates immediately. If you type a rate Bitcoin-PoCX Core considers below the network's minimum relay fee, the send will fail at broadcast time.

Phoenix also falls back to **Custom** *automatically* when Bitcoin-PoCX Core cannot produce a fee estimate — for example on a quiet testnet, or shortly after a node first comes online, when there have been too few recent transactions for the estimator to have anything to learn from. When that happens, Phoenix pre-selects **Custom** with a default rate of **1 sat/vB**, which is at or near the typical minimum relay fee. The send will go through, but it may take longer to confirm than usual; raise the rate before clicking **Send** if you want quicker confirmation.

### The estimated fee line

Below the priority buttons, the line *"Estimated fee: X BTCX (Y sats)"* shows the resulting fee for your current selection — both in BTCX and in raw satoshis, for clarity.

## Options

Two toggles tweak how the transaction is built:

### Subtract fee from amount

When **on**, the fee is paid out of the amount you typed rather than added on top. Useful when you want the recipient to receive an exact total minus your fee, or when you are using **Max**.

| With *subtract fee* off | With *subtract fee* on            |
|-------------------------|-----------------------------------|
| Recipient receives the full amount you typed; your wallet pays *amount + fee*. | Recipient receives *amount − fee*; your wallet pays exactly the amount you typed. |

### Replace-By-Fee (RBF)

When **on**, the transaction is broadcast with the BIP-125 *replaceable* flag set, which lets you re-broadcast the same transaction later with a higher fee if it is taking too long to confirm.

> **Tip** — RBF is genuinely useful when fees spike unexpectedly: you can bump a stuck transaction without having to wait or cancel. The trade-off is that some merchants and exchanges treat RBF transactions as higher-risk and require extra confirmations before crediting you. If you are paying a service that explicitly says "non-RBF only," leave this off.

## Summary panel

A read-only summary at the bottom of the form re-states what you have selected:

- **Amount** — what you typed in the amount field.
- **Estimated fee** — what the fee section computes.
- **Total** — *amount + fee* if subtract-fee is off, or just *amount* if it is on.

If your **Total** would exceed your available balance, the value turns red and an *Insufficient balance* warning appears with a yellow icon. The **Send** button stays disabled until the balance is enough.

## Confirming the send

When everything is filled in correctly, click **Send**. A confirmation dialog appears with a final summary: recipient address, amount, fee, total, and a small note if subtract-fee is enabled.

![The send confirmation dialog â€” the last check before broadcasting.](images/processed/ch08-send-confirm.png){width=60%}

This is your last chance to back out. **Read the dialog carefully**, especially the recipient address. If anything looks wrong, click **Cancel** and edit the form. If everything is correct, click **Confirm**.

### If the wallet is encrypted

If the wallet you are sending from is encrypted (Chapter 5), Phoenix now opens a second dialog asking for the wallet password. Type the password and click **Unlock**. Phoenix unlocks the wallet for a short timeout (60 seconds by default) — long enough to sign this transaction, short enough that the keys do not stay decrypted in memory.

Wallet encryption is per-action, not per-session, in this flow: even if you have just unlocked the wallet for browsing, sending always re-prompts to make sure *you*, and not someone walking past your unattended laptop, are the one authorising the spend.

## What you see when it succeeds

The form is replaced with a **Transaction sent** card containing:

- A green check mark and a confirmation message.
- The **transaction ID** (txid) — a 64-character hex string that uniquely identifies the transaction on the chain. A copy icon next to it copies it to your clipboard.
- Two buttons:
    - **View transactions** — jumps to the transaction history (Chapter 9), where the new entry is at the top with 0 confirmations.
    - **Send another** — clears the form and lets you start a new send.

Save the txid if you need to share it with the recipient or look the transaction up on a block explorer. From this moment, Bitcoin-PoCX Core is broadcasting the transaction to its peers; within a few seconds it should be in the mempool of every well-connected node, and within a couple of minutes it should land in a block.

## What can go wrong

Most send failures fall into a small handful of categories. Phoenix shows the underlying error in a red banner above the **Send** button when something goes wrong:

| Error                                  | What it usually means                                                            |
|----------------------------------------|----------------------------------------------------------------------------------|
| *Insufficient balance*                 | Total exceeds your spendable balance. Reduce the amount or enable subtract-fee.  |
| *Invalid address*                      | The address fails format/checksum/network checks. Re-check the first and last few characters. |
| *Wrong network*                        | The address is for a different network (e.g. mainnet address pasted on testnet). Switch networks (Chapter 12) or fix the address. |
| *Fee rate too low*                     | Your custom rate is below the network's minimum. Raise it.                       |
| *Wallet locked*                        | The encrypted-wallet password dialog was cancelled. Re-click **Send** and enter the password. |
| *Mempool full / replacement-too-low*   | Mempool conditions are unusual. Wait, or try again with a higher fee.            |
| *Connection error*                     | Phoenix lost the connection to Bitcoin-PoCX Core. Check the node status indicator (Chapter 6) and Chapter 26 for diagnosis. |

A failed send does not consume any funds — nothing is broadcast until Core has built and signed a valid transaction.

## The Transaction Builder

The **Send** screen above is the fast path: one wallet, one signature, broadcast immediately. The **Transaction Builder** is the advanced path for everything Send cannot do on its own:

- **Multisig wallets**, where a spend needs signatures from several co-signers (Chapter 5). The Builder collects them one at a time.
- **Watch-only wallets** imported as a descriptor, where you compose here and sign on the machine that holds the keys.
- **Offline / air-gapped signing**, where the transaction is built on one machine and signed on another.
- **Preparing a transaction now to sign or broadcast later**, or handing a half-finished transaction to someone else.
- **Manual coin (UTXO) control**, adding an `OP_RETURN` data output, or setting a locktime.

Under the hood the Builder works with a **PSBT** — a *Partially Signed Bitcoin Transaction*, the standard container format for a transaction that is being passed between wallets and signers as it collects signatures. You do not need to understand the format; the Builder walks you through it.

Open it from the sidebar: **Transaction Builder**, in the *Transactions* group.

### The start screen: two doors

The Builder opens on a choice of two "doors", plus a list of anything you have in progress:

| Door | For… |
|------|------|
| **Compose a transaction** | Building a new transaction from scratch — pick coins, set outputs and fee. |
| **Import a transaction**  | Continuing a PSBT that was started elsewhere — paste its Base64 text or open a `.psbt` file. |

Below the doors, an **In progress** list shows drafts saved on this machine. A composed transaction is saved here automatically and stays until you broadcast or discard it, so multi-day multisig coordination survives restarts. Each row shows a status badge, name, amount, and last-updated time, with a trash button to delete it.

![The Transaction Builder start screen: compose or import, with saved drafts below.](images/processed/ch08-psbt-start.png){width=70%}

### Composing a transaction

The compose form is a single scrolling card. Nothing is signed while you fill it in — when you finish, Bitcoin-PoCX Core funds the transaction and decides the exact change.

![Composing a transaction: coins, outputs, fee, options, and a live summary.](images/processed/ch08-psbt-compose.png){width=80%}


**Coins to spend.** A toggle between **Automatic** (the wallet picks which coins to spend and makes change for you — the default) and **Manual** (you choose the exact coins). Manual mode reveals a checklist of your spendable coins, each showing its address, `txid:vout`, confirmation count, and amount, with a filter box (by address/txid and by size) and a running *Selected* total. Manual control is useful for consolidating specific coins or avoiding particular ones.

**Outputs.** One row per recipient. Each has an **address** field (validated live against the current network, with a contacts shortcut) and an **amount in BTCX**. A **Max** button on a row fills it with everything left over and marks that output as the one the network fee comes out of (*"The network fee will be subtracted from this output"*). **Add output** adds another recipient; **Import list** lets you paste many recipients at once, one `address, amount` per line.

**Include data (OP_RETURN).** An optional toggle that embeds a small hex payload (up to 80 bytes) as an unspendable data output.

**Change address.** By default change returns to a fresh address in this wallet. Turn the toggle off to direct change to a specific address instead.

**Fee.** The same **Slow / Normal / Fast / Custom** choice as the Send screen, in `sat/vB`, with a refresh button for fresh estimates.

**Options.** **Replace-By-Fee** (on by default — see the RBF discussion earlier in this chapter) and an optional **Locktime** that delays the transaction's validity until a given block height.

A live **summary** shows what you are sending, the estimated fee, and the total. When everything is valid, click **Create PSBT & review**.

> **Note** — The fee and change shown while composing are *estimates*. The exact figures are fixed by the node when it builds the PSBT; the fee is paid on top of the output amounts and taken from the change. If a watch-only wallet cannot build the transaction because it holds no key information, Phoenix says so and points you to import it as a descriptor (xpub) instead.

### The four steps: Create, Sign, Finalize, Broadcast

Once a PSBT exists, a step indicator across the top tracks it through its life: **Create → Sign → Finalize → Broadcast.** The review screen shows the transaction's inputs and outputs — each output tagged **recipient**, **mine**, **change**, or **data** — and a status badge with a one-line explanation of what to do next.

![The review view: the four-step indicator, signature progress, and tagged inputs and outputs — shown here part-way through signing a multisig spend.](images/processed/ch08-psbt-review.png){width=98%}


**Sign.** Click **Sign with wallet** to add this wallet's signatures. If the wallet is encrypted, Phoenix prompts for the password first (a brief unlock, as with Send). What happens next depends on the wallet:

- A single-key wallet signs completely in one go.
- A **multisig** wallet adds only *your* signature. The status becomes *partially signed*, and the badge counts progress — for example *"1 of 2 signatures"*, and per-input counters like `1/2`. You then export the PSBT (below), send it to a co-signer, and merge their signed copy back with **Combine** (below) until the threshold is met.
- A **watch-only** wallet has no keys and cannot sign; Phoenix tells you to export the transaction and sign it on the machine that holds the keys.

*Sign on device* (hardware wallet) is shown but marked **coming soon**.

**Finalize.** Once all required signatures are present (status *Signed*), **Finalize** seals the inputs. After finalizing, the transaction can no longer be edited.

**Broadcast.** The final step sends the finalized transaction to the network. The only target today is your **local node**; broadcasting through a remote Electrum server is shown but marked *soon*. On success, Phoenix shows a **Transaction broadcast** confirmation with the copyable txid and buttons to view your transactions or start another.

![The final step: choosing where to broadcast the finalized transaction.](images/processed/ch08-psbt-broadcast.png){width=98%}


### Coordinating and moving a transaction between machines

The Builder is built for passing a transaction around. While a PSBT is not yet finalized you can:

- **Copy Base64** or **Save file** (`.psbt`) to hand the transaction to a co-signer or another device. (After finalizing, these become **Copy hex** / save the raw transaction, ready for any broadcaster.)
- **Combine signatures** — paste or open a co-signer's signed copy to merge their signatures into yours. This is how a multisig spend accumulates enough signatures.
- **Join transaction** — merge another party's inputs and outputs into this one (a CoinJoin-style combine). Both sides must still be unsigned, since joining changes what everyone signs.
- **Save draft** to set the transaction aside and pick it up later from the *In progress* list, or **Discard draft** to delete the local copy (exported copies are unaffected).

> **Warning** — Editing a transaction after it has been signed (stepping back into the compose form) discards the signatures collected so far, because changing the transaction invalidates them. Phoenix warns you before doing this. Copies you already exported are not affected.

### Two notices to understand

- **"No change output was created."** When the leftover change would be smaller than the network's *dust* threshold, creating a change output would cost more in fees than it is worth, so Core folds the remainder into the fee instead. The Builder shows an informational notice; nothing is wrong.
- **"Unusually high fee."** If the fee is a large share of the amount sent (or the rate is very high), the Builder flags it in orange before you broadcast — a guard against a fat-fingered fee rate. Broadcasting cannot be undone, so read it and confirm the numbers.

## What's next

You now know how to send BTCX — the quick way with **Send**, and the advanced way with the **Transaction Builder** for multisig, watch-only, and coordinated spends. The next chapter — **Transaction History & Details** — covers what happens after the broadcast: how Phoenix tracks confirmations, how to filter and search past transactions, and how to look at the details of a single transaction.
