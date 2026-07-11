# Creating or Importing Your Wallet

At the end of Chapter 4, Bitcoin-PoCX Core was running and Phoenix had handed you off to the **Wallets** screen. This chapter walks you through what to do there — creating a brand-new wallet from a fresh recovery phrase, importing an existing one, or setting up a *watch-only* wallet that observes addresses without holding keys.

## The Wallets screen

The first time you reach this screen there are no wallets yet. Phoenix shows a friendly welcome card with a rocket icon, a confirmation that Bitcoin-PoCX Core is ready, and a short explanation that you should now create or import a wallet.

![The Wallets screen on first run â€” Create New, Import, or Watch Only.](images/processed/ch05-wallets-empty.png){width=70%}

A row of buttons sits along the bottom edge of the box:

| Button         | Use it when…                                                                                                |
|----------------|-------------------------------------------------------------------------------------------------------------|
| **Create New** | You are starting from nothing. Phoenix generates a new recovery phrase that becomes the master key for your funds. |
| **Import**     | You already have a Phoenix or Bitcoin-PoCX recovery phrase from a previous setup, hardware wallet, or another wallet. |
| **Watch Only** | You want to *watch* an address or extended public key (xpub) without ever being able to spend from it.       |
| **Multisig**   | You want a shared wallet whose funds require several keys to spend — a 2-of-3 treasury, for example.          |

A primary **Open Wallet** button on the right is greyed out for now — it becomes active once you have at least one wallet to open.

> **Note** — Phoenix supports multiple wallets in parallel. Once you have one, this same screen lists all of them with their balance, encryption status, and a per-row Load/Unload control. We come back to multi-wallet operation at the end of this chapter.

> **Note — this chapter describes the managed / external (Core-backed) wallet.** If you run Phoenix in **remote mode** (Chapter 26) — or on Android (Chapter 23) — the wallet is not held inside Bitcoin-PoCX Core but lives locally on your machine and syncs over Electrum servers. The choices are the same in spirit (create from a 24-word phrase, restore, or import), but the screens and a few options differ; Chapter 26 covers the nodeless flows, including importing a wallet from its **descriptors** or from a single **WIF** private key.

If you ever see a red **Connection failed** state on this screen instead of the welcome card, Bitcoin-PoCX Core is not reachable. The screen offers **Retry**, **Settings**, and **Re-run node setup** buttons to diagnose. Chapter 27 covers this case in detail.

## Creating a new wallet

Click **Create New**. Phoenix walks you through a four-step wizard.

![Create-wallet step 1: naming the wallet.](images/processed/ch05-create-step1-name.png){width=70%}

### Step 1 — Name your wallet

Type a name in the **Wallet name** field — anything that helps you recognise it later, for example *"Main"*, *"Mining rewards"*, or *"Cold storage"*. Phoenix checks the name against your existing wallets and warns you if it is already taken.

The name is just a label inside Phoenix; it has no effect on your funds and can be changed later. Click **Next**.

### Step 2 — Write down your recovery phrase

Phoenix generates a brand-new **24-word recovery phrase** (formally a *BIP39 mnemonic*). The 24 words are displayed as numbered chips, in a fixed order from 1 to 24.

![Step 2: the 24-word recovery phrase (shown here for a throwaway wallet).](images/processed/ch05-create-step2-phrase.png){width=70%}

This phrase **is** your wallet. Anyone who has it can spend your funds; if you lose it and lose access to this device, no one — not the Phoenix team, not the network — can recover your funds.

> **Warning** — Write the 24 words down on paper, in order, *now*, before you do anything else. Do **not**:
>
> - Photograph them or screenshot the screen.
> - Save them in a password manager that syncs to the cloud, in a notes app, in e-mail, or in any file on your computer.
> - Read them out loud where they could be recorded.
> - Type them into any website or chat — Phoenix will never ask you to do this once the wallet is created.
>
> Store the paper somewhere safe and offline. Many people make two copies in two physical locations (home + safe deposit box, for example).

