# Pool Discovery via DNS-SD — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded pool dropdown in the setup wizard with a list discovered via DNS-SD (RFC 6763) from two mirror authorities (`bitcoin-pocx.org`, `bitcoin-pocx.bootseed.net`), keeping the existing hardcoded list as a guaranteed fallback.

**Architecture:** New `src-tauri/src/pools/` Rust module exposes `list_pools(network)` and `refresh_pools(network)` Tauri commands. `list_pools` returns the persisted cache instantly and kicks off a background DNS lookup (PTR → per-instance SRV+TXT, random A/B authority order with fallback on no-answer). Discovered entries are merged with a hardcoded `STATIC_POOLS` list — static priority is `1000` so DNS can promote/demote/add but never delete the floor. Frontend wizard renders the merged list and listens for `pools:updated` / `pools:dns-failed` events.

**Tech Stack:** Rust + Tauri 2 (backend), Angular 21 (frontend). New deps: `hickory-resolver` (system feature, plain UDP/53), `rand` (small).

**Reference:** Validated design at `docs/plans/2026-05-05-pool-discovery-dns-sd-design.md`.

**Branch:** `feature/pool-discovery-dns-sd` in worktree `.worktrees/pool-discovery-dns-sd/`.

---

## Phase 1 — Skeleton (static-only `list_pools`)

Goal of this phase: a working `list_pools` command that returns the existing three pools so the wizard can be re-pointed at it without changing UX. **No DNS yet.**

### Task 1.1 — Create `pools` module + `Network`-aware types

**Files:**
- Create: `web-wallet/src-tauri/src/pools/mod.rs`
- Create: `web-wallet/src-tauri/src/pools/types.rs`

**Step 1: Write the file `pools/types.rs`**

```rust
//! Types shared across the pools module.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A pool as exposed to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PoolEntry {
    pub host: String,
    pub port: u16,
    /// Convenience field: `https://{host}:{port}` unless overridden by TXT `url=`.
    pub url: String,
    pub name: String,
    /// SRV priority. Static entries use 1000.
    pub priority: u16,
    /// SRV weight. Static entries use 100.
    pub weight: u16,
    pub source: PoolSource,
    /// All TXT key/values besides those promoted to dedicated fields.
    #[serde(default)]
    pub extras: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PoolSource {
    Static,
    Discovered { authority: String },
}

/// Hardcoded fallback pool — present even if DNS fails.
#[derive(Debug, Clone, Copy)]
pub struct StaticPool {
    pub host: &'static str,
    pub port: u16,
    pub name: &'static str,
    pub network: NetworkScope,
}

/// Subset of `node::config::Network` for the pools module to avoid a circular dep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkScope {
    Mainnet,
    Testnet,
}

impl NetworkScope {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "mainnet" | "main" => Some(NetworkScope::Mainnet),
            "testnet" | "test" => Some(NetworkScope::Testnet),
            _ => None, // regtest: no DNS pools, no static pools
        }
    }
}

/// One DNS authority that publishes `_pool._tcp.<authority>` SRV/PTR/TXT.
#[derive(Debug, Clone, Copy)]
pub struct DnsAuthority {
    pub label: &'static str,
    pub mainnet_zone: &'static str,
    pub testnet_zone: &'static str,
}

impl DnsAuthority {
    pub fn zone_for(&self, network: NetworkScope) -> &'static str {
        match network {
            NetworkScope::Mainnet => self.mainnet_zone,
            NetworkScope::Testnet => self.testnet_zone,
        }
    }
}
```

**Step 2: Write the file `pools/mod.rs`**

```rust
//! Pool discovery — DNS-SD (RFC 6763) + static fallback.

pub mod types;

pub use types::{DnsAuthority, NetworkScope, PoolEntry, PoolSource, StaticPool};

/// Hardcoded fallback list. Mirrors the dropdown that lived in
/// `setup-wizard.component.ts` before DNS discovery existed.
pub const STATIC_POOLS: &[StaticPool] = &[
    StaticPool {
        host: "pool.bitcoin-pocx.org",
        port: 443,
        name: "Nogrod Mainnet",
        network: NetworkScope::Mainnet,
    },
    StaticPool {
        host: "btcx-pool.cryptoguru.org",
        port: 443,
        name: "CryptoGuru Mainnet",
        network: NetworkScope::Mainnet,
    },
    StaticPool {
        host: "pool.testnet.bitcoin-pocx.org",
        port: 443,
        name: "Nogrod Testnet",
        network: NetworkScope::Testnet,
    },
];

