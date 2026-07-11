# Running Your Own Node (External Mode)

By default, Phoenix downloads and manages Bitcoin-PoCX Core for you (Chapter 4). For most users that is exactly right — there is nothing to configure and nothing to maintain. But Phoenix can also connect to a Bitcoin-PoCX Core instance that *you* run and manage yourself. This is **external mode**, and this chapter covers when to use it and how to set it up.

External mode is an advanced topic. If managed mode works for you, you can skip this chapter entirely — you lose nothing by letting Phoenix handle the node.

## Managed vs. external, recapped

The two modes differ only in *who runs the node*:

| | Managed mode | External mode |
|---|---|---|
| **Who installs the node** | Phoenix, automatically | You |
| **Who starts/stops it** | Phoenix | You (or your system's service manager) |
| **Who updates it** | Phoenix, on prompt | You |
| **Where it runs** | The same machine as Phoenix | Anywhere Phoenix can reach over the network |
| **Best for** | Almost everyone | Advanced users with a specific reason |

In both modes, the node is the same Bitcoin-PoCX Core software and the wallet still lives inside it (Chapter 6). External mode just hands you the controls.

## Why run your own node

A few legitimate reasons to take over the node yourself:

- **A node you already run.** If you operate a Bitcoin-PoCX Core node for other purposes — a server that is always on, a node you have tuned — you may want Phoenix to use it rather than installing a second one.
- **A shared node.** One node on a home server, used by Phoenix on several of your machines, avoids each machine downloading and storing its own copy of the blockchain.
- **Custom configuration.** You need node settings Phoenix's managed mode does not expose — specific networking, pruning choices, an unusual data directory, extra indices.
- **Separation of concerns.** You want the node's lifecycle (updates, restarts, monitoring) managed by your own tooling rather than by the wallet.

If none of these apply, managed mode is simpler and just as capable for everyday use.

## Preparing your node

External mode assumes you have a working Bitcoin-PoCX Core instance. Configuring and running Core itself is beyond this handbook — refer to the Bitcoin-PoCX Core documentation — but Phoenix needs a few things to be true of it.

### The node must accept RPC

Phoenix talks to the node over JSON-RPC, so the node must have its RPC server enabled. In Bitcoin-PoCX Core's configuration file (`bitcoin.conf`), this means at minimum:

```ini
server=1
```

### Authentication: cookie or user/password

Phoenix needs credentials to make RPC calls. Bitcoin-PoCX Core offers two mechanisms, and Phoenix supports both.

- **Cookie authentication (recommended for a local or trusted node).** Core writes a `.cookie` file into its data directory each time it starts; any client that can read that file is authenticated. Nothing to configure in `bitcoin.conf` — cookie auth is on by default — but Phoenix must be able to *read* the data directory, so this works best when the node is on the same machine as Phoenix, or the data directory is otherwise accessible.

- **User and password.** For a node Phoenix reaches over the network, where the cookie file is not accessible, set explicit credentials in `bitcoin.conf`:

  ```ini
  server=1
  rpcuser=your_username
  rpcpassword=your_strong_password
  ```

  Use a long, random password — this credential grants control of the wallet.

> **Tip** — Prefer cookie authentication whenever Phoenix can read the node's data directory; it rotates automatically and there is no static password to leak. Reserve user/password for genuinely remote nodes.

### Networking, for a remote node

If the node runs on a *different* machine from Phoenix, Core must accept RPC connections from Phoenix's address. That typically means setting `rpcbind` and `rpcallowip` in `bitcoin.conf` to permit your LAN, and allowing the RPC port through the node host's firewall. As with the aggregator (Chapter 24), do not expose the RPC port to the public internet — RPC access is wallet access.

## Pointing Phoenix at your node

External mode is selected and configured in two places: the first-launch wizard (Chapter 4) or, at any time afterwards, **Settings → Node Configuration** (Chapter 12). The fields are the same either way.

1. Set the connection mode to **External**.
2. Choose the **network** — *Mainnet*, *Testnet*, or *Regtest* — to match what your node runs.
3. Fill in the **connection settings**:
   - **RPC host** — `127.0.0.1` for a node on the same machine, or the node host's LAN address for a remote node.
   - **RPC port** — the port your node's RPC server listens on (the network default, or whatever you set with `rpcport=`).
4. Choose the **authentication** method:
   - **Cookie** — supply the node's **data directory** so Phoenix can find the `.cookie` file, and the **testnet subdirectory** name if you are on testnet (default `testnet`).
   - **User/password** — supply the `rpcuser` and `rpcpassword` from the node's `bitcoin.conf`.

![External mode in Settings: host, port, authentication, and Test connection.](images/processed/ch12-settings-external.png){width=98%}

### Test the connection before saving

The external-mode panel has a **Test connection** button. Click it before saving: Phoenix makes a lightweight RPC call and, on success, reports the node's **version**, **chain**, and **block height**. This confirms three things at once — the address and port are right, the credentials work, and the node is on the network you expect.

If the test fails, the common causes are: the node is not running, RPC is not enabled (`server=1` missing), the credentials are wrong, the host or port is mistyped, or a firewall is blocking the connection. Chapter 27 covers diagnosis.

Once the test passes, save. Phoenix connects to your node and behaves exactly as it does in managed mode — the wallet, sending, receiving, mining, and everything else work the same way. The only difference is that Phoenix no longer starts, stops, or updates the node; that is now your responsibility.

## What changes in external mode

A few behavioural differences are worth knowing once you are running external:

- **No node status controls.** The managed-mode Start/Stop/Restart buttons and the node-update flow (Chapter 12) do not apply — Phoenix does not manage the node's lifecycle. The toolbar's node-status indicator (Chapter 6) is also hidden, since Phoenix is a client of your node, not its manager.
- **You handle updates.** When a new Bitcoin-PoCX Core version is released, you update your node yourself. Phoenix will keep working against a compatible node version; a node far out of date may eventually lag the network.
- **You handle uptime.** If your node is down, Phoenix cannot reach the network — the Wallets screen shows a connection error (Chapter 5) with options to retry or re-run setup. Keep the node running for Phoenix to function.
- **The node can serve more than Phoenix.** Because it is your own node, other software (including other Phoenix instances, or a mining setup) can share it — which is often the reason to run external mode in the first place.

## Mining against an external node

Mining works the same in external mode, with one thing to keep in mind: solo mining requires the node to be reachable and synced, exactly as in managed mode. The mining setup wizard's solo chain talks to whatever node Phoenix is connected to — managed or external. If you run a dedicated always-on node and point several mining machines at it (or aggregate them, Chapter 24), external mode is how each machine reaches that shared node.

There is one requirement that is easy to overlook with a shared or remote node: **the node's wallet must hold the signing key for your plots.** When the miner finds a winning deadline, the *node* is what signs and forges the block — and it can only do that if its loaded wallet controls the **effective signer** for the plot address (Chapter 13): either the plot address's own key, or the forging address's key if a forging assignment is in place (Chapter 19). A node that does not hold that key will accept your deadline but be unable to sign the block, so the would-be block is never produced (the same failure mode described in Chapter 11).

In practice this means: if you point Phoenix at an external node for solo mining, make sure the wallet you intend to mine with — the one holding your plotting address, or the assigned forging address — is created or imported *on that node*, and loaded. For a managed node this happens naturally because the wallet you created in Chapter 5 lives in the node Phoenix manages; for an external node, the keys must be present in *that* node's wallet, not merely in some other wallet on your Phoenix machine.

## What's next

External mode and managed mode both assume a full Bitcoin-PoCX Core node — Phoenix's, or your own. The final chapter of Part IV covers the third option, which needs no local node at all: **Chapter 26 — Running Without a Local Node (Remote Mode)** connects the wallet to public Electrum servers instead, so it runs on a laptop or a phone with no blockchain to download.

After that, Part V is reference material: **Chapter 27 — Troubleshooting** works through the problems you are most likely to hit and how to diagnose them, including where Phoenix keeps its logs and how to wipe data directories cleanly. Chapters 28 to 30 are the FAQ, glossary, and where to get help.