If you make a mistake while writing the phrase down, click **Generate New** to throw the current phrase away and produce a fresh one. Do this *before* you tick the confirmation box.

#### The optional 25th word (BIP39 passphrase)

Below the word chips is a checkbox labelled **Use BIP39 passphrase**. This is an *optional* extra layer: a passphrase you choose, of any length, that combines with the 24 words to produce a different wallet. Without the passphrase, the 24 words alone open a different (empty) wallet.

The passphrase is sometimes called the *25th word*. Use it if you want plausible deniability or extra protection against someone who finds your written phrase.

> **Warning** — A BIP39 passphrase is **not** recoverable. If you lose either the 24 words *or* the passphrase, your funds are gone forever. Most users should leave this option off until they are confident in their backup process.

If you enable the passphrase option, type your passphrase twice (in the **Passphrase** and **Confirm passphrase** fields) and write it down separately from the 24 words.

#### Confirming the backup

Once your phrase is safely written down, tick the box **I have written down my recovery phrase** and click **Next**.

### Step 3 — Verify your backup

Phoenix asks you to type three of the 24 words at random positions (for example, words 4, 11, and 19) to confirm you really wrote them down correctly.

![Step 3: verifying three of the words.](images/processed/ch05-create-step3-verify.png){width=70%}

As you type each word, an autocomplete dropdown shows matching words from the BIP39 word list. The wizard accepts only the exact word that belongs in that position. If you type the wrong word, an inline error appears beneath the field; the **Next** button stays disabled until all three are correct.

> **Tip** — If you cannot complete this step, you almost certainly mis-wrote one or more of the 24 words. Click **Back**, double-check your written copy against the phrase still shown on step 2, and correct your paper backup. **Do not proceed** until your written copy reads exactly the same as what Phoenix shows.

When all three words match, click **Next**.

### Step 4 — Optionally encrypt the wallet

Phoenix now offers to **encrypt your wallet** with a password. This is a *separate* piece of protection from the recovery phrase and the BIP39 passphrase:

- The recovery phrase is what *creates* the wallet's keys.
- The wallet password is what *unlocks* the keys for spending while the wallet is in use.

If encryption is on, Phoenix can show your balances and addresses freely (those do not require the password), but every action that *signs* a transaction — sending BTCX, signing a message, exporting private keys — prompts for the password. An encrypted wallet on a stolen laptop is much harder to drain than an unencrypted one.

![Step 4: optional wallet encryption.](images/processed/ch05-create-step4-encrypt.png){width=70%}

If you choose to encrypt, type a password twice. Choose something strong; if you forget it, you cannot move funds out of the wallet without restoring it from the recovery phrase.

> **Warning** — A wallet encryption password protects spending; it cannot recover lost funds on its own. Your *recovery phrase* is the ultimate backup. Even if you forget the wallet password, you can wipe Phoenix and re-import the wallet from the 24 words — but only if you wrote them down.

> **Warning — encryption and mining do not mix automatically.** If this wallet is going to hold the keys your miner uses to sign blocks, encryption has a real operational cost. The miner has to sign new blocks continuously, which means the wallet must be **unlocked** every time it is loaded. After any restart — a Windows update, a power blip, a reboot you scheduled — Phoenix starts back up and the wallet is locked again. **Mining will not resume until a human types the password.** Two common ways to handle this:
>
> - **Don't encrypt the mining wallet.** Accept the lower local security and rely on physical access controls. Reasonable for a dedicated mining rig in a controlled location.
> - **Split keys with a forging assignment.** Keep an encrypted "owner" wallet that holds the actual rewards, and assign forging rights to a separate, unencrypted "mining" wallet running on the rig. The mining wallet only ever sees the forging key; theft of the rig does not move the rewards. Forging assignments are covered in Chapter 19.
>
> If this wallet will not be used for mining, this trade-off does not apply to you — encrypt freely.