/// Mirror authorities that publish the SRV/PTR/TXT records.
pub const AUTHORITIES: &[DnsAuthority] = &[
    DnsAuthority {
        label: "bitcoin-pocx.org",
        mainnet_zone: "_pool._tcp.bitcoin-pocx.org",
        testnet_zone: "_pool._tcp.testnet.bitcoin-pocx.org",
    },
    DnsAuthority {
        label: "bitcoin-pocx.bootseed.net",
        mainnet_zone: "_pool._tcp.bitcoin-pocx.bootseed.net",
        testnet_zone: "_pool._tcp.testnet.bitcoin-pocx.bootseed.net",
    },
];
```

**Step 3: Wire the new module into the crate**

Modify `web-wallet/src-tauri/src/lib.rs` near the existing module declarations (around line 14–23):

```rust
// Pool discovery module
pub mod pools;
```

**Step 4: Build to confirm the module compiles**

Run: `cd web-wallet/src-tauri && cargo build --lib 2>&1 | tail -20`
Expected: `Finished` line, no errors. Warnings about unused `AUTHORITIES` are fine — used later.

**Step 5: Commit**

```bash
git add web-wallet/src-tauri/src/pools/ web-wallet/src-tauri/src/lib.rs
git commit -m "Add pools module skeleton with static fallback list"
```

---

### Task 1.2 — `static_pools_for(network)` function (TDD)

**Files:**
- Modify: `web-wallet/src-tauri/src/pools/mod.rs`

**Step 1: Add the failing test at the bottom of `pools/mod.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_pools_for_mainnet_returns_two_pools() {
        let pools = static_pools_for(NetworkScope::Mainnet);
        assert_eq!(pools.len(), 2);
        let hosts: Vec<&str> = pools.iter().map(|p| p.host.as_str()).collect();
        assert!(hosts.contains(&"pool.bitcoin-pocx.org"));
        assert!(hosts.contains(&"btcx-pool.cryptoguru.org"));
    }

    #[test]
    fn static_pools_for_testnet_returns_one_pool() {
        let pools = static_pools_for(NetworkScope::Testnet);
        assert_eq!(pools.len(), 1);
        assert_eq!(pools[0].host, "pool.testnet.bitcoin-pocx.org");
    }

    #[test]
    fn static_pools_have_priority_1000_and_url_field() {
        let pools = static_pools_for(NetworkScope::Mainnet);
        for p in &pools {
            assert_eq!(p.priority, 1000);
            assert_eq!(p.weight, 100);
            assert_eq!(p.url, format!("https://{}:{}", p.host, p.port));
            assert!(matches!(p.source, PoolSource::Static));
        }
    }
}
```

**Step 2: Run test, expect failure**

Run: `cd web-wallet/src-tauri && cargo test --lib pools::tests 2>&1 | tail -10`
Expected: compile error — `static_pools_for` not defined.

**Step 3: Add the implementation in `pools/mod.rs` above the `tests` module**

```rust
/// Return the static fallback pools for `network` as `PoolEntry`s.
pub fn static_pools_for(network: NetworkScope) -> Vec<PoolEntry> {
    STATIC_POOLS
        .iter()
        .filter(|p| p.network == network)
        .map(|p| PoolEntry {
            host: p.host.to_string(),
            port: p.port,
            url: format!("https://{}:{}", p.host, p.port),
            name: p.name.to_string(),
            priority: 1000,
            weight: 100,
            source: PoolSource::Static,
            extras: Default::default(),
        })
        .collect()
}
```

**Step 4: Run tests, expect pass**

Run: `cd web-wallet/src-tauri && cargo test --lib pools:: 2>&1 | tail -10`
Expected: `3 passed; 0 failed`.

**Step 5: Commit**

```bash
git add web-wallet/src-tauri/src/pools/mod.rs
git commit -m "Add static_pools_for(network) helper"
```

---

### Task 1.3 — `list_pools` Tauri command (static-only)

**Files:**
- Create: `web-wallet/src-tauri/src/pools/commands.rs`
- Modify: `web-wallet/src-tauri/src/pools/mod.rs` (add `pub mod commands;`)
- Modify: `web-wallet/src-tauri/src/lib.rs` (register the command)

**Step 1: Write `pools/commands.rs`**

```rust
//! Tauri command handlers for the pools module.

use super::{static_pools_for, NetworkScope, PoolEntry};
use crate::mining::commands::CommandResult;

/// Return the merged pool list for the given network.
///
/// In Phase 1 this is static-only. Phase 3 wires in DNS discovery + cache.
#[tauri::command]
pub async fn list_pools(network: String) -> CommandResult<Vec<PoolEntry>> {
    let Some(scope) = NetworkScope::parse(&network) else {
        return CommandResult::ok(Vec::new()); // regtest etc.
    };
    CommandResult::ok(static_pools_for(scope))
}
```

**Step 2: Add `pub mod commands;` to `pools/mod.rs`** (at the top alongside `pub mod types;`).

**Step 3: Register the command in `lib.rs`**

In `web-wallet/src-tauri/src/lib.rs`, add to the `tauri::generate_handler![...]` block (find the end of the mining commands list around line 860; add a new section):

```rust
            // Pool discovery commands
            pools::commands::list_pools,
```

**Step 4: Build**

Run: `cd web-wallet/src-tauri && cargo build --lib 2>&1 | tail -10`
Expected: success.

**Step 5: Commit**

```bash
git add web-wallet/src-tauri/src/pools/ web-wallet/src-tauri/src/lib.rs
git commit -m "Add list_pools Tauri command (static-only)"
```

---

## Phase 2 — DNS resolver

Goal: implement DNS-SD lookup behind a `PoolResolver` trait so tests can inject a fake. Production uses `hickory-resolver` over UDP/53. `resolve_pools(network)` picks a random authority, falls back to the other on no-answer, returns a flat `Vec<DiscoveredPool>`.

### Task 2.1 — Add `hickory-resolver` and `rand` dependencies

**Files:**
- Modify: `web-wallet/src-tauri/Cargo.toml`

**Step 1: Add deps under `[dependencies]`**

```toml
# Pool discovery via DNS-SD
hickory-resolver = { version = "0.24", default-features = false, features = ["system-config", "tokio-runtime"] }
rand = "0.8"
```

**Step 2: Build (downloads + compiles deps)**

Run: `cd web-wallet/src-tauri && cargo build --lib 2>&1 | tail -5`
Expected: success. First build will be slow (~minutes) — that's fine.

**Step 3: Commit**

```bash
git add web-wallet/src-tauri/Cargo.toml web-wallet/src-tauri/Cargo.lock
git commit -m "Add hickory-resolver and rand for DNS-SD pool discovery"
```

---

### Task 2.2 — TXT parser (TDD)

Parse RFC 6763 TXT character-strings (`Vec<String>` of `key=value` items) into a `(name, extras)` tuple. Strings without `=` are ignored.

**Files:**
- Create: `web-wallet/src-tauri/src/pools/resolver.rs`
- Modify: `web-wallet/src-tauri/src/pools/mod.rs` (add `pub mod resolver;`)

**Step 1: Add `pub mod resolver;` to `pools/mod.rs`.**

**Step 2: Write the failing tests in `pools/resolver.rs`**

```rust
//! DNS-SD resolver for pool discovery.

use std::collections::BTreeMap;

/// Parsed DNS-SD TXT record: `name` (required for usable entry) + extras.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedTxt {
    pub name: Option<String>,
    pub url: Option<String>,
    pub extras: BTreeMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_txt_extracts_name_and_extras() {
        let strings = vec![
            "name=Nogrod Mainnet".to_string(),
            "operator=Nogrod".to_string(),
        ];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("Nogrod Mainnet"));
        assert_eq!(parsed.extras.get("operator").map(String::as_str), Some("Nogrod"));
    }

    #[test]
    fn parse_txt_ignores_strings_without_equals() {
        let strings = vec!["badformat".to_string(), "name=Foo".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("Foo"));
        assert!(parsed.extras.is_empty());
    }

    #[test]
    fn parse_txt_promotes_url_field() {
        let strings = vec!["url=https://alt.example.com/api".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.url.as_deref(), Some("https://alt.example.com/api"));
    }

    #[test]
    fn parse_txt_handles_empty_value() {
        let strings = vec!["operator=".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.extras.get("operator").map(String::as_str), Some(""));
    }
}
```

**Step 3: Run, expect failure**

Run: `cd web-wallet/src-tauri && cargo test --lib pools::resolver 2>&1 | tail -10`
Expected: `parse_txt` not defined.

**Step 4: Implement `parse_txt`**

Add above `#[cfg(test)] mod tests` in `pools/resolver.rs`:

```rust
/// Parse a flat list of DNS-SD TXT character-strings into a `ParsedTxt`.
///
/// Strings without `=` are discarded (per RFC 6763 §6.4 we MAY accept them as
/// boolean flags; we don't use any so they're dropped). `name` and `url` are
/// promoted to dedicated fields; everything else lives in `extras`.
pub fn parse_txt(strings: &[String]) -> ParsedTxt {
    let mut out = ParsedTxt::default();
    for s in strings {
        let Some(eq) = s.find('=') else {
            continue;
        };
        let key = &s[..eq];
        let val = &s[eq + 1..];
        match key {
            "name" => out.name = Some(val.to_string()),
            "url" => out.url = Some(val.to_string()),
            _ => {
                out.extras.insert(key.to_string(), val.to_string());
            }
        }
    }
    out
}
```

**Step 5: Run, expect pass**

Run: `cd web-wallet/src-tauri && cargo test --lib pools::resolver 2>&1 | tail -10`
Expected: `4 passed`.

**Step 6: Commit**

```bash
git add web-wallet/src-tauri/src/pools/
git commit -m "Add DNS-SD TXT parser"
```

---

### Task 2.3 — `PoolResolver` trait + `DiscoveredPool` type

Define the abstraction tests will mock; production binding to hickory comes next task.

**Files:**
- Modify: `web-wallet/src-tauri/src/pools/resolver.rs`

**Step 1: Add types to `resolver.rs` above `ParsedTxt`**

```rust
use crate::pools::{DnsAuthority, NetworkScope};
use async_trait::async_trait;
use std::time::Duration;
use thiserror::Error;

/// One pool returned by the resolver, before merging with the static list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredPool {
    pub host: String,
    pub port: u16,
    pub name: Option<String>,
    pub url: Option<String>,
    pub priority: u16,
    pub weight: u16,
    pub authority: String,
    pub extras: BTreeMap<String, String>,
}

#[derive(Debug, Error)]
pub enum ResolveError {
    #[error("DNS lookup failed: {0}")]
    Dns(String),
    #[error("no usable records returned")]
    Empty,
    #[error("timeout after {0:?}")]
    Timeout(Duration),
}

/// Abstraction over a DNS resolver so tests can inject canned responses.
#[async_trait]
pub trait PoolResolver: Send + Sync {
    async fn resolve_authority(
        &self,
        authority: &DnsAuthority,
        network: NetworkScope,
    ) -> Result<Vec<DiscoveredPool>, ResolveError>;
}
```

**Step 2: Add the new deps to `Cargo.toml`**

```toml
async-trait = "0.1"
thiserror = "1"
```

**Step 3: Build to make sure it compiles**

Run: `cd web-wallet/src-tauri && cargo build --lib 2>&1 | tail -10`
Expected: success.

**Step 4: Commit**

```bash
git add web-wallet/src-tauri/src/pools/resolver.rs web-wallet/src-tauri/Cargo.toml web-wallet/src-tauri/Cargo.lock
git commit -m "Add PoolResolver trait and DiscoveredPool type"
```

---

### Task 2.4 — `resolve_pools(resolver, network)` with random A/B fallback (TDD)

Pure logic: given a resolver that may succeed or fail per authority, pick A or B at random; on failure/empty, try the other.

**Files:**
- Modify: `web-wallet/src-tauri/src/pools/resolver.rs`

**Step 1: Add failing tests (append below the existing tests)**

```rust
#[cfg(test)]
mod resolve_tests {
    use super::*;
    use crate::pools::AUTHORITIES;
    use async_trait::async_trait;
    use std::sync::Mutex;

    /// Test resolver: per-authority canned response, records call order.
    struct FakeResolver {
        responses: std::collections::HashMap<&'static str, Result<Vec<DiscoveredPool>, ResolveError>>,
        calls: Mutex<Vec<&'static str>>,
    }

    #[async_trait]
    impl PoolResolver for FakeResolver {
        async fn resolve_authority(
            &self,
            authority: &DnsAuthority,
            _: NetworkScope,
        ) -> Result<Vec<DiscoveredPool>, ResolveError> {
            self.calls.lock().unwrap().push(authority.label);
            self.responses
                .get(authority.label)
                .cloned()
                .unwrap_or(Err(ResolveError::Empty))
        }
    }

    fn pool(host: &str, name: &str, prio: u16, auth: &str) -> DiscoveredPool {
        DiscoveredPool {
            host: host.into(),
            port: 443,
            name: Some(name.into()),
            url: None,
            priority: prio,
            weight: 100,
            authority: auth.into(),
            extras: BTreeMap::new(),
        }
    }

    #[tokio::test]
    async fn returns_first_authority_when_it_responds() {
        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "bitcoin-pocx.org",
            Ok(vec![pool("a", "A", 10, "bitcoin-pocx.org")]),
        );
        responses.insert(
            "bitcoin-pocx.bootseed.net",
            Ok(vec![pool("b", "B", 10, "bitcoin-pocx.bootseed.net")]),
        );
        let fake = FakeResolver {
            responses,
            calls: Mutex::new(Vec::new()),
        };
        let result = resolve_pools(&fake, NetworkScope::Mainnet, &[0]).await.unwrap();
        // order_seed=[0] -> first try AUTHORITIES[0] = bitcoin-pocx.org
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].authority, "bitcoin-pocx.org");
        assert_eq!(fake.calls.lock().unwrap().as_slice(), &["bitcoin-pocx.org"]);
    }

    #[tokio::test]
    async fn falls_back_when_first_returns_empty() {
        let mut responses = std::collections::HashMap::new();
        responses.insert("bitcoin-pocx.org", Err(ResolveError::Empty));
        responses.insert(
            "bitcoin-pocx.bootseed.net",
            Ok(vec![pool("b", "B", 10, "bitcoin-pocx.bootseed.net")]),
        );
        let fake = FakeResolver {
            responses,
            calls: Mutex::new(Vec::new()),
        };
        let result = resolve_pools(&fake, NetworkScope::Mainnet, &[0]).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].authority, "bitcoin-pocx.bootseed.net");
        assert_eq!(
            fake.calls.lock().unwrap().as_slice(),
            &["bitcoin-pocx.org", "bitcoin-pocx.bootseed.net"]
        );
    }

    #[tokio::test]
    async fn returns_error_when_both_fail() {
        let mut responses = std::collections::HashMap::new();
        responses.insert("bitcoin-pocx.org", Err(ResolveError::Empty));
        responses.insert("bitcoin-pocx.bootseed.net", Err(ResolveError::Empty));
        let fake = FakeResolver {
            responses,
            calls: Mutex::new(Vec::new()),
        };
        let err = resolve_pools(&fake, NetworkScope::Mainnet, &[1])
            .await
            .unwrap_err();
        assert!(matches!(err, ResolveError::Empty));
        // order_seed=[1] -> first try AUTHORITIES[1] = bootseed, then org
        assert_eq!(
            fake.calls.lock().unwrap().as_slice(),
            &["bitcoin-pocx.bootseed.net", "bitcoin-pocx.org"]
        );
    }

    #[test]
    fn const_authorities_listed_in_expected_order() {
        // The tests above depend on this order; pin it.
        assert_eq!(AUTHORITIES[0].label, "bitcoin-pocx.org");
        assert_eq!(AUTHORITIES[1].label, "bitcoin-pocx.bootseed.net");
    }
}
```

