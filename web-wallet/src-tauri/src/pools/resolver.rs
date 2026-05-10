//! DNS-SD resolver for pool discovery.

use std::collections::BTreeMap;
use std::time::Duration;

use async_trait::async_trait;
use thiserror::Error;

use crate::pools::{DnsAuthority, NetworkScope};

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

#[derive(Debug, Clone, Error)]
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

use crate::pools::AUTHORITIES;
use rand::seq::SliceRandom;

/// Resolve pools for `network` against the configured authorities.
///
/// Tries authorities in a randomized order (deterministic in tests via
/// `order_seed`). On the first error/empty response, falls through to the
/// next authority. Returns the first non-empty result; if all fail, returns
/// the most informative error seen (`Dns`/`Timeout` preferred over `Empty`).
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

    let mut last_err: Option<ResolveError> = None;
    for idx in order {
        let auth = &AUTHORITIES[idx];
        match resolver.resolve_authority(auth, network).await {
            Ok(v) if !v.is_empty() => return Ok(v),
            Ok(_) => {
                // Empty response — only record if we have nothing better.
                if last_err.is_none() {
                    last_err = Some(ResolveError::Empty);
                }
            }
            Err(e) => {
                // Always prefer a real error (Dns/Timeout) over a prior Empty.
                match (&last_err, &e) {
                    (None, _) => last_err = Some(e),
                    (Some(ResolveError::Empty), _) => last_err = Some(e),
                    _ => {} // already have an informative error; keep it.
                }
            }
        }
    }
    Err(last_err.unwrap_or(ResolveError::Empty))
}

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

/// Parsed DNS-SD TXT record: `name` (required for usable entry) + extras.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedTxt {
    pub name: Option<String>,
    pub url: Option<String>,
    pub extras: BTreeMap<String, String>,
}

/// Parse a flat list of DNS-SD TXT character-strings into a `ParsedTxt`.
///
/// Strings without `=` are discarded (per RFC 6763 §6.4 we MAY accept them as
/// boolean flags; we don't use any so they're dropped). `name` and `url` are
/// promoted to dedicated fields; everything else lives in `extras`.
///
/// Per RFC 6763 §6.4: duplicate keys keep the first occurrence; entries with
/// empty keys are discarded.
pub fn parse_txt(strings: &[String]) -> ParsedTxt {
    let mut out = ParsedTxt::default();
    for s in strings {
        let Some(eq) = s.find('=') else {
            continue;
        };
        let key = &s[..eq];
        let val = &s[eq + 1..];
        if key.is_empty() {
            continue; // RFC 6763 §6.4: keys must be at least one character.
        }
        match key {
            "name" if out.name.is_none() => out.name = Some(val.to_string()),
            "url" if out.url.is_none() => out.url = Some(val.to_string()),
            "name" | "url" => {} // first-wins; later duplicates ignored.
            _ => {
                out.extras.entry(key.to_string()).or_insert_with(|| val.to_string());
            }
        }
    }
    out
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

    #[test]
    fn parse_txt_first_wins_for_duplicate_promoted_key() {
        let strings = vec!["name=First".to_string(), "name=Second".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("First"));
    }

    #[test]
    fn parse_txt_first_wins_for_duplicate_extras_key() {
        let strings = vec!["operator=First".to_string(), "operator=Second".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.extras.get("operator").map(String::as_str), Some("First"));
    }

    #[test]
    fn parse_txt_drops_empty_key() {
        let strings = vec!["=orphan".to_string(), "name=Foo".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("Foo"));
        assert!(parsed.extras.is_empty());
    }

    #[test]
    fn parse_txt_keeps_equals_in_value() {
        let strings = vec!["url=https://x.example/api?a=b&c=d".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.url.as_deref(), Some("https://x.example/api?a=b&c=d"));
    }
}

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

    #[tokio::test]
    async fn preserves_dns_error_over_empty_when_both_fail() {
        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "bitcoin-pocx.org",
            Err(ResolveError::Dns("connection refused".into())),
        );
        responses.insert("bitcoin-pocx.bootseed.net", Err(ResolveError::Empty));
        let fake = FakeResolver {
            responses,
            calls: Mutex::new(Vec::new()),
        };
        let err = resolve_pools(&fake, NetworkScope::Mainnet, &[0])
            .await
            .unwrap_err();
        // The Dns error from the first authority should be preserved as the
        // most-informative failure, not overwritten by the later Empty.
        match err {
            ResolveError::Dns(msg) => assert!(msg.contains("connection refused")),
            other => panic!("expected Dns error, got {:?}", other),
        }
    }

    #[test]
    fn const_authorities_listed_in_expected_order() {
        // The tests above depend on this order; pin it.
        assert_eq!(AUTHORITIES[0].label, "bitcoin-pocx.org");
        assert_eq!(AUTHORITIES[1].label, "bitcoin-pocx.bootseed.net");
    }
}