Click **Create wallet**. Phoenix shows a brief progress bar while Bitcoin-PoCX Core builds the wallet, then takes you straight to the dashboard (Chapter 6).

## Importing an existing wallet

If you already have a 12- or 24-word recovery phrase from a previous Phoenix install, an old Bitcoin-PoCX wallet, or a hardware wallet that exposes its phrase, click **Import** instead of Create New. The wizard is similar but only three steps — the verification step is unnecessary because you already have the phrase.

### Step 1 — Name your wallet

Same as creating: type a recognisable name and click **Next**.

### Step 2 — Enter your recovery phrase

Pick the right length first. A toggle at the top switches between **12 words** and **24 words**; click the option that matches your phrase. Phoenix re-arranges the input grid accordingly.

![Importing a wallet: entering an existing recovery phrase.](images/processed/ch05-import-step2-words.png){width=70%}

Type each word in its corresponding numbered slot. As you type:

- An **autocomplete dropdown** suggests matching BIP39 words. You can click a suggestion to fill the field.
- After you leave a field, Phoenix marks it with a small red **error icon** if the word you entered is not a valid BIP39 word — usually a typo.
- Once every slot is filled, Phoenix runs a **checksum check**: the last word of a BIP39 phrase encodes a fingerprint of the others. A *checksum invalid* warning means at least one word is wrong somewhere in the phrase, even if every individual word is in the dictionary. Re-check carefully against your written copy.

If your original wallet used a BIP39 passphrase (the 25th word), tick the **Use BIP39 passphrase** option below the grid and type the passphrase. Without the original passphrase, you will end up with an empty, parallel wallet rather than the one you expect.

When the **Next** button becomes active, click it.

### Step 3 — Optional encryption + rescan

Same encryption choice as for new wallets. Below the encryption section, an information note reminds you that an imported wallet **automatically rescans the blockchain** to discover its prior transactions. This rescan can take a while — anywhere from a few minutes to a couple of hours, depending on how long the wallet has been active and how busy the chain is. The rescan runs in the background; you can keep using Phoenix while it works.

Click **Import wallet**. Phoenix imports the keys and starts the rescan. The dashboard opens immediately, balances and history may take some time to appear in full.

> **Tip** — If you are importing a wallet that you know has only ever been used recently, the rescan is fast. If you are importing a wallet that has been around for years, leave Phoenix running until the rescan finishes — interrupting it just means it has to start again next time the wallet is loaded.

#### Restore finds funds on every derivation branch

You do not have to know how your phrase was originally set up. A recovery phrase can hold funds on several *derivation branches* — different address types (SegWit, taproot, legacy) and different *coin types* (see below) — and Phoenix restore imports **all** of them, so no funds stay hidden on a branch you did not know about. When the import finishes, Phoenix shows a short **branch report** — *"Funds found on: …"* — naming which branches held coins (for example *legacy desktop* and *mobile*). You do not need to choose or configure anything; the scan is automatic.

