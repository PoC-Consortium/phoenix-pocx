# Receiving Bitcoin-PoCX

To receive BTCX, you give the sender one of your wallet's *addresses*. The sender's wallet broadcasts a transaction to the network with that address as the recipient; once the network's nodes pick it up, it shows up in your transaction history and your balance goes up.

This chapter walks through the **Receive** screen, what each field does, how to share your address safely, and what you should expect to see while a payment arrives.

## What an address is, in one minute

A Bitcoin-PoCX address is a short, public identifier derived from one of your wallet's keys. Every address you create from a single wallet belongs to the same wallet behind the scenes, even though they look unrelated. They are *public* by design:

- Anyone holding an address can send BTCX to it.
- Anyone watching the chain can see the address's history, incoming and outgoing.
- Nobody can spend from the address without the corresponding private key — which lives inside Bitcoin-PoCX Core, not in Phoenix.

Phoenix uses **bech32 addresses** — the modern, lower-case format that starts with `pocx1q` on mainnet or `tpocx1q` on testnet. These are smaller, less error-prone, and what the rest of the network expects.

> **Note** — A reasonable mental shortcut: an address is like a deposit slot. You can have as many slots as you like, all feeding the same vault. The keys that open the vault are not on the slot, and giving someone a slot does not give them the keys.

## Opening the Receive screen

From the sidebar, click **Receive** under the *Transactions* group. Phoenix opens a single, compact card. Top-to-bottom: the address selector, the optional amount and label fields, the QR code, copyable **address** and **payment URI** rows, and a **Generate new address** button at the bottom.

![The Receive screen, with address selection, QR code, and payment URI.](images/processed/ch07-receive.png){width=98%}

## Choosing an address

The **Select address** drop-down at the top lists every address your wallet has handed out — including, after a restore or re-import, the addresses recovered from the wallet's descriptors, not just the ones this installation generated. Each entry shows:

- The address itself, in bech32 form.
- Optional metadata in parentheses: a label you previously assigned, *"never used"* if no payment has ever touched it, and *"(v30)"* if the address belongs to an older wallet's retired derivation branch.

When the screen opens, Phoenix pre-selects your **first never-used address** — ready to share without creating churn in your key tree. Pick a different entry if you prefer; the selected row shows the bare address, and the QR code refreshes to match.

### Generate new address

The **Generate new address** button at the bottom of the card derives a brand-new address from your wallet's HD key tree. The new address appears immediately, joins the list, and becomes the active selection — click again if you want a different fresh address before sharing.

> **Tip** — A standard Bitcoin-style privacy practice is to use a different address for each payment you receive. All addresses still belong to the same wallet, so doing this does not split your balance — it only makes it harder for an outside observer to link your incoming payments together. For mining, the opposite is true: you typically reuse the same *plotting address* for the lifetime of a plot file. Chapter 16 covers that.

## Optional fields: amount and label

Two optional fields below the address selector help when you are sharing the receive request with someone:

- **Amount.** If you are asking for a specific amount of BTCX, enter it here. Eight decimal places are accepted (1 BTCX = 100 000 000 satoshis, the smallest unit). Phoenix bakes the amount into the QR code and the payment URI; a sender's wallet that scans the QR will pre-fill the amount field instead of asking the sender to type it.
- **Label.** A short description for your own record-keeping (up to 50 characters). The label is stored alongside the address in your wallet, so you can later identify what an incoming payment was for. Senders also see the label if their wallet decodes the payment URI.

Both fields are optional — leaving them empty produces a plain "send any amount to this address" request.

## Sharing the address

Once an address is selected (and any optional details are filled in), the card displays three artifacts you can share. They all encode the same information; pick whichever the sender finds easiest.

### The QR code

A square QR code appears in the centre of the card. Pointing a payment-aware mobile wallet's camera at it imports the address (and amount/label, if any) directly. The code uses error-correction level M, so a bit of glare or a partial obstruction will not ruin the scan.

### The address line

Below the QR is the **address** itself — a copyable line. Click anywhere on it (or the copy icon at its right edge) to copy the address to the clipboard. A small confirmation appears.

This is the simplest thing to send by chat or email when the recipient cannot scan a QR code.

### The payment URI

