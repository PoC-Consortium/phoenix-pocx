# Pool Discovery via DNS-SD — Design

**Date:** 2026-05-05
**Status:** Design (validated, ready for implementation)
**Branch (planned):** `feature/pool-discovery-dns-sd`

## 1. Motivation

Pool URLs in the setup wizard are currently hardcoded as `<option>` values in
`web-wallet/src/app/mining/pages/setup-wizard/setup-wizard.component.ts`.
Adding, removing, or rebalancing pools requires a new wallet release — slow,
and gives whoever ships the binary unilateral control of the pool list.

Goal: let the network's authorities publish the pool catalog over DNS so they
can rebalance load (e.g. promote the smaller pool to take new miners) without
shipping a wallet update, while keeping the hardcoded list as a guaranteed
fallback.

## 2. High-level approach

DNS-SD (RFC 6763 — same standard mDNS / Bonjour use) over plain UDP/53 via the
system resolver. Two mirror authorities publish the same catalog; the wallet
randomly picks one and falls back to the other on no-answer. Discovered
entries are merged with a hardcoded static list; the static list is the floor
the authorities cannot delete.

### 2.1 Decisions locked

| Decision | Choice |
|----------|--------|
| Authorities | `bitcoin-pocx.org`, `bitcoin-pocx.bootseed.net` |
| Mirror or independent | Mirror (both publish identical content) |
| Authority selection | Random one of A/B; on no-answer fall back to the other |
| Resolver | Plain UDP/53 via OS resolver (`hickory-resolver`, system feature) |
| Service label | `_pool._tcp` |
| Testnet layout | `_pool._tcp.testnet.<authority>` |
| Schema | DNS-SD: PTR enumerates instances, per-instance SRV + TXT |
| TXT format | RFC 6763 character-strings, e.g. `"name=Nogrod" "operator=Nogrod"` |
| Refresh cadence | Lazy on wizard open + manual ↻ button + persisted cache |
| Static list role | Floor (always present, priority 1000); DNS can promote/demote/add but never remove |
| Merge | Static ⊎ discovered, dedupe by `(host, port)`, sort `(priority asc, weight desc, name asc)` |
| DoH / DNSSEC | Out of scope for v1 |

## 3. DNS zone schema

Each authority publishes the same content. Mirror drift is the operator's
responsibility — the wallet will pick whichever responds and won't notice.

```dns
;; ===== bitcoin-pocx.org — MAINNET =====
$ORIGIN bitcoin-pocx.org.

_pool._tcp              IN PTR  nogrod._pool._tcp.bitcoin-pocx.org.
_pool._tcp              IN PTR  cryptoguru._pool._tcp.bitcoin-pocx.org.

nogrod._pool._tcp       IN SRV  20 100 443 pool.bitcoin-pocx.org.
nogrod._pool._tcp       IN TXT  "name=Nogrod Mainnet" "operator=Nogrod"

cryptoguru._pool._tcp   IN SRV  10 100 443 btcx-pool.cryptoguru.org.
cryptoguru._pool._tcp   IN TXT  "name=CryptoGuru Mainnet" "operator=CryptoGuru"

;; ===== TESTNET =====
_pool._tcp.testnet              IN PTR  nogrod._pool._tcp.testnet.bitcoin-pocx.org.
nogrod._pool._tcp.testnet       IN SRV  10 100 443 pool.testnet.bitcoin-pocx.org.
nogrod._pool._tcp.testnet       IN TXT  "name=Nogrod Testnet" "operator=Nogrod"
```

`bitcoin-pocx.bootseed.net` zone = byte-identical content with hostname
suffix swapped.

### 3.1 TXT key reference

| Key | Required | Notes |
|------|--------|------|
| `name` | yes | display label in the dropdown |
| `operator` | no | shown as subtitle / tooltip |
| `url` | no | overrides default `https://{host}:{port}` |
| anything else | no | preserved in `extras` for future UI use |

### 3.2 Priority semantics

Lower SRV priority = preferred (RFC 2782). To rebalance toward decentralization
the authority sets the smaller pool to e.g. `10` and the larger to `20`; the
wallet sorts ascending so the smaller pool surfaces first as the default.
Within equal priority, higher weight wins.

## 4. Architecture

New Rust module `src-tauri/src/pools/` peer to `node/` and `mining/`:

```
src-tauri/src/pools/
├── mod.rs          # exports + STATIC_POOLS + AUTHORITIES consts
├── types.rs        # PoolEntry, PoolSource, StaticPool, DnsAuthority
├── resolver.rs     # DNS-SD lookup, random A/B + fallback, TXT parsing
├── merger.rs       # static ⊎ discovered, dedupe + sort
├── cache.rs        # pools_cache.json round-trip
└── commands.rs     # list_pools, refresh_pools
```

### 4.1 Types

```rust
pub struct PoolEntry {
    pub host: String,
    pub port: u16,
    pub url: String,                       // computed: "https://{host}:{port}"
    pub name: String,
    pub priority: u16,                     // 1000 for static, 0..65535 from SRV
    pub weight: u16,
    pub source: PoolSource,
    pub extras: BTreeMap<String, String>,
}

pub enum PoolSource {
    Static,
    Discovered { authority: String },
}

struct StaticPool {
    host: &'static str,
    port: u16,
    name: &'static str,
    network: Network,
}

struct DnsAuthority {
    fqdn_mainnet: &'static str,            // "_pool._tcp.bitcoin-pocx.org"
    fqdn_testnet: &'static str,            // "_pool._tcp.testnet.bitcoin-pocx.org"
    label: &'static str,
}

const AUTHORITIES: &[DnsAuthority] = &[ /* org, bootseed.net */ ];
const STATIC_POOLS: &[StaticPool] = &[ /* the 3 from the wizard today */ ];
```

