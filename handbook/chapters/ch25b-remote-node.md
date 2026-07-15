# Running Without a Local Node (Remote Mode)

Managed mode (Chapter 4) and external mode (Chapter 25) both assume a full **Bitcoin-PoCX Core** node — one Phoenix installs and runs, or one you run yourself. Both download and validate the entire blockchain, which costs disk space, bandwidth, and an initial sync that can take hours.

**Remote mode** is the third option, and it needs no local node at all. Instead of running Core, Phoenix keeps a lightweight wallet *on your own computer* and reaches the network through public **Electrum servers**. There is no blockchain to download and nothing to sync from scratch — the wallet is usable within seconds of being created. This is the mode that makes Phoenix practical on a laptop, on a machine with little spare disk, and (as Chapter 23 describes) on a phone.

This chapter explains what remote mode is, when to choose it, how to configure the servers it talks to, the trust model you are accepting, and the handful of things it deliberately cannot do.

## What remote mode actually is

In remote mode there is no `bitcoind` process anywhere in the picture. Two pieces replace it:

- **A local wallet, on your computer.** Phoenix keeps a self-contained wallet — its keys, addresses, and transaction history — in its own data directory on the machine you are using. The keys never leave the device. Every transaction you send is built and signed *locally*, exactly as a hardware or mobile wallet does.
- **Electrum servers, on the network.** To learn what has arrived, what has confirmed, and to broadcast the transactions it signs, the wallet talks to one or more Electrum servers — lightweight indexers that answer "what is the history of this address?" and "please relay this transaction." Phoenix ships with a default Bitcoin-PoCX server and lets you add your own.

The result behaves like an ordinary Phoenix wallet — dashboard, receive, send, history, contacts, forging assignments, and the Transaction Builder all work — but with no node to install, sync, or maintain.

> **Note** — Remote mode is sometimes labelled the *nodeless* or *Electrum* wallet in the interface. The three terms mean the same thing: a wallet that runs against remote servers instead of a local Bitcoin-PoCX Core.

## When to choose remote mode

Remote mode is the right choice when running a full node is impractical or unnecessary:

- **You just want a wallet.** To send, receive, and hold BTCX — without mining, and without waiting for a multi-hour blockchain sync — remote mode is the fastest path from install to a usable wallet.
- **The machine is small.** A laptop, a low-disk desktop, or a phone (Chapter 23) cannot comfortably store and validate the whole chain. Remote mode asks for almost no disk.
- **You want to pool-mine from a light machine.** Pool mining does not need a local node — the pool signs and forges. Remote mode supports pool mining and the on-chain forging assignment it requires (Chapter 19), so a plotting-and-mining machine can run nodeless.

Choose **managed** or **external** mode instead when you want the strongest trust model, or when you intend to **solo mine** — solo mining forges blocks locally and requires a full node, which remote mode does not provide (see *What remote mode cannot do*, below).

## Choosing remote mode

Remote mode is selected in the same two places as the other node modes: the first-launch wizard (Chapter 4) or, at any time afterwards, **Settings → Node Configuration** (Chapter 12).

In the first-launch wizard, the mode question — *"How would you like to connect to the Bitcoin-PoCX network?"* — offers a third card alongside Managed and External:

> **Remote Node (Electrum)** — *No local blockchain — the wallet connects to Electrum servers and stores wallets locally on this computer. Solo mining is unavailable; pool mining works.*

Pick it and continue. There is no node to download, so the install step (Chapter 4) is skipped entirely; Phoenix goes straight to configuring servers and then to creating or restoring a wallet.

## Configuring Electrum servers

A remote wallet is only as reachable as the servers it can talk to. Phoenix keeps an **ordered list** of Electrum endpoints, edited under **Settings → Node Configuration** (in remote mode) or during first-launch setup.

- **The first server is the primary.** The wallet syncs through it in normal operation.
- **The rest are failovers.** If the primary becomes unreachable, Phoenix falls over to the next server in the list, and the toolbar indicator (below) shows that it is running on a backup.

Each network keeps its **own** server list and its own wallet data — switching between mainnet, testnet, and regtest switches both.

### Adding and testing a server

Each entry is a URL in one of two forms:

```
ssl://host:port      (TLS-encrypted — recommended)
tcp://host:port      (plain TCP)
```

Prefer `ssl://` where the server offers it: it encrypts the link so a network observer cannot read which addresses you are querying in transit. Type or paste the URL, and use **Test connection** to confirm the server is reachable before you rely on it — Phoenix makes a lightweight query and reports success or failure. **Remove server** deletes an entry; the order of the remaining entries is the failover order.

### The default server

