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
