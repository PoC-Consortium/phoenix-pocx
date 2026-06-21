# Transaction History & Details

The **Transactions** screen is the wallet's history and audit log. It lists every payment your wallet has sent or received, every mined block reward credited to it, and every transaction still waiting to confirm. This chapter walks through reading the list, filtering it down, opening a single transaction's full detail, and the two remediation workflows for transactions that get stuck on their way to confirmation.

## Opening the Transactions screen

From the sidebar, click **Transactions** under the *Transactions* group. The page opens with a header bar at the top, a filter bar below it, a count line, and a paginated table of transactions in the centre.

![The Transactions screen with filters and the history table.](images/processed/ch09-transactions-list.png){width=98%}

### Header

The header carries three controls:

- A **back arrow** that returns to the previous screen.
- A **Load limit** drop-down that controls how many recent transactions Phoenix asks Bitcoin-PoCX Core to return. A higher limit means a longer wait at first but a more complete history; a lower limit is fast but may not reach back to older payments. Switch this if you need to look further back than the default window.
- A **Refresh** button (circular arrow) that re-fetches transactions immediately. Phoenix also refreshes automatically when balances change.

## Filtering the list

The filter bar below the header narrows what appears in the table. All filters compose; the count line beneath it always reflects the current filtered total.

| Filter   | What it does                                                                                                              |
|----------|---------------------------------------------------------------------------------------------------------------------------|
| **Search**  | Free-text match against transaction IDs and addresses. Useful when you remember part of a txid or recipient.            |
| **Type**    | Restrict by category: *All*, *Send*, *Receive*, *Immature*, *Generate*. The mining-specific categories are explained below. |
| **From**    | Hide transactions older than the selected date.                                                                          |
| **To**      | Hide transactions newer than the selected date.                                                                          |
| **Reset**   | Clear all filters in one click.                                                                                          |

### A note on the mining-related types

Two of the type-filter options exist because Bitcoin-PoCX miners receive rewards through the wallet:

- **Generate** — coinbase transactions: block rewards your miner has earned. Each forged block produces one such row.
- **Immature** — block rewards that have been earned but are not yet spendable. New mining rewards must wait a fixed number of blocks (the *coinbase maturity* period — roughly 100 blocks on a Bitcoin-style chain) before they can be moved. Until then, they appear as *immature* and are excluded from the wallet's confirmed balance.

If you have never mined with this wallet, both filters will return empty lists.

## The transactions table

The table has seven columns. Reading left to right:

| Column              | What you see                                                                                  |
|---------------------|-----------------------------------------------------------------------------------------------|
| **Date**            | Two-line stack: the date on top, the time below, in your local timezone.                      |
| **Type**            | A small badge: *Send*, *Receive*, *Generate* (mined), or *Immature* (mining reward not yet spendable). |
| **Amount**          | Signed amount, in BTCX. Sends are shown as a debit, receives as a credit, fees deducted from sends. |
| **Account**         | The wallet account label (if any) and the address involved in the transaction.                |
| **Status**          | Confirmation status. See *Confirmation states* below.                                         |
| **Transaction ID**  | The full 64-character txid. Click it to open the transaction's detail page.                   |
| **Actions**         | A three-dot (vertical) menu of contextual actions. See *The row actions menu* below.           |

A row whose transaction has zero confirmations is rendered with a slightly muted style — Phoenix's way of saying *"this isn't yet on the chain."*

A paginator at the bottom of the card lets you change the page size and step through the full list. Page size and current position are remembered while you stay on the page.

### Confirmation states

The **Status** badge summarises where each transaction is in its life cycle.

| State               | Meaning                                                                                       |
|---------------------|-----------------------------------------------------------------------------------------------|
| *Pending*           | The transaction has been broadcast but is still in the mempool — not yet in any block.        |
| *N confirmations*   | The transaction is in a block that is *N* blocks deep, where *N* increases by 1 every new block forged on top. |
| *Conflicted*        | A different transaction spending the same inputs has been confirmed; this one will never confirm. |
| *Immature*          | (Coinbase only.) The reward exists on the chain but is still inside its maturity window.       |