> **Note — the BTCX coin type.** Bitcoin-PoCX has its own registered *coin type* (SLIP-44 `1347371864`), and **new** wallets use it automatically. Older wallets — and wallets from some other tools — were derived under Bitcoin's original coin type `0'`. This is invisible in day-to-day use: you never enter or see a coin type, new wallets simply use the BTCX one, and **restore finds funds under either**. There is nothing for you to do; the distinction is noted only so the *legacy desktop* / *mobile* labels in the branch report make sense.

## Setting up a watch-only wallet

A watch-only wallet contains *no private keys*. It cannot send. It can only observe individual addresses, or whole families of addresses described by an *output descriptor*, and report what arrives, what leaves, and the resulting balance. This is what you use when you want to keep an eye on a cold-storage wallet from a regular machine without ever exposing the spending keys.

Click **Watch Only** on the Wallets screen. The three-step wizard:

1. **Name your wallet** — same as the other flows.

2. **Add entries.** Type or paste one entry at a time and click **Add**. Phoenix accepts two kinds of entry:

    - **A Bitcoin-PoCX address** — a single address such as `pocx1q…` (mainnet) or `tpocx1q…` (testnet). Phoenix will watch it for incoming and outgoing activity.
    - **An output descriptor** — Bitcoin Core's expression language for describing a whole family of addresses derived from an extended public key. Recognised wrappers include `wpkh(…)`, `wsh(…)`, `tr(…)`, `sh(…)`, `pkh(…)`, `addr(…)`, and `combo(…)`. The descriptor must end with its `#checksum` suffix; Phoenix verifies the checksum and rejects the entry if it does not match.

    > **Note** — **A bare extended public key (`xpub…`, `ypub…`, `zpub…`, or their testnet equivalents `tpub…`, `upub…`, `vpub…`) is not accepted on its own.** Phoenix needs to know *how* to derive addresses from the key, which is precisely what the descriptor wrapper expresses. To watch a hardware wallet's xpub, wrap it in the descriptor function that matches its address type, with a derivation path — for example `wpkh(xpub6…/<0;1>/*)#checksum`. Most hardware wallets export this form directly; consult the wallet's documentation for the exact descriptor it produces.

    Phoenix also checks that each entry belongs to the network you are currently connected to. A mainnet address pasted into a testnet wallet is rejected with a clear *wrong network* message. Duplicate entries are also rejected.

3. **Choose a rescan strategy and finish.** A descriptor or address only becomes useful once Bitcoin-PoCX Core knows about its on-chain history. The wizard offers three options:

    - **Rescan from now** — watch from the current block forward; do not scan back. The fastest option, but you will not see any existing balance or prior transactions.
    - **Rescan from a date** — pick a calendar date; Phoenix scans from the block at that date forward. A good middle ground when you know roughly when the address was first used.
    - **Rescan from genesis** — the most thorough option. Re-reads every block from the start of the chain. Can take a long time on mainnet.

    Pick what suits you and click **Create wallet**. Phoenix imports the entries into Bitcoin-PoCX Core and starts the chosen rescan in the background.

The watch-only wallet appears in the Wallets list with a distinctive **eye icon** instead of a lock. You can open it just like any other wallet, but the Send screen is disabled — there is nothing for it to sign with.

> **Tip** — A watch-only wallet of your *forging address* is a useful companion to a separate cold wallet that holds the keys: you can monitor incoming block rewards from any computer, while the spending keys stay offline.

## Setting up a multisig wallet

A *multisig* (multi-signature) wallet spreads control of the funds across several independent keys, held by several people or several devices, and requires more than one of them to authorise any spend. A **2-of-3** wallet, for example, has three key holders; any two of them together can spend, but no single one can. This is the standard tool for shared treasuries, family funds, and self-custody setups where you want a lost or stolen single key to be survivable rather than catastrophic.

Phoenix builds standard **P2WSH `sortedmulti`** multisig wallets — the widely interoperable form — so the wallet you create here can be co-signed with, and recovered by, other Bitcoin descriptor wallets that follow the same standard.

> **Note** — Every participant runs *this same wizard* on their own machine, each with their own separate seed, and everyone enters the same set of public keys and the same policy. Because they all describe the identical wallet, they all derive the identical addresses. There is no "server" that holds the wallet; it exists independently on each participant's computer.

Click **Multisig** on the Wallets screen (the fourth button, with a group-of-people icon; it stays disabled until Bitcoin-PoCX Core is connected). The wizard has **five steps**: *Multisig Policy → Your Seed → Verify Backup → Exchange Keys → Review & Create.*

![The multisig wizard, step 1: the policy — wallet name and the *M-of-N* selectors.](images/processed/ch05-multisig-policy.png){width=70%}

### Step 1 — Multisig Policy

Two things are set here:

- **Wallet name** — a recognisable label, for example *"treasury-2of3"*. As with the other flows, Phoenix rejects a name that clashes with an existing wallet (*"A wallet with this name already exists"*).
- **The policy** — two dropdowns reading **Required signatures** *of* **Total keys**. *Total keys* is the number of participants (2 through 7); *Required signatures* is how many of them must sign to spend. The default is **2 of 3**. If you lower *Total* below the current *Required*, Phoenix clamps *Required* down to match.

