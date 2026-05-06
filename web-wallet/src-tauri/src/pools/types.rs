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
