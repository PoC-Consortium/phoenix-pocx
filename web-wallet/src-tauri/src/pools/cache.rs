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
    let parsed: CacheFile = match serde_json::from_slice(&bytes) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("pools_cache.json failed to parse; treating as empty: {}", e);
            return Vec::new();
        }
    };
    if parsed.version != SCHEMA_VERSION {
        log::info!(
            "pools_cache.json version {} != expected {}; treating as empty",
            parsed.version,
            SCHEMA_VERSION
        );
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
        Ok(b) => match serde_json::from_slice::<CacheFile>(&b) {
            Ok(c) => c,
            Err(e) => {
                log::warn!(
                    "pools_cache.json was corrupt; overwriting fresh ({}). Other-network entries may be lost.",
                    e
                );
                CacheFile {
                    version: SCHEMA_VERSION,
                    by_network: HashMap::new(),
                }
            }
        },
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
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
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
