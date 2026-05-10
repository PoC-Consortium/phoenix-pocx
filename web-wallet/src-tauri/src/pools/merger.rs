//! Merge static fallback pools with DNS-discovered ones.

use crate::pools::{
    resolver::DiscoveredPool, NetworkScope, PoolEntry, PoolSource, STATIC_POOLS,
};
use std::collections::BTreeMap;

/// Merge static + discovered into a sorted, deduped `Vec<PoolEntry>`.
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