For **mainnet**, Phoenix ships with a default Bitcoin-PoCX Electrum server already in the list, so a fresh remote wallet works out of the box with nothing to configure. You can leave it as the primary, add your own servers ahead of it, or remove it entirely and run only against servers you trust.

For **testnet** and **regtest** the list starts empty — add the URL of the server you are testing against (for regtest, that is typically your own local indexer).

> **Tip** — If you run your own Electrum indexer for Bitcoin-PoCX, put it first in the list and keep the public server below it as a failover. You then get the privacy of querying your own server, with the resilience of a public backup if yours goes down.

## The trust model — what a server can and cannot do

Remote mode trades a little trust for a lot of convenience. It is important to understand exactly where that trust sits, because it is narrower than it first appears.

**A server cannot steal from you.** Your keys never leave your computer, and every transaction is signed locally before it is handed to a server merely to relay. A malicious or compromised server cannot move your funds, redirect a payment, or forge a signature. The worst it can do is *refuse* to broadcast a transaction — at which point Phoenix fails over to another server.

**A server can lie about what it sees — but not convincingly, and not to your cost.** An Electrum server reports address histories and confirmation counts. A dishonest one could *withhold* a transaction (claim you have not been paid when you have) or *misreport* how many confirmations something has. Phoenix verifies the chain's block headers, so a server cannot fabricate a payment that the network never accepted or invent a longer chain than exists. The realistic failure is a server that is stale, buggy, or selectively quiet — an availability and freshness problem, not a theft one. Running more than one server, and preferring one you control, mitigates it.

**A server also supplies your fee estimates — so Phoenix guards against an inflated one.** In remote mode the fee presets on the Send screen come from the Electrum server, and a faulty or hostile one could return an absurdly high rate to make you overpay. To catch this, when a preset rate resolves above 200 sat/vB the send confirmation dialog shows a warning — *"This fee is unusually high (N sat/vB). A faulty or hostile server can inflate fees."* — and makes you tick an acknowledgement before it will send (Chapter 8). A rate you type yourself under **Custom** is never second-guessed. Treat the warning as a prompt to switch servers and re-check.

**A server sees your addresses.** To answer "what is the history of this address?", the server necessarily learns which addresses you are asking about — and can associate them with your network connection. This is the genuine privacy cost of any light wallet. Two things soften it: Bitcoin-PoCX wallets use a distinct coin type (see the glossary), so the same recovery phrase used on another Bitcoin-family chain does not produce publicly linkable addresses; and you can point the wallet at a server *you* run, which removes the third party altogether.

In short: **the chain is verified, the keys are local, so a server can inconvenience you but cannot rob you.** That is the trade you are making when you skip the local node.

## What works in remote mode

Nearly all of Phoenix works unchanged. Because the wallet is a first-class local wallet, the pages you use every day behave exactly as the earlier chapters describe:

- **Receive, send, history, and contacts** (Chapters 7–10) all work. Sending builds and signs the transaction locally, then broadcasts it through your Electrum server — no local node required.
- **Multiple named wallets** — create, restore, rename, and delete wallets, and switch between them, all covered later in this chapter.
- **Forging assignments** (Chapter 19) work. Phoenix builds, signs, and broadcasts the assignment transaction itself, using one of your plot address's own coins as proof of ownership, and derives the assignment's status from the address's on-chain history. The same activation and revocation delays apply (about 30 blocks to activate, about 720 to revoke).
- **The Transaction Builder** (Chapter 8) composes, signs, finalizes, and broadcasts PSBTs. In remote mode the broadcast step targets your Electrum server instead of a local node — *"Broadcast through a remote server — no local node required."*
- **Pool mining** (Chapters 15, 19) works. The mining setup wizard offers pool and custom chains; combined with a forging assignment, a remote-mode machine can plot and mine into a pool.

## What remote mode cannot do

A few capabilities depend on a full node and are therefore disabled or limited when you run nodeless. Phoenix hides or greys out what does not apply rather than letting it fail:

- **Solo mining is unavailable.** Forging a block yourself means building and validating it locally, which is a full node's job. The mining wizard's **solo** option is disabled in remote mode — *"Solo mining needs a local node — not available in remote (Electrum) mode."* Pool mining, which offloads forging to the pool, works fine.
- **The Blocks explorer and Peers page are hidden.** Both read data only a full node has (block-by-block detail; the node's peer connections). In remote mode the sidebar does not show them, and navigating to them redirects to the dashboard.
- **Some advanced Transaction Builder options are not yet available.** Manual coin (UTXO) control, `OP_RETURN` data outputs, custom locktime, a custom change address, subtract-fee, and the *Join* (CoinJoin-style) merge are node-backed features that remote mode does not expose yet — *"Coin control, OP_RETURN data, locktime, custom change and subtract-fee are not available in remote mode yet."* Ordinary composing, signing, combining, finalizing, and broadcasting all work.

Everything else — the wallet, sending and receiving, history, contacts, pool mining, and forging assignments — is fully available.

## The Electrum status indicator

In remote mode the toolbar's node indicator (Chapter 6) is replaced by an **Electrum status** indicator, since there is no local node to report on. Its state tells you at a glance how the wallet's connection to the network is doing:

| State | Means… |
|-------|--------|
| **Electrum connected** | The wallet is synced through its primary server. |
| **Primary Electrum server down — using a failover** | The primary is unreachable; Phoenix has fallen back to a backup server. The wallet still works — consider checking the primary. |
| **Electrum disconnected** | No configured server is reachable. Balances and history are frozen at the last sync and sending will fail until a server comes back. |
| **Connecting to Electrum…** | A sync or reconnect is in progress. |

Hovering the indicator shows how recently the wallet last synced (for example *"synced 8s ago"*). The wallet re-checks its servers on a short interval, so a transient blip usually clears itself; a persistent *disconnected* state means every server in your list is unreachable — see the server configuration above and Chapter 27.

## Wallets in remote mode

Because the wallet lives on your computer rather than inside a node, remote mode has its own set of ways to create and acquire one. All of them are reached from the wallet's onboarding and settings; the choices mirror the desktop wallet flows in Chapter 5 but are handled by the local wallet rather than Core.

- **Create a new wallet.** Phoenix generates a fresh 24-word recovery phrase, has you verify it, and creates the wallet. As always, the 24 words are the only backup — write them down offline (Chapter 11).
- **Restore from a recovery phrase.** Enter an existing 12- or 24-word phrase. Because there is no local chain to rescan, Phoenix instead *probes* your configured Electrum server to find which derivation branch your phrase's history lives on, and opens the wallet on the branch that holds funds. If history turns up on more than one address type, Phoenix offers to create the second wallet too, so nothing stays hidden. (The derivation-branch story — and why a distinct coin type matters — is covered in Chapter 5 and the glossary.)
- **Import a descriptor.** Paste one or two *output descriptors* (with private key material) to import a wallet described by its descriptors rather than a phrase. One ranged descriptor is enough — Phoenix infers the change branch — or paste the external and internal descriptors together.
- **Import a single key (WIF).** Wrap a single private key as `wpkh(YOUR_WIF)` to import it as a one-address SegWit wallet — handy for sweeping a vanity address or a stand-alone plotting key. Change returns to the same address.

A **device passphrase** can encrypt the wallet's seed at rest on the machine; on a phone this is strongly recommended (Chapter 23). Named wallets can be switched, renamed, and deleted; deletion is safe — the files move to a trash folder and the recovery phrase always restores the funds. These wallet operations are described in full, with their mobile screens, in Chapter 23; on the desktop they appear in the same wallet menu and Wallets screen as the Core-backed wallets in Chapter 5.

Because a nodeless wallet holds its seed locally, the **v30 → v31 coin-type upgrade** (Chapter 5) runs *in place* here — no recovery phrase to re-type. A legacy mainnet wallet shows the **v30** badge and an **Upgrade to v31** action that creates the upgraded wallet from the same seed and switches to it, leaving the original in place. The **Check for older (v30) funds** button in the node-configuration panel (Chapter 12) re-scans the legacy branch if an upgraded wallet looks like it is missing older history.

> **Warning — remote-mode wallets are stored on this computer, not in a node.** Wiping Phoenix's data (or a *Reset wallet*, Chapter 12) removes the local wallet. As with any wallet, the recovery phrase is the ultimate backup: without it, a deleted or lost remote wallet cannot be recovered. Back up the 24 words before you fund the wallet.

## Mining in remote mode

Remote mode supports the light half of mining — **plotting and pool mining** — but not solo. The setup is the same three-step wizard as everywhere else (Chapter 15), with two consequences of being nodeless:

- **The solo chain is disabled**, as noted above. Configure a **pool** (or a custom pool-shaped chain) instead.
- **Forging still needs an assignment.** Pool mining requires an on-chain forging assignment to the pool's address (Chapter 19), and remote mode builds and broadcasts that assignment itself through your Electrum server. You need a small amount of BTCX to pay the assignment fee; most pools run a faucet for exactly this.

This is the same shape as Android (Chapter 23): a nodeless machine that plots, mines into a pool, and delegates forging — with the wallet and the assignment handled locally over Electrum.

## What's next

That completes Part IV. Part V is reference material: **Chapter 27 — Troubleshooting** works through the problems you are most likely to hit — including remote-mode connection failures — and how to diagnose them. Chapters 28 to 30 are the FAQ, glossary, and where to get help.