An explanatory line spells the policy out in words — *"any 2 of the 3 key holders can spend"* — and reminds you that every participant must complete the wizard with the same keys, so you will need the **public keys** of your co-signers.

### Step 2 — Your Seed

Each participant contributes one key, derived from their own recovery phrase. Choose how you supply yours:

- **Create a new seed for this multisig** *(default)* — Phoenix generates a fresh **24-word recovery phrase**, shown as numbered chips exactly as in the create-wallet flow. Write it down (the warning here is emphatic: without these words *and* the co-signer public keys, your share of the wallet cannot be recovered), then tick **I have written down my recovery phrase**. **Generate new** throws the phrase away and produces another.
- **I already have a seed (restore or rejoin)** — enter an existing 12- or 24-word phrase, with the same autocomplete and checksum checking as the Import flow. Use this to rejoin a multisig you already belong to, or to restore one.

> **Note** — The multisig wizard does **not** offer a BIP39 passphrase (25th word); each seed is used on its own.

### Step 3 — Verify Backup

For a *new* seed, Phoenix asks you to type three of the 24 words at random positions, just like the create-wallet flow, to confirm your written copy is correct. For a *restored* seed this step is skipped — you already have the phrase — and the wizard simply notes *"Seed entered manually — no verification needed."*

### Step 4 — Exchange Keys

This is the collaborative step. Phoenix derives your wallet's **public key** from your seed (an *extended public key*, or xpub, annotated with its origin — it looks like `[fingerprint/48h/0h/0h/2h]xpub…`). A public key can be shared freely: it lets others build the shared wallet and watch it, but it cannot spend anything on its own.