Below the address is the **payment URI** — the same address packaged as a clickable link with the amount and label baked in. Bitcoin-PoCX uses the `btcx:` scheme, so a typical URI looks like:

```
btcx:pocx1qexample…?amount=0.5&label=Invoice%20012
```

Click the URI line (or its copy icon) to copy it. Sharing the URI with a Bitcoin-PoCX-aware sender is the most foolproof way to convey "here's where to send, and how much."

> **Note** — The `btcx:` URI scheme is specific to Bitcoin-PoCX. Generic Bitcoin wallets that recognise `bitcoin:` URIs will not parse `btcx:` correctly. When the recipient is using anything other than a Bitcoin-PoCX wallet, send the plain address instead — that always works.

## What happens when a payment arrives

Once the sender broadcasts their transaction, the journey to your wallet is short but worth knowing:

1. **Mempool.** The transaction propagates between nodes and lands in the mempool — a buffer of transactions waiting to be mined. Bitcoin-PoCX Core sees it almost immediately and reports it to Phoenix.
2. **Phoenix shows it as 0 / unconfirmed.** A new line appears in your **Transactions** view (Chapter 9) with a yellow status. Your *unconfirmed* balance goes up, but the *confirmed* balance does not change yet.
3. **First confirmation.** When the next block is forged and includes your transaction, Phoenix flips the row to "1 confirmation." On Bitcoin-PoCX this typically happens within a couple of minutes (the target block interval is 120 seconds).
4. **Subsequent confirmations.** Each new block on top of the one that included your transaction adds one more confirmation. Most everyday payments are considered settled after a handful of confirmations.

Phoenix treats inflows as spendable once they reach the wallet's confirmation threshold (currently six). Until then, the wallet treats them as visible-but-not-yet-yours.

> **Tip** — If your sender claims to have sent the payment but Phoenix has not seen anything after a few minutes, the most common reasons are: their fee was too low and the transaction is still waiting in mempools, or there is a typo in the address. Both are usually visible on a block explorer; ask the sender for the transaction ID to investigate.

## Reusing an address vs. generating new ones

There is no technical problem with reusing an address. Bitcoin-PoCX Core happily tracks every payment to any address you own, no matter how often it is reused. The trade-off is privacy:

- **One address per payment.** Hardest to link your payments by an outside observer. Recommended for everyday use, payment requests to different parties, donations.
- **One stable address.** Easier for a regular sender (a payroll, a recurring donor) to keep on file. Fine if you are not concerned about who knows what.
- **One stable address for mining.** *Required.* Plot files embed their address at plot time, so changing the address means re-plotting. Once chosen, leave it alone.

## Where mining fits in

If you came to Phoenix to mine, you will need a **plotting address** — the address embedded in every plot file you generate. There are two places where you can get one, and they are not equivalent.

- **The mining setup wizard (Chapter 15) — the recommended path.** When you start the wizard, it automatically pre-fills the *first* address derived from your active wallet's descriptor. This is the simplest, most recognisable option: the first address has a fixed position in your HD key tree, so it is the same every time you re-derive it from your recovery phrase, and it is easy to tell apart from the dozens of fresh addresses a wallet may accumulate over time. For most miners, accepting the wizard's pre-filled value is the right answer.
- **This Receive screen — for the deliberate exception.** If you specifically want to mine to a *different* address — for example, to keep mining proceeds going to a freshly generated, never-used address for privacy reasons — generate or pick that address here, copy it, and paste it into the wizard's plotting address field in place of the pre-filled value.

Once chosen, the plotting address is fixed for the lifetime of every plot file that uses it: re-plotting is the only way to change the address embedded in a plot. Pick a stable address — the wizard's first-address default is stable by design.

> **Tip** — Some miners create a separate wallet specifically for mining and accept its first address as the plotting address. It keeps mining traffic separate from everyday wallet activity, makes bookkeeping easier, and (combined with the cold/hot key split discussed in Chapter 19) lets the long-term rewards live in a different, encrypted wallet without forcing the mining wallet to be unlocked manually after every restart.

## What's next

You now know how to ask for BTCX. The next chapter is the other half of the equation — how to **send** BTCX out, including fee selection, address validation, and what to look for before clicking confirm.
