# Pool Discovery — DNS-SD Operator Setup

Phoenix PoCX wallets (>= TBD) discover pools at runtime via DNS-SD
(RFC 6763). This document is for operators of the authority zones
(`bitcoin-pocx.org`, `bitcoin-pocx.bootseed.net`) who need to add,
remove, or reorder pools.

## What this does

When a user opens the chain modal in the setup wizard, the wallet
queries `_pool._tcp.<authority>` (or `_pool._tcp.testnet.<authority>`
for testnet) on a randomly chosen authority. Authorities are mirrors —
both should publish identical content. The wallet shows the merged
list of static (hardcoded fallback) + discovered pools, sorted by SRV
priority ascending.

## Authority responsibilities

- Mirror the same content across both authorities.
- Use TTL 300s so changes propagate within five minutes.
- Coordinate with pool operators before promoting / demoting / removing.

## Adding a pool — copy-paste recipe

Three records per pool:

```dns
_pool._tcp                IN PTR  <slug>._pool._tcp.<authority>.
<slug>._pool._tcp         IN SRV  <prio> <weight> 443 <pool-host>.
<slug>._pool._tcp         IN TXT  "name=<Display Name>" "operator=<Operator>"
```

Replace `<slug>`, `<prio>`, `<pool-host>`, `<Display Name>`, `<Operator>`.
For testnet, prefix the names with `testnet.`.

Worked example (operator `Acme` adds pool `acme-pool.example.com` to mainnet
on `bitcoin-pocx.org`, with priority 20 because it's a large pool):

```dns
$ORIGIN bitcoin-pocx.org.
_pool._tcp        IN PTR  acme._pool._tcp.bitcoin-pocx.org.
acme._pool._tcp   IN SRV  20 100 443 acme-pool.example.com.
acme._pool._tcp   IN TXT  "name=Acme Mainnet" "operator=Acme"
```

(Repeat the same three records on `bitcoin-pocx.bootseed.net`.)

## Removing a pool

Delete all three records (PTR, SRV, TXT). The wallet's hardcoded
fallback list still includes the original three pools (Nogrod Mainnet,
CryptoGuru Mainnet, Nogrod Testnet), so they cannot be hidden via DNS —
only demoted or supplemented.

## Setting priority for decentralization

Lower SRV priority = preferred (RFC 2782). To rebalance load toward
smaller pools, set the small pool to e.g. `10` and the larger to `20`.
Within equal priority, higher SRV weight wins — useful for fine-grained
percentage splits.

Example: if the network operator wants new miners defaulting to the
smaller pool, publish:

```dns
small._pool._tcp   IN SRV  10 100 443 small-pool.example.com.
big._pool._tcp     IN SRV  20 100 443 big-pool.example.com.
```

The wallet sorts by priority ascending, so `small-pool` appears at the
top of the dropdown.

## Testing

```bash
dig +short PTR  _pool._tcp.bitcoin-pocx.org
dig +short SRV  acme._pool._tcp.bitcoin-pocx.org
dig +short TXT  acme._pool._tcp.bitcoin-pocx.org
```

Compare both authorities — they should return identical sets:

```bash
dig @ns.bitcoin-pocx.org +short PTR _pool._tcp.bitcoin-pocx.org
dig @ns.bitcoin-pocx.bootseed.net +short PTR _pool._tcp.bitcoin-pocx.bootseed.net
```

For testnet:

```bash
dig +short PTR _pool._tcp.testnet.bitcoin-pocx.org
```

## TXT key reference

| Key | Required | Notes |
|------|--------|------|
| `name` | yes | display label in the dropdown |
| `operator` | no | shown as subtitle / tooltip |
| `url` | no | overrides default `https://{host}:{port}` |
| anything else | no | preserved in `extras` for future UI use |

Per RFC 6763 §6.4: keys are case-sensitive, duplicate keys keep the
**first** occurrence, and entries with empty keys are ignored.

## Troubleshooting

- **TTL too low** → DNS chatter; we recommend 300s (5 minutes).
- **Port 53 blocked** on a user's network → wallet falls back to the
  static list and shows a toast. v1 has no DoH support.
- **Mirror drift** → wallet uses whichever authority responded first;
  the other's data is silently ignored. Periodically diff zone files
  to catch unintended drift.
- **Unicode in TXT values** → DNS-SD §6.4 specifies that values are
  raw bytes; the wallet treats them as UTF-8 with lossy fallback.
  Stick to ASCII display names if possible.