**Step 2: Run, expect failure**

Run: `cd web-wallet/src-tauri && cargo test --lib pools::resolver::resolve_tests 2>&1 | tail -15`
Expected: `resolve_pools` not defined.

**Step 3: Implement `resolve_pools`**

Add to `resolver.rs` above the `#[cfg(test)]` blocks:

```rust
use crate::pools::AUTHORITIES;
use rand::seq::SliceRandom;

/// Resolve pools for `network` against the configured authorities.
///
/// Tries authorities in a randomized order (deterministic in tests via
/// `order_seed`). On the first error/empty response, falls through to the
/// next authority. Returns the first non-empty result; if all fail, returns
/// the last error.
///
/// `order_seed` is normally empty (production uses `rand::thread_rng()`).
/// Tests pass `&[0]` to force "try AUTHORITIES[0] first" or `&[1]` for the
/// reverse — anything else falls back to RNG.
pub async fn resolve_pools(
    resolver: &dyn PoolResolver,
    network: NetworkScope,
    order_seed: &[usize],
) -> Result<Vec<DiscoveredPool>, ResolveError> {
    let order = if order_seed.is_empty() {
        let mut idxs: Vec<usize> = (0..AUTHORITIES.len()).collect();
        idxs.shuffle(&mut rand::thread_rng());
        idxs
    } else {
        let first = order_seed[0] % AUTHORITIES.len();
        let mut idxs = vec![first];
        for i in 0..AUTHORITIES.len() {
            if i != first {
                idxs.push(i);
            }
        }
        idxs
    };

    let mut last_err = ResolveError::Empty;
    for idx in order {
        let auth = &AUTHORITIES[idx];
        match resolver.resolve_authority(auth, network).await {
            Ok(v) if !v.is_empty() => return Ok(v),
            Ok(_) => last_err = ResolveError::Empty,
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}
```

**Step 4: Run, expect pass**

Run: `cd web-wallet/src-tauri && cargo test --lib pools::resolver 2>&1 | tail -15`
Expected: all parser + resolve tests pass.

**Step 5: Commit**

```bash
git add web-wallet/src-tauri/src/pools/resolver.rs
git commit -m "Add resolve_pools with random A/B + fallback"
```

---

### Task 2.5 — Hickory-backed production resolver

Wire a `HickoryPoolResolver` that does PTR → SRV+TXT lookups via `hickory-resolver`. Logic: PTR lookup at the zone, parallel SRV+TXT per instance, 3s budget. **No new tests** — covered by the trait fakes above; this binding is the integration glue.

**Files:**
- Modify: `web-wallet/src-tauri/src/pools/resolver.rs`

**Step 1: Add the hickory-backed impl**

```rust
use hickory_resolver::config::{ResolverConfig, ResolverOpts};
use hickory_resolver::TokioAsyncResolver;
use std::sync::Arc;
use tokio::time::timeout;

const PER_AUTHORITY_BUDGET: Duration = Duration::from_secs(3);

pub struct HickoryPoolResolver {
    inner: Arc<TokioAsyncResolver>,
}

impl HickoryPoolResolver {
    pub fn new() -> Result<Self, ResolveError> {
        let inner = TokioAsyncResolver::tokio(ResolverConfig::default(), ResolverOpts::default());
        Ok(Self { inner: Arc::new(inner) })
    }

    /// Try to use the system resolver; fall back to default (Cloudflare/Google) if not available.
    pub fn from_system_or_default() -> Self {
        match TokioAsyncResolver::tokio_from_system_conf() {
            Ok(r) => Self { inner: Arc::new(r) },
            Err(_) => Self {
                inner: Arc::new(TokioAsyncResolver::tokio(
                    ResolverConfig::default(),
                    ResolverOpts::default(),
                )),
            },
        }
    }
}

#[async_trait]
impl PoolResolver for HickoryPoolResolver {
    async fn resolve_authority(
        &self,
        authority: &DnsAuthority,
        network: NetworkScope,
    ) -> Result<Vec<DiscoveredPool>, ResolveError> {
        let zone = authority.zone_for(network);
        let inner = self.inner.clone();
        let auth_label = authority.label.to_string();

        let work = async move {
            // 1. PTR query at the service zone.
            let ptr = inner
                .lookup(zone, hickory_resolver::proto::rr::RecordType::PTR)
                .await
                .map_err(|e| ResolveError::Dns(e.to_string()))?;

            let instance_names: Vec<String> = ptr
                .iter()
                .filter_map(|r| r.as_ptr().map(|p| p.to_utf8()))
                .collect();

            if instance_names.is_empty() {
                return Err(ResolveError::Empty);
            }

            // 2. For each instance, parallel SRV + TXT.
            let mut tasks = tokio::task::JoinSet::new();
            for name in instance_names {
                let inner = inner.clone();
                let auth = auth_label.clone();
                tasks.spawn(async move { resolve_instance(&inner, &name, &auth).await });
            }

            let mut results = Vec::new();
            while let Some(joined) = tasks.join_next().await {
                if let Ok(Ok(p)) = joined {
                    results.push(p);
                }
            }

            if results.is_empty() {
                Err(ResolveError::Empty)
            } else {
                Ok(results)
            }
        };

        match timeout(PER_AUTHORITY_BUDGET, work).await {
            Ok(r) => r,
            Err(_) => Err(ResolveError::Timeout(PER_AUTHORITY_BUDGET)),
        }
    }
}

async fn resolve_instance(
    resolver: &TokioAsyncResolver,
    name: &str,
    authority_label: &str,
) -> Result<DiscoveredPool, ResolveError> {
    let (srv_res, txt_res) = tokio::join!(resolver.srv_lookup(name), resolver.txt_lookup(name));
    let srv = srv_res
        .map_err(|e| ResolveError::Dns(e.to_string()))?
        .iter()
        .next()
        .cloned()
        .ok_or(ResolveError::Empty)?;

    let txt_strings: Vec<String> = txt_res
        .map(|t| {
            t.iter()
                .flat_map(|rec| {
                    rec.txt_data().iter().map(|bytes| {
                        String::from_utf8_lossy(bytes).into_owned()
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let parsed = parse_txt(&txt_strings);

    Ok(DiscoveredPool {
        host: srv.target().to_utf8().trim_end_matches('.').to_string(),
        port: srv.port(),
        name: parsed.name,
        url: parsed.url,
        priority: srv.priority(),
        weight: srv.weight(),
        authority: authority_label.to_string(),
        extras: parsed.extras,
    })
}
```