Phoenix's *spendable* balance includes only transactions that have reached your configured confirmation threshold (Chapter 12). Anything below that contributes to *unconfirmed* balance instead.

## The row actions menu

Clicking the three-dot menu on any row opens a contextual list of things you can do without leaving the page:

- **Copy transaction ID** — copies the 64-character txid to the clipboard.
- **Copy address** — copies the address that this transaction touched (for sends, the recipient; for receives, your address).
- **View tx in explorer** — opens the configured block explorer at this transaction.
- **View address in explorer** — opens the configured block explorer at the address.
- **Transaction details** — same as clicking the txid; opens the detail page.
- **Send to address** — pre-fills the Send screen with this address as the recipient.
- **Add to contacts** — saves the address to your contacts (Chapter 10), prompting for a name.
- **Bump fee** — appears only when the transaction is unconfirmed, marked replaceable (RBF), and is a *send*. Opens the bump-fee dialog described later in this chapter.

> **Tip** — *Send to address* is the fastest path to "send to the same person again" — it skips the address re-entry and clipboard-hijacking risk entirely.

## Looking at a single transaction

Clicking the txid (or selecting **Transaction details** from the row menu) opens the detail page. This is where the full anatomy of a transaction becomes visible.

![A transaction detail page: metrics, inputs, and outputs.](images/processed/ch09-transaction-detail.png){width=98%}

### Summary card

The summary card at the top of the detail page shows:

- The **transaction ID** in full, with a copy control.
- A **status badge** (the same confirmation states as on the list).
- An **RBF** badge if the transaction was sent with Replace-By-Fee enabled.
- The **timestamp** the transaction was first seen.
- A **Bump fee** button if the transaction is still bumpable (unconfirmed, RBF-marked send).

Below the badges, a **metrics grid** shows the technical details:

| Metric          | What it is                                                                                  |
|-----------------|---------------------------------------------------------------------------------------------|
| **Amount**      | The net change to your wallet, signed. `+0.5 BTCX` for an incoming, `−0.5 BTCX` for an outgoing. |
| **Fee**         | The fee paid to miners, when known.                                                         |
| **Size**        | The transaction's serialized size in bytes.                                                 |
| **Virtual size**| Size in *vBytes* — the unit fees are quoted in.                                             |
| **Fee rate**    | The fee divided by virtual size, in `sat/vB`. Useful to spot a rate that was too low.       |
| **Weight**      | The transaction's weight in *weight units* — a Bitcoin-internal accounting figure.          |

### Inputs and outputs

Below the summary, two side-by-side panels list every **input** and **output** of the transaction.

- **Inputs** are previous outputs being spent by this transaction. Each input shows the parent txid and output index (`txid:vout`), the source address (when known), and the amount. A coinbase input is labelled *Coinbase* — present on every block-reward transaction.
- **Outputs** are the new outputs created by this transaction. Each output shows its index, destination address (or special marker for non-address outputs such as `OP_RETURN`), and the amount.

The arrow between the two panels visualises that inputs are consumed and outputs are created. Total input minus total output equals the fee paid to the miner.

> **Tip** — A small *change* output back to your own wallet is normal and expected. Bitcoin-style transactions almost never spend exactly the amount of an existing UTXO — the difference returns to a fresh address you control. Phoenix's balance accounting handles this transparently; the inputs/outputs view shows it explicitly.

## Bumping a stuck transaction (RBF)

If you sent a transaction with **Replace-By-Fee** enabled (Chapter 8) and it is taking longer to confirm than you would like, you can re-broadcast it with a higher fee. The replacement uses the same payment details — the recipient still receives the same amount — but pays miners more, which moves it ahead in the queue.

### When the action is available

Phoenix shows the **Bump fee** action only when *all three* of these are true:

- The transaction has zero confirmations (it is still pending).
- The transaction was sent with the BIP-125 *replaceable* flag — i.e. the **Replace-By-Fee** toggle was on at send time.
- The transaction is a **send** from this wallet (you cannot bump someone else's transaction to you).

If any of those conditions does not hold, the **Bump fee** action is hidden.

### Opening the dialog

Two entry points:

- **Transaction list.** Click the three-dot menu on the row, then choose **Bump fee**.
- **Transaction detail page.** Click the **Bump fee** button in the summary card.

### Inside the dialog

![The Bump fee dialog for replacing an RBF transaction with a higher fee.](images/processed/ch09-bump-fee.png){width=55%}

The dialog re-states the transaction you are about to replace — txid, recipient, amount, and the original fee — then offers the same priority grid you saw on the Send screen: **Slow / Normal / Fast / Custom**, each with its `sat/vB` rate, plus a custom-rate input.

Below the priority buttons, a small summary block highlights the **fee increase**: original fee, new fee, and the difference. If the rate you select does not actually exceed the original fee, the dialog shows a warning and disables confirmation — RBF replacements *must* pay more than the transaction they replace.

When you click **Confirm**, Phoenix calls Bitcoin-PoCX Core's `bumpfee` RPC. Core constructs the replacement transaction, signs it with your wallet's keys, and broadcasts it. A success notification displays the new transaction's ID; the original transaction's row in the list is replaced by the new one (or marked superseded, depending on your view), and the new fee figure now reflects what you just paid.

If even the bumped transaction will not confirm — fees may have spiked further while you were watching — you can bump again with a higher rate, or wait for mempool conditions to settle. Chapter 26 covers the deeper troubleshooting cases.

> **Note** — The workflow described in the next section is **planned for a future release** and is not yet available in the wallet. The text below describes the intended behaviour so this handbook is ready when the feature ships. Until then, the only ways out of a stuck *non-RBF* transaction are to wait for it to be evicted from the mempools, or — if the transaction was sent with RBF enabled — to use the bump-fee workflow above.

## Abandoning a stuck transaction

Sometimes a transaction is stuck in a way that **Bump fee** cannot rescue. The classic case: you sent without RBF enabled, the fee was too low, and the transaction was eventually dropped from every node's mempool. The transaction never confirmed — but Bitcoin-PoCX Core still considers its inputs *spent*, so the funds appear locked to a transaction that will never complete.

**Abandon** is the escape hatch for this case. It marks the transaction as abandoned in your wallet's bookkeeping, which releases the inputs so you can spend them in a fresh transaction. The original transaction is *not* cancelled at the network level — there is nothing to cancel; the network long since forgot about it. What changes is your wallet's view of which UTXOs are available.

To abandon a transaction:

1. Open **Transactions** and locate the stuck entry. Eligible entries show an **Abandon** action *next to* the existing **Bump fee** action — in the row menu on the transaction list, and as a button on the transaction detail page.
2. Click **Abandon**. A confirmation dialog explains what abandoning does (and what it does *not* do — see the Warning below) and asks you to confirm.
3. Once confirmed, the transaction's row is marked *abandoned* and its inputs become spendable again. You can now create a new transaction using those inputs — typically the same payment, with a sensible fee.

> **Warning** — Only abandon a transaction you are confident will never confirm. If you abandon a transaction and then it does eventually confirm (because some node still had it in its mempool), and you have already re-spent the inputs, the network will reject one of the two — but until then your wallet's accounting may be temporarily inconsistent. As a rule, only abandon transactions that have been stuck for at least 24–48 hours and are not visible on a block explorer.

> **Note** — *Abandon* is only available for transactions whose inputs are not already conflicted with a confirmed transaction. Bitcoin-PoCX Core enforces this at the RPC layer; Phoenix surfaces the action only when Core says it is safe.

## What's next

You can now read your history, drill into a single transaction, and rescue a stuck one. The next chapter — **Contacts** — covers Phoenix's local address book: saving addresses with names, picking them on the Send screen, and the small set of operations available from the contacts view.