![Step 4: your own public key to share, and the field for pasting each co-signer's key.](images/processed/ch05-multisig-keys.png){width=70%}

- **Your key** is shown in a monospace box with **Copy key** and **Save as file** buttons. Send it to your co-signers by whatever channel you like — it is not secret.
- **Co-signer keys** — paste each co-signer's key (exactly as they sent it) and click **Add**. A running counter shows how many of the required co-signers you have entered. Phoenix validates every key and refuses:
    - anything that is not a public key (*"expected [fingerprint/path]xpub… or a bare xpub"*);
    - a **private** key — *"This is a private key — never share private keys"* (a co-signer who sends you an `xprv` has made a serious mistake);
    - a key for the **wrong network**;
    - a key with a **bad checksum** (usually copied incompletely);
    - **your own** key, or a **duplicate** of one already added.

The **Next** button unlocks only once you have added exactly the right number of co-signers (*Total keys* minus one — the missing one is you).

### Step 5 — Review & Create

![Step 5: the review — policy, the addresses to verify with your co-signers, and the descriptor backup.](images/processed/ch05-multisig-review.png){width=70%}

The final step summarises the wallet: the policy (*"2 of 3 · P2WSH (sortedmulti)"*), the name, and the keys (*You* plus your co-signers, by fingerprint).

> **Warning — verify the addresses before funding.** Under **Verify with your co-signers**, Phoenix lists the wallet's first few receive addresses. These **must be byte-for-byte identical on every participant's machine.** Compare them out loud or over a trusted channel with your co-signers *before anyone sends funds in.* If they differ, someone entered a wrong key or a different policy — do not fund the wallet until they match.

Two more controls before you finish:

- **Save descriptor backup** downloads a text file with the wallet's public descriptors. This is an essential companion to your seed: restoring a multisig wallet needs *both* a participant seed *and* the full set of public keys. Keep this file with your written recovery phrase. The on-screen note repeats the point.
- **Encrypt wallet** — the same optional password protection offered in the other flows.
- If you *restored* an existing seed, a **Rescan** choice appears (rescan from now, or from genesis) so Core can rediscover the wallet's history.

Click **Create Wallet**. Phoenix builds the wallet in Core and opens the dashboard with it active.

### Living with a multisig wallet

A multisig wallet appears in the Wallets list and the toolbar selector with a **purple group icon** and a tooltip naming its policy (*"2-of-3 multisig wallet"*).

Because spending needs several signatures, the ordinary one-click **Send** screen is **disabled** for a multisig wallet — one machine cannot produce a complete signature on its own. Instead, multisig wallets spend through the **Transaction Builder**, which builds a partially-signed transaction (a PSBT) that each co-signer signs in turn until the threshold is met. That workflow is covered in Chapter 8.

> **Warning** — Every co-signer must keep their own seed *and* the descriptor backup safe. Losing one participant's seed in a 2-of-3 wallet is survivable (the other two can still spend and re-secure the funds); losing enough seeds to drop below the threshold makes the funds permanently unspendable. Treat each share with the same care as a single-wallet recovery phrase.

## Two layers of protection, one ultimate backup

Phoenix offers three security primitives that are easy to confuse. They serve different purposes:

| Mechanism                    | Protects against…                                                  | If you lose it…                                            |
|------------------------------|--------------------------------------------------------------------|------------------------------------------------------------|
| **24-word recovery phrase**  | Anything happening to your computer or the wallet file.            | Funds are unrecoverable.                                   |
| **BIP39 passphrase** *(25th word)* | Someone finding your written 24 words (without the passphrase, they only see an empty wallet). | Funds are unrecoverable, even with the 24 words.           |
| **Wallet encryption password** | Local thieves and casual attackers — nobody can sign without it.  | Wallet must be wiped and re-imported from the recovery phrase. |

The recovery phrase is the only one that can rebuild your wallet from scratch. Everything else is a layer of *active-use* protection. Treat the phrase accordingly.

Chapter 11 — *Backup, Security & Recovery* — covers this in more depth, including practical guidance on storing the phrase, using metal backup plates, and testing a restore.

## After your wallet is created

When the wizard finishes, Phoenix opens the **Dashboard** — the main wallet view. You will see your wallet name in the top-left corner, an empty balance (until you receive your first BTCX or your import rescan completes), and a sidebar with **Receive**, **Send**, **Transactions**, **Mining**, and **Settings**. Chapter 6 takes a guided tour of this view.

If you came here to mine, your next stop is **Receive** (Chapter 7) — you will need at least one of your own addresses for plotting in Chapter 16.

## Working with multiple wallets

Coming back to the Wallets screen at any time (via the toolbar) shows every wallet you have ever created or imported. Each row tells you:

- **Status** — *Loaded* (Bitcoin-PoCX Core has the wallet open and is tracking it) or *Not loaded* (the wallet exists on disk but is not currently active).
- **Name** — what you called it.
- **Balance** — only shown for loaded wallets; *not loaded* wallets read `--`.
- **Encryption icon** — a lock means the wallet is encrypted and locked for the session, an open lock means encrypted and unlocked, an eye means watch-only, and `--` means not currently loaded.

The **Load** / **Unload** button on each row toggles whether Bitcoin-PoCX Core is actively tracking that wallet. Unloading a wallet you are not currently using saves a small amount of memory; loading is fast and safe.

Click any row to select it, then click **Open Wallet** at the bottom-right to set it as the active wallet for the rest of Phoenix. If you click an unloaded row first, opening it will load it automatically.

> **Tip** — Encrypted wallets stay locked until you explicitly unlock them for the session (click the lock icon in the row, type the password). Unlocking lets you sign transactions for the duration of the session without re-entering the password each time. The session can be ended manually by clicking the open-lock icon to lock again.

## What's next

You now have a wallet — your keys, your name, optionally encrypted, optionally protected by a BIP39 passphrase, and (for an import) busy rescanning history. The next chapter takes you on a guided tour of Phoenix's main interface so you know where everything lives before we start sending and receiving in Chapter 7.