**Step 2: Build (will pull in hickory deps for first time on actual usage)**

Run: `cd web-wallet/src-tauri && cargo build --lib 2>&1 | tail -10`
Expected: success.

**Step 3: Run all pools tests to make sure nothing regressed**

Run: `cd web-wallet/src-tauri && cargo test --lib pools:: 2>&1 | tail -15`
Expected: all pass.

**Step 4: Commit**

```bash
git add web-wallet/src-tauri/src/pools/resolver.rs
git commit -m "Add HickoryPoolResolver (PTR + SRV + TXT, 3s timeout)"
```

---

## Phase 3 — Merger + cache + background refresh

### Task 3.1 — `merge` function (TDD)

**Files:**
- Create: `web-wallet/src-tauri/src/pools/merger.rs`
- Modify: `web-wallet/src-tauri/src/pools/mod.rs` (add `pub mod merger;`)

**Step 1: Add `pub mod merger;` to `pools/mod.rs`.**

**Step 2: Write `merger.rs` with failing tests**

```rust
//! Merge static fallback pools with DNS-discovered ones.

use crate::pools::{
    resolver::DiscoveredPool, NetworkScope, PoolEntry, PoolSource, STATIC_POOLS,
};
use std::collections::BTreeMap;

/// Merge static + discovered into a sorted, deduped `Vec<PoolEntry>`.
pub fn merge(network: NetworkScope, discovered: &[DiscoveredPool]) -> Vec<PoolEntry> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovered(host: &str, name: &str, prio: u16, auth: &str) -> DiscoveredPool {
        DiscoveredPool {
            host: host.into(),
            port: 443,
            name: Some(name.into()),
            url: None,
            priority: prio,
            weight: 100,
            authority: auth.into(),
            extras: BTreeMap::new(),
        }
    }

    #[test]
    fn merge_with_no_discovered_returns_static_only() {
        let result = merge(NetworkScope::Mainnet, &[]);
        assert_eq!(result.len(), 2);
        for entry in &result {
            assert_eq!(entry.priority, 1000);
            assert!(matches!(entry.source, PoolSource::Static));
        }
    }

    #[test]
    fn discovered_overrides_static_priority_and_name() {
        let d = discovered(
            "pool.bitcoin-pocx.org",
            "Nogrod (DNS)",
            10,
            "bitcoin-pocx.org",
        );
        let result = merge(NetworkScope::Mainnet, &[d]);
        let nogrod = result
            .iter()
            .find(|p| p.host == "pool.bitcoin-pocx.org")
            .unwrap();
        assert_eq!(nogrod.priority, 10);
        assert_eq!(nogrod.name, "Nogrod (DNS)");
        assert!(matches!(nogrod.source, PoolSource::Discovered { .. }));
    }

    #[test]
    fn discovered_only_pool_appended() {
        let d = discovered("new.example.com", "Brand New", 5, "bitcoin-pocx.org");
        let result = merge(NetworkScope::Mainnet, &[d]);
        assert!(result.iter().any(|p| p.host == "new.example.com"));
    }

    #[test]
    fn static_pools_never_removed() {
        // Even if discovered list is empty, static must be present.
        let result = merge(NetworkScope::Mainnet, &[]);
        let hosts: Vec<&str> = result.iter().map(|p| p.host.as_str()).collect();
        assert!(hosts.contains(&"pool.bitcoin-pocx.org"));
        assert!(hosts.contains(&"btcx-pool.cryptoguru.org"));
    }

    #[test]
    fn sort_order_is_priority_asc_then_weight_desc_then_name() {
        let d_low = discovered("a.example", "Aaa", 10, "bitcoin-pocx.org");
        let d_high = discovered("b.example", "Bbb", 5, "bitcoin-pocx.org");
        let result = merge(NetworkScope::Mainnet, &[d_low, d_high]);
        // priority 5 first
        assert_eq!(result[0].host, "b.example");
        assert_eq!(result[1].host, "a.example");
    }

    #[test]
    fn discovered_name_falls_back_to_static_when_missing() {
        let d = DiscoveredPool {
            host: "pool.bitcoin-pocx.org".into(),
            port: 443,
            name: None,
            url: None,
            priority: 10,
            weight: 100,
            authority: "bitcoin-pocx.org".into(),
            extras: BTreeMap::new(),
        };
        let result = merge(NetworkScope::Mainnet, &[d]);
        let nogrod = result
            .iter()
            .find(|p| p.host == "pool.bitcoin-pocx.org")
            .unwrap();
        assert_eq!(nogrod.name, "Nogrod Mainnet"); // from STATIC_POOLS
    }

    #[test]
    fn extras_from_discovered_preserved() {
        let mut d = discovered("x.example", "X", 10, "bitcoin-pocx.org");
        d.extras.insert("operator".into(), "Acme".into());
        let result = merge(NetworkScope::Mainnet, &[d]);
        let x = result.iter().find(|p| p.host == "x.example").unwrap();
        assert_eq!(x.extras.get("operator").map(String::as_str), Some("Acme"));
    }
}
```

**Step 3: Run, expect failure**

Run: `cd web-wallet/src-tauri && cargo test --lib pools::merger 2>&1 | tail -15`
Expected: panics from `todo!()`.

**Step 4: Implement `merge`**

Replace the `todo!()` body:

```rust
pub fn merge(network: NetworkScope, discovered: &[DiscoveredPool]) -> Vec<PoolEntry> {
    let mut by_key: BTreeMap<(String, u16), PoolEntry> = BTreeMap::new();

    // Seed with static.
    for sp in STATIC_POOLS.iter().filter(|p| p.network == network) {
        let entry = PoolEntry {
            host: sp.host.to_string(),
            port: sp.port,
            url: format!("https://{}:{}", sp.host, sp.port),
            name: sp.name.to_string(),
            priority: 1000,
            weight: 100,
            source: PoolSource::Static,
            extras: BTreeMap::new(),
        };
        by_key.insert((sp.host.to_string(), sp.port), entry);
    }

    // Apply discovered.
    for d in discovered {
        let key = (d.host.clone(), d.port);
        match by_key.get_mut(&key) {
            Some(entry) => {
                entry.priority = d.priority;
                entry.weight = d.weight;
                if let Some(n) = &d.name {
                    if !n.is_empty() {
                        entry.name = n.clone();
                    }
                }
                if let Some(u) = &d.url {
                    entry.url = u.clone();
                }
                entry.source = PoolSource::Discovered {
                    authority: d.authority.clone(),
                };
                for (k, v) in &d.extras {
                    entry.extras.insert(k.clone(), v.clone());
                }
            }
            None => {
                let url = d
                    .url
                    .clone()
                    .unwrap_or_else(|| format!("https://{}:{}", d.host, d.port));
                let name = d.name.clone().unwrap_or_else(|| d.host.clone());
                by_key.insert(
                    key,
                    PoolEntry {
                        host: d.host.clone(),
                        port: d.port,
                        url,
                        name,
                        priority: d.priority,
                        weight: d.weight,
                        source: PoolSource::Discovered {
                            authority: d.authority.clone(),
                        },
                        extras: d.extras.clone(),
                    },
                );
            }
        }
    }

    let mut sorted: Vec<PoolEntry> = by_key.into_values().collect();
    sorted.sort_by(|a, b| {
        a.priority
            .cmp(&b.priority)
            .then_with(|| b.weight.cmp(&a.weight))
            .then_with(|| a.name.cmp(&b.name))
    });
    sorted
}
```

**Step 5: Run, expect pass**

Run: `cd web-wallet/src-tauri && cargo test --lib pools::merger 2>&1 | tail -15`
Expected: all 7 tests pass.

**Step 6: Commit**

```bash
git add web-wallet/src-tauri/src/pools/
git commit -m "Add merge function with priority/weight/name dedupe rules"
```

---

### Task 3.2 — Cache (read/write `pools_cache.json`)

Persistent cache so `list_pools` shows entries instantly on cold launch.

**Files:**
- Create: `web-wallet/src-tauri/src/pools/cache.rs`
- Modify: `web-wallet/src-tauri/src/pools/mod.rs` (add `pub mod cache;`)

**Step 1: Add `pub mod cache;` to `pools/mod.rs`.**

**Step 2: Write `cache.rs` with TDD**

```rust
//! Persisted pool cache.
//!
//! Located in `app_config_dir()/pools_cache.json`. Schema-versioned;
//! mismatches are treated as "no cache" rather than an error.

use crate::pools::PoolEntry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    by_network: HashMap<String, Vec<PoolEntry>>,
}

pub fn read_cache(path: &Path, network: &str) -> Vec<PoolEntry> {
    let Ok(bytes) = std::fs::read(path) else {
        return Vec::new();
    };
    let Ok(parsed): Result<CacheFile, _> = serde_json::from_slice(&bytes) else {
        return Vec::new();
    };
    if parsed.version != SCHEMA_VERSION {
        return Vec::new();
    }
    parsed
        .by_network
        .get(network)
        .cloned()
        .unwrap_or_default()
}

pub fn write_cache(path: &Path, network: &str, pools: &[PoolEntry]) -> std::io::Result<()> {
    let mut cur = match std::fs::read(path) {
        Ok(b) => serde_json::from_slice::<CacheFile>(&b).unwrap_or(CacheFile {
            version: SCHEMA_VERSION,
            by_network: HashMap::new(),
        }),
        Err(_) => CacheFile {
            version: SCHEMA_VERSION,
            by_network: HashMap::new(),
        },
    };
    cur.version = SCHEMA_VERSION;
    cur.by_network.insert(network.to_string(), pools.to_vec());
    let bytes = serde_json::to_vec_pretty(&cur)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pools::PoolSource;
    use std::collections::BTreeMap;
    use tempfile::TempDir;

    fn entry(host: &str) -> PoolEntry {
        PoolEntry {
            host: host.into(),
            port: 443,
            url: format!("https://{}:443", host),
            name: host.into(),
            priority: 10,
            weight: 100,
            source: PoolSource::Static,
            extras: BTreeMap::new(),
        }
    }

    #[test]
    fn round_trip_preserves_pools() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("pools_cache.json");
        let pools = vec![entry("a.example"), entry("b.example")];
        write_cache(&path, "mainnet", &pools).unwrap();
        let read = read_cache(&path, "mainnet");
        assert_eq!(read, pools);
    }

    #[test]
    fn missing_file_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nope.json");
        assert!(read_cache(&path, "mainnet").is_empty());
    }

    #[test]
    fn version_mismatch_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("pools_cache.json");
        std::fs::write(&path, br#"{"version": 999, "by_network": {}}"#).unwrap();
        assert!(read_cache(&path, "mainnet").is_empty());
    }

    #[test]
    fn unknown_network_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("pools_cache.json");
        write_cache(&path, "mainnet", &[entry("a")]).unwrap();
        assert!(read_cache(&path, "testnet").is_empty());
    }

    #[test]
    fn write_preserves_other_networks() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("pools_cache.json");
        write_cache(&path, "mainnet", &[entry("m")]).unwrap();
        write_cache(&path, "testnet", &[entry("t")]).unwrap();
        assert_eq!(read_cache(&path, "mainnet"), vec![entry("m")]);
        assert_eq!(read_cache(&path, "testnet"), vec![entry("t")]);
    }
}
```

**Step 3: Run, expect pass** (the implementation is in the same file as tests in this task — written together)

Run: `cd web-wallet/src-tauri && cargo test --lib pools::cache 2>&1 | tail -15`
Expected: 5 tests pass.

**Step 4: Commit**

```bash
git add web-wallet/src-tauri/src/pools/
git commit -m "Add persisted pool cache with schema versioning"
```

---

### Task 3.3 — Wire `list_pools` to cache + background refresh + `pools:updated` event

**Files:**
- Modify: `web-wallet/src-tauri/src/pools/commands.rs`
- Modify: `web-wallet/src-tauri/src/pools/mod.rs` (expose new helpers if needed)

**Step 1: Replace `pools/commands.rs` with the wired version**

