# Contacts

The **Contacts** screen is Phoenix's local address book: a list of *(name, address, notes)* entries you can refer to when sending, instead of pasting an address every time. This chapter walks through adding, editing, deleting, and using contacts, then covers where contacts live (and where they do not).

## What contacts are — and what they are not

A contact is purely a label your Phoenix install attaches to a public address.

- It has **no on-chain effect**. The network does not know your contacts. They are not part of any transaction; they are not visible to anyone you pay.
- It is **not part of your wallet's keys**. Restoring your wallet from the recovery phrase on a different machine does not bring your contacts with it.
- It does **not store anything private**. The address you paste is already public information.

Contacts are a convenience for *you*, the operator of this Phoenix install — to make sending less error-prone and to keep a small private record of who is who.

> **Note** — Phoenix stores contacts in the application's local storage on this machine. They are not synced to Bitcoin-PoCX Core, they are not encrypted with your wallet password, and they are *not* recoverable from your 24-word phrase. If you reinstall Phoenix on a new machine, the contact list will be empty until you re-add entries. Chapter 11 covers practical backup approaches if you keep many contacts.

## Opening the Contacts screen

From the sidebar, click **Contacts** under the *Transactions* group. The screen consists of a header strip, a search bar, and the contacts table itself.

![The Contacts address book.](images/processed/ch10-contacts.png){width=98%}

On a fresh wallet the table shows an empty state with a friendly icon and a single **Add contact** button to get you started. The same action lives in the upper-right corner of the header at all times.

## Adding a contact

Click **Add contact** in the header (or the call-to-action button in the empty state). A small form slides into view above the list with three fields.

| Field         | What goes here                                                                                          |
|---------------|---------------------------------------------------------------------------------------------------------|
| **Contact name** | Up to 50 characters. Any label that helps you recognise the contact — *"Mum"*, *"Exchange withdrawals"*, *"Pool payouts"*. |
| **Address**   | The Bitcoin-PoCX address you want to associate with the name. Validated live, with the same green-check / red-error badge you saw on the Send screen (Chapter 8). |
| **Notes**     | Up to 200 characters of free text. Useful for context — *"home wallet, generated 2026-04-01"* — that the name alone does not capture. |

The address must be valid for the network you are currently on. Pasting a mainnet address into Phoenix while it is connected to testnet (or vice versa) is rejected with a *wrong network* message.

Click **Add** to save. The form collapses and your new entry appears in the table, sorted alphabetically with the rest.

> **Tip** — A common practice is to add a contact for every regular payee — exchange deposit addresses, recurring recipients, your own cold-storage address — so that future sends use the contacts picker instead of paste-and-pray. Combined with the address validation, this is the single biggest defence against the clipboard-hijacking attack discussed in Chapter 8.

## Editing or deleting a contact

Each row in the contacts table has a small **copy** icon for one-click address copying and a three-dot (vertical) menu of further actions.

| Action               | What it does                                                                                |
|----------------------|---------------------------------------------------------------------------------------------|
| **Send to contact**  | Jumps to the Send screen with the contact's address pre-filled as the recipient.            |
| **Copy address**     | Copies the address to the clipboard. Same as the dedicated copy icon on the row.            |
| **Edit**             | Re-opens the form, populated with the contact's existing name, address, and notes for editing. |
| **Delete**           | Removes the contact, after a confirmation dialog.                                           |

Edits save in place; deletes are confirmed before they happen, so a single accidental click does not lose an entry.

## Searching the list

The search bar above the table filters the list as you type. It searches simultaneously against:

- The contact's **name**.
- The contact's **address**.
- The contact's **notes**.

This means you can find a contact by typing part of a name (*"mum"*), part of the address (*"pocx1q…ext1"*), or part of any note you added (*"pool"*). Clearing the search field (the `×` icon at the right edge) restores the full list.

## Where contacts surface elsewhere

Two other screens are wired into contacts; the integration is what makes the address book actually useful.

### The Send screen's contacts picker

On the **Send** screen (Chapter 8), the small contacts icon next to the recipient field opens a menu listing every contact for the current network. Choosing a contact populates the recipient address. If you have no contacts yet, the icon is greyed out.

### "Add to contacts" from a transaction

On the **Transactions** screen (Chapter 9), the three-dot row menu offers **Add to contacts** whenever the transaction has an associated address. Clicking it jumps to this Contacts screen with the form pre-opened and the address pre-filled — you only need to type the name (and optional notes) and click **Add**.

This is the easiest way to turn "someone paid me from this address" or "I sent here once" into a permanent labelled entry.

## Where contacts are actually stored

Two things about storage are worth knowing before you build up a large list.

- **Per-install, per-machine.** The contact list lives in Phoenix's local application storage on this device. Reinstalling Phoenix on a different machine — even with the *same recovery phrase* — starts with an empty contact list.
- **Per-network.** Each contact is stored with a *network* tag (mainnet, testnet) and the list only shows contacts for whichever network you are currently connected to. Switching networks shows a different list; a contact you added on testnet does not pollute the mainnet view, and vice versa.

If you maintain a large contact list and want to back it up, the most practical approach today is to back up Phoenix's settings directory as part of your normal computer backups — Chapter 11 has a section on what is in that directory and how to copy it.

## What's next

The next chapter — **Backup, Security & Recovery** — is the most important one in this part of the handbook. It covers, in detail, how to keep your recovery phrase safe, what gets covered (and not covered) by a phrase-based restore, how Phoenix's wallet password fits in, and how to test a restore before you actually need one.
