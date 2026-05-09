//! Pool discovery — DNS-SD (RFC 6763) + static fallback.

pub mod commands;
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