```rust
//! Tauri command handlers for the pools module.

use super::cache::{read_cache, write_cache};
use super::merger::merge;
use super::resolver::{resolve_pools, HickoryPoolResolver};
use super::{static_pools_for, NetworkScope, PoolEntry};
use crate::mining::commands::CommandResult;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

const CACHE_FILE: &str = "pools_cache.json";

fn cache_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(CACHE_FILE)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PoolsUpdatedPayload {
    network: String,
    pools: Vec<PoolEntry>,
}

/// Return cached pools immediately; spawn a background refresh that emits
/// `pools:updated` when fresh data lands. If the cache is empty, the static
/// fallback is returned synchronously so the UI is never blank.
#[tauri::command]
pub async fn list_pools(app: AppHandle, network: String) -> CommandResult<Vec<PoolEntry>> {
    let Some(scope) = NetworkScope::parse(&network) else {
        return CommandResult::ok(Vec::new());
    };

    let path = cache_path(&app);
    let cached = read_cache(&path, scope_str(scope));
    let immediate = if cached.is_empty() {
        static_pools_for(scope)
    } else {
        cached
    };

    // Fire-and-forget background refresh.
    let app_for_bg = app.clone();
    let net_label = network.clone();
    tokio::spawn(async move {
        if let Err(e) = background_refresh(&app_for_bg, scope, &net_label).await {
            log::warn!("Pool DNS refresh failed: {}", e);
            let _ = app_for_bg.emit("pools:dns-failed", net_label);
        }
    });

    CommandResult::ok(immediate)
}

/// Force a synchronous DNS lookup; updates the cache; emits `pools:updated`.
#[tauri::command]
pub async fn refresh_pools(app: AppHandle, network: String) -> CommandResult<Vec<PoolEntry>> {
    let Some(scope) = NetworkScope::parse(&network) else {
        return CommandResult::ok(Vec::new());
    };
    match background_refresh(&app, scope, &network).await {
        Ok(pools) => CommandResult::ok(pools),
        Err(e) => CommandResult::err(format!("Pool refresh failed: {}", e)),
    }
}

async fn background_refresh(
    app: &AppHandle,
    scope: NetworkScope,
    network_label: &str,
) -> Result<Vec<PoolEntry>, String> {
    let resolver = HickoryPoolResolver::from_system_or_default();
    let discovered = resolve_pools(&resolver, scope, &[])
        .await
        .map_err(|e| e.to_string())?;
    let merged = merge(scope, &discovered);
    let path = cache_path(app);
    let _ = write_cache(&path, scope_str(scope), &merged);
    let _ = app.emit(
        "pools:updated",
        PoolsUpdatedPayload {
            network: network_label.to_string(),
            pools: merged.clone(),
        },
    );
    Ok(merged)
}

fn scope_str(scope: NetworkScope) -> &'static str {
    match scope {
        NetworkScope::Mainnet => "mainnet",
        NetworkScope::Testnet => "testnet",
    }
}
```

**Step 2: Register `refresh_pools` in `lib.rs`**

In the `tauri::generate_handler![...]` block, add next to `list_pools`:

```rust
            pools::commands::refresh_pools,
```

**Step 3: Build**

Run: `cd web-wallet/src-tauri && cargo build --lib 2>&1 | tail -10`
Expected: success.

**Step 4: Run all pools tests to confirm nothing regressed**

Run: `cd web-wallet/src-tauri && cargo test --lib pools:: 2>&1 | tail -15`
Expected: all pass.

**Step 5: Commit**

```bash
git add web-wallet/src-tauri/src/pools/commands.rs web-wallet/src-tauri/src/lib.rs
git commit -m "Wire list_pools/refresh_pools to cache + background DNS refresh"
```

---

## Phase 4 — Frontend integration

### Task 4.1 — Pool service + types in Angular

**Files:**
- Create: `web-wallet/src/app/mining/services/pools.service.ts`

**Step 1: Write the service**

```ts
import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type PoolSource = { kind: 'static' } | { kind: 'discovered'; authority: string };

export interface PoolEntry {
  host: string;
  port: number;
  url: string;
  name: string;
  priority: number;
  weight: number;
  source: PoolSource;
  extras: Record<string, string>;
}

interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class PoolsService {
  readonly pools = signal<Record<string, PoolEntry[]>>({});
  readonly dnsFailed = signal<string | null>(null);

  private unlistenUpdated?: UnlistenFn;
  private unlistenFailed?: UnlistenFn;

  async init(): Promise<void> {
    if (this.unlistenUpdated) return;
    this.unlistenUpdated = await listen<{ network: string; pools: PoolEntry[] }>(
      'pools:updated',
      (e) => {
        this.pools.update((cur) => ({ ...cur, [e.payload.network]: e.payload.pools }));
        this.dnsFailed.set(null);
      },
    );
    this.unlistenFailed = await listen<string>('pools:dns-failed', (e) => {
      this.dnsFailed.set(e.payload);
    });
  }

  async list(network: string): Promise<PoolEntry[]> {
    await this.init();
    const result = await invoke<CommandResult<PoolEntry[]>>('list_pools', { network });
    const pools = result.success && result.data ? result.data : [];
    this.pools.update((cur) => ({ ...cur, [network]: pools }));
    return pools;
  }

  async refresh(network: string): Promise<PoolEntry[]> {
    const result = await invoke<CommandResult<PoolEntry[]>>('refresh_pools', { network });
    const pools = result.success && result.data ? result.data : [];
    this.pools.update((cur) => ({ ...cur, [network]: pools }));
    return pools;
  }
}
```

**Step 2: Build the frontend to make sure TS compiles**