### 4.2 Tauri commands

- `list_pools(network) -> Vec<PoolEntry>` — returns cache instantly, kicks
  off background refresh, emits `pools:updated` event when fresh data lands.
- `refresh_pools(network) -> Vec<PoolEntry>` — synchronous fresh lookup,
  updates cache, returns the merged list.

### 4.3 Resolver flow

1. `pick_authority_order()` — `[A, B]` shuffled with `rand::thread_rng()`.
2. Try first authority:
   1. PTR lookup at `_pool._tcp[.testnet].<authority>`.
   2. For each PTR target, `tokio::join!(srv_lookup, txt_lookup)` in parallel.
   3. Parse SRV → host/port/priority/weight; parse TXT → name + extras.
3. If first authority returned no usable entries within 3s budget, try the
   second authority (3s budget).
4. Total DNS failure → emit `pools:dns-failed` event, return `Err`. Frontend
   shows the static-only list with a warning toast.

### 4.4 Merge rule

```
seed = { (host, port) -> PoolEntry::from_static(s) for s in STATIC_POOLS where s.network == network }
for d in discovered:
    if (d.host, d.port) in seed:
        seed[(d.host, d.port)].priority = d.priority
        seed[(d.host, d.port)].weight   = d.weight
        if d.name not empty: seed[...].name = d.name
        seed[...].source = Discovered { authority }
        seed[...].extras.extend(d.extras)
    else:
        seed[(d.host, d.port)] = PoolEntry::from_discovered(d)
sort by (priority asc, weight desc, name asc)
```

### 4.5 Cache

`pools_cache.json` in `app_config_dir()`, schema-versioned, keyed by network.
Always shown immediately on `list_pools`; background refresh writes back.
Schema-version mismatch → ignored (treated as cold start).

## 5. Frontend integration

`web-wallet/src/app/mining/pages/setup-wizard/setup-wizard.component.ts`:

- On chain modal open, call `list_pools(network)`.
- Replace the hardcoded `<option value="...">` block (lines ~1013–1023) with
  `*ngFor` over the merged entries.
- Add a small "↻ Refresh" button next to the dropdown that calls
  `refresh_pools` and re-renders.
- Listen to the `pools:updated` event for background-refresh deltas.
- Listen to `pools:dns-failed` and show a non-blocking toast: "Couldn't reach
  pool directory; showing built-in list."

The chain-name lookup at lines 3220–3225 should query the merged pool list
instead of substring-matching against hardcoded URLs.

## 6. Test plan

### 6.1 Rust unit tests (`pools/merger.rs`)
- static-only when discovered is empty
- discovered overrides priority / weight / name on `(host, port)` match
- discovered-only entries appended (authority adds a brand-new pool)
- TXT with no `name=` falls back to static name (or hostname if no static)
- sort `(priority asc, weight desc, name asc)`
- `extras` preserved across merge

### 6.2 Rust unit tests (`pools/resolver.rs`)
- TXT parser: `name=Foo` → kv; strings without `=` ignored; multiple
  character-strings in one TXT RR all consumed.
- Resolver itself: hidden behind a `PoolResolver` trait so tests inject a
  fake. Optional integration test against `hickory-resolver`'s test resolver
  if it can be wired in cheaply.

### 6.3 Cache tests
- Write → read round-trip
- Schema-version mismatch → treated as empty cache

### 6.4 Frontend
- Wizard renders the merged list and lets the user pick.
- ↻ button issues `refresh_pools`, list re-renders.
- `pools:dns-failed` event surfaces a toast and the static list is still
  selectable.

### 6.5 Manual smoke
- Stand up a private test zone (BIND or `dnsmasq` config) with the schema
  above, point the OS resolver at it, run the wallet, verify the dropdown.

## 7. Implementation phases

Each phase ends in a green build + a single commit on the feature branch.

1. **Skeleton** — `pools/` module, types, `STATIC_POOLS`, `list_pools` returns
   static-only. Wizard already works on the new path. No DNS yet.
2. **Resolver** — DNS-SD lookup, random A/B + fallback, TXT parsing, unit
   tests behind a fake resolver trait.
3. **Merger + cache** — combine static ⊎ discovered, persist
   `pools_cache.json`, background refresh + `pools:updated` event.
4. **Frontend** — replace hardcoded `<option>` block, listen for events, add
   ↻ button, fallback toast.
5. **Docs** — write `docs/pools-dns-setup.md` with zone templates, dig
   recipes, TXT key reference, priority guidance.
6. **Validation** — stand up a test zone, run end-to-end smoke on desktop.

## 8. Out of scope (v1)

- DoH / DNS-over-HTTPS — re-evaluate when mobile users report port-53
  blocking.
- DNSSEC client-side validation — relies on the system resolver for now.
- TXT-based feature flags (e.g. `disabled=true`) — not needed yet.
- Multi-language pool names — `name=` is a single string today.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Both authorities offline | Static list is the floor; UX shows a warning toast but the wallet still works. |
| Mirror drift between zones | Wallet uses whichever responds; SETUP doc emphasises that operators must keep them in sync. |
| Hijacked authority publishes a malicious pool | Static list cannot be deleted; user can still pick the canonical pool. Future: DNSSEC validation. |
| Port 53 blocked on a network | First call fails fast (3s × 2 = 6s), wallet falls back to static. Future: DoH. |
| Long DNS resolution stalls UI | All DNS work is on a Tokio task; UI sees cache instantly and an event when fresh data arrives. |