Run: `cd web-wallet && npm run build 2>&1 | tail -15`
Expected: build succeeds (or fails only on later integration; if it passes here that's fine).

**Step 3: Commit**

```bash
git add web-wallet/src/app/mining/services/pools.service.ts
git commit -m "Add PoolsService for Angular frontend"
```

---

### Task 4.2 — Replace hardcoded `<option>` block + add ↻ button

**Files:**
- Modify: `web-wallet/src/app/mining/pages/setup-wizard/setup-wizard.component.ts` (lines ~1013–1023, ~3220–3225)

**Step 1: Inject `PoolsService` in the wizard component constructor**

Find the existing `inject(...)` block / constructor in `setup-wizard.component.ts`. Add:

```ts
private readonly pools = inject(PoolsService);
```

And add a signal to hold the current network's pools:

```ts
poolList = signal<PoolEntry[]>([]);
poolsRefreshing = signal(false);
```

**Step 2: Load pools when the chain modal opens**

Wherever `chainModalData` is initialized for a new chain, add:

```ts
this.pools.list(this.activeNetwork()).then((p) => this.poolList.set(p));
```

(Use whatever `activeNetwork()` accessor already exists — if not, hardcode `'mainnet'` for now and revisit.)

**Step 3: Replace the hardcoded `<option>` block (lines 1013–1023)**

Old:

```html
<option value="">{{ 'setup_select_pool_placeholder' | i18n }}</option>
<option value="https://pool.bitcoin-pocx.org:443">
  Nogrod Mainnet (pool.bitcoin-pocx.org)
</option>
<option value="https://pool.testnet.bitcoin-pocx.org:443">
  Nogrod Testnet (pool.testnet.bitcoin-pocx.org)
</option>
<option value="https://btcx-pool.cryptoguru.org:443">
  CryptoGuru Mainnet (btcx-pool.cryptoguru.org)
</option>
```

New (inside the same `<select>`):

```html
<option value="">{{ 'setup_select_pool_placeholder' | i18n }}</option>
@for (p of poolList(); track p.host + ':' + p.port) {
  <option [value]="p.url">{{ p.name }} ({{ p.host }})</option>
}
```

And add a refresh button next to the select (immediately after the closing `</select>`):

```html
<button type="button"
        class="btn-icon"
        [disabled]="poolsRefreshing()"
        (click)="onRefreshPools()"
        title="Refresh pool list from DNS">↻</button>
```

**Step 4: Add the `onRefreshPools` handler in the component class**

```ts
async onRefreshPools(): Promise<void> {
  this.poolsRefreshing.set(true);
  try {
    const fresh = await this.pools.refresh(this.activeNetwork());
    this.poolList.set(fresh);
  } finally {
    this.poolsRefreshing.set(false);
  }
}
```

**Step 5: Update the friendly-name lookup at lines 3220–3225**

Old:

```ts
let poolName: string;
if (data.poolUrl.includes('pool.testnet.bitcoin-pocx.org')) {
  poolName = 'Nogrod Testnet';
} else if (data.poolUrl.includes('pool.bitcoin-pocx.org')) {
  poolName = 'Nogrod Mainnet';
} else if (data.poolUrl.includes('btcx-pool.cryptoguru.org')) {
  poolName = 'CryptoGuru Mainnet';
} else {
  poolName = ...; // fallback
}
```

New (add after the existing `poolName` resolution and before any fallback):

```ts
const matched = this.poolList().find((p) => data.poolUrl.startsWith(p.url));
let poolName = matched?.name ?? /* keep existing fallback */ data.poolUrl;
```

Remove the old `if/else if` chain.

**Step 6: Build**

Run: `cd web-wallet && npm run build 2>&1 | tail -15`
Expected: success.

**Step 7: Commit**

```bash
git add web-wallet/src/app/mining/pages/setup-wizard/setup-wizard.component.ts
git commit -m "Wire setup-wizard pool dropdown to PoolsService"
```

---

### Task 4.3 — DNS-failed toast

**Files:**
- Modify: `web-wallet/src/app/mining/pages/setup-wizard/setup-wizard.component.ts`

**Step 1: Watch the `pools.dnsFailed` signal**

Inside the wizard component (in `ngOnInit` or constructor):

```ts
effect(() => {
  const failed = this.pools.dnsFailed();
  if (failed) {
    // Use whatever toast/snackbar service the project already has.
    // If `MatSnackBar` is already used elsewhere, reuse it; otherwise just `console.warn`
    // and add a TODO for design follow-up.
    this.snackBar?.open(
      `Couldn't reach pool directory; showing built-in list.`,
      'Dismiss',
      { duration: 4000 },
    );
  }
});
```

**Step 2: Build**

Run: `cd web-wallet && npm run build 2>&1 | tail -15`
Expected: success.

**Step 3: Commit**

```bash
git add web-wallet/src/app/mining/pages/setup-wizard/setup-wizard.component.ts
git commit -m "Show toast when pool DNS resolution fails"
```

---

## Phase 5 — Docs

### Task 5.1 — Write `docs/pools-dns-setup.md`

**Files:**
- Create: `docs/pools-dns-setup.md`

**Step 1: Write the document**

(Skeleton — flesh out to the section list in the design doc §3.)

```markdown
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

## Removing a pool

Delete all three records (PTR, SRV, TXT). The wallet's hardcoded
fallback list still includes the original three pools, so they cannot
be hidden via DNS — only demoted or supplemented.

## Setting priority for decentralization

Lower SRV priority = preferred. To rebalance load toward smaller pools,
set the small pool to e.g. `10` and the larger to `20`. Within equal
priority, higher SRV weight wins — useful for fine-grained percentage
splits.

## Testing

```bash
dig +short SRV  _pool._tcp.bitcoin-pocx.org
dig +short PTR  _pool._tcp.bitcoin-pocx.org
dig +short TXT  nogrod._pool._tcp.bitcoin-pocx.org
```

Compare both authorities — they should return identical sets.

## TXT key reference

| Key | Required | Notes |
|------|--------|------|
| `name` | yes | display label |
| `operator` | no | tooltip / subtitle |
| `url` | no | overrides default `https://{host}:{port}` |
| anything else | no | preserved in `extras` |

## Troubleshooting

- **TTL too low** → DNS chatter; we recommend 300s.
- **Port 53 blocked** on a user's network → wallet falls back to
  static list and shows a toast. v1 has no DoH support.
- **Mirror drift** → wallet uses whichever authority responded first;
  the other's data is silently ignored.
```

**Step 2: Commit**

```bash
git add docs/pools-dns-setup.md
git commit -m "Add operator setup guide for DNS-SD pool discovery"
```

---

## Phase 6 — Validation

### Task 6.1 — Manual smoke test

**No code changes; a checklist.**

- [ ] `cargo test --lib pools::` — all green.
- [ ] `npm run build` — clean build.
- [ ] `npm run tauri:dev` — launches without errors.
- [ ] Setup wizard → "Add chain" → pool dropdown populated with the 2 mainnet entries (cache cold, no DNS).
- [ ] Click ↻ — without DNS records published yet, expect toast "Couldn't reach pool directory".
- [ ] (Optional) Stand up a local resolver with the schema in `docs/pools-dns-setup.md` and verify the dropdown gains DNS-discovered entries with the right priority order.

### Task 6.2 — Open PR

```bash
gh pr create --base master --title "Pool discovery via DNS-SD" --body "$(cat <<'EOF'
## Summary

- Replace the hardcoded pool dropdown with a DNS-SD discovered list.
- Two mirror authorities (`bitcoin-pocx.org`, `bitcoin-pocx.bootseed.net`).
- Hardcoded list kept as fallback floor — DNS can promote/demote/add but
  not delete.
- See `docs/plans/2026-05-05-pool-discovery-dns-sd-design.md` for the
  validated design and `docs/pools-dns-setup.md` for the operator guide.

## Test plan

- [x] `cargo test --lib pools::` — unit tests for parser, merger, cache, resolver.
- [x] `npm run build` — TypeScript clean.
- [ ] Manual smoke per the validation checklist in the implementation plan.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
