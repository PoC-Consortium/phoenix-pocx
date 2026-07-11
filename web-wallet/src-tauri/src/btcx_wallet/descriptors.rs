//! Descriptor-import parsing, validation and classification.
//!
//! One paste box, one or two PRIVATE descriptors (whitespace/newline
//! separated). The rules, in the order they are applied:
//!
//! - **Private only (v1).** Public-only descriptors (xpub key material) and
//!   bare xpubs are rejected with the watch-only-not-yet message; bare
//!   xprv/tprv keys are rejected asking for a full descriptor. This same
//!   input is where watch-only (v2) will slot in later.
//! - **Checksums** are optional; when a `#checksum` is present it is
//!   verified (BIP-380) and then stripped — the stored form is the body.
//! - **Pairing.** Two descriptors: same key + same script type, one `/0/*`
//!   (external) and one `/1/*` (internal) tail, either order. One
//!   descriptor: a standard `/0/*` or `/1/*` tail infers the sibling by
//!   swapping the branch index; a multipath `<0;1>` descriptor carries both
//!   branches in one string (split textually — bdk/miniscript cannot
//!   convert a PRIVATE multipath key to its public form, so
//!   `Wallet::create_from_two_path_descriptor` is not usable here); any
//!   other shape needs both descriptors pasted explicitly.
//! - **Single-address (`wpkh(WIF)`).** One `wpkh` descriptor over a single
//!   WIF key (no derivation, no wildcard) imports as a SINGLE-ADDRESS
//!   wallet: one keychain, no internal descriptor — change returns to the
//!   same address (bdk `create_single` semantics). This is deliberate:
//!   vanity/plot addresses are single-key mining identities and spending
//!   must not scatter funds onto other addresses. Segwit only — `pkh(WIF)`
//!   / `tr(WIF)` / `sh(wpkh(WIF))` are rejected, and a BARE WIF paste gets
//!   the wrap-it hint instead of a generic parse error. The WIF's network
//!   byte is validated against the active network like xprv/tprv.
//! - **Classification** from the script type: `wpkh` → BIP-84 (segwit v0,
//!   mining + assignments allowed), `tr` → BIP-86 (taproot), `pkh` /
//!   `sh(wpkh)` → legacy (funds visible + spendable, mining/assignments
//!   gated — a plot account_id is a segwit-v0 witness program). Everything
//!   else is unsupported in v1.
//! - **Network.** The key prefix (xprv vs tprv) must match the active
//!   network: mainnet keys are `xprv`, testnet/regtest keys are `tprv`.
//!   The chain binding itself stays bdk's genesis-hash check at open.
//! - **Coin type** is parsed from the derivation path when present —
//!   informational only (display), never used for gating.
//!
//! The final gate is bdk itself: the pair is built into a throwaway
//! in-memory wallet (`create_wallet_no_persist`), the exact validation the
//! real store creation runs later.

use bdk_wallet::miniscript::descriptor::{DescriptorSecretKey, DescriptorType, KeyMap};
use bdk_wallet::miniscript::{Descriptor, DescriptorPublicKey, ForEachKey};
use bdk_wallet::Wallet;
use bitcoin::bip32::ChildNumber;
use bitcoin::secp256k1::Secp256k1;
use bitcoin::NetworkKind;
use serde::Serialize;

use super::config::{DescriptorKindCfg, WalletNetwork};

/// A structured import error: `code` keys the translated UI message,
/// `message` carries the English detail.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub code: &'static str,
    pub message: String,
}

impl ImportError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// A validated descriptor import, ready to store and open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedImport {
    /// External (receive) private descriptor, checksum-stripped.
    pub external: String,
    /// Internal (change) private descriptor, checksum-stripped. `None` for
    /// a single-address `wpkh(WIF)` wallet: ONE keychain, change returns
    /// to the same address (bdk `create_single`).
    pub internal: Option<String>,
    /// Script-type classification (drives badges + mining/assignment gates).
    pub kind: DescriptorKindCfg,
    /// BIP32 coin type parsed from the derivation path, if any —
    /// informational only.
    pub coin_type: Option<u32>,
    /// The internal descriptor was inferred by swapping the branch index.
    pub inferred_internal: bool,
    /// Both branches came from one multipath `<0;1>` descriptor.
    pub from_multipath: bool,
}

impl ParsedImport {
    /// Single-address wallet (`wpkh(WIF)`, no internal descriptor).
    pub fn single_address(&self) -> bool {
        self.internal.is_none()
    }
}

/// Pre-submit validation feedback for the import form
/// (`btcx_wallet_validate_import`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportValidation {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<DescriptorKindCfg>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coin_type: Option<u32>,
    pub inferred_internal: bool,
    pub from_multipath: bool,
    /// Single-address `wpkh(WIF)` wallet — change returns to the same
    /// address (the import form's verdict line).
    pub single_address: bool,
}

impl ImportValidation {
    pub fn from_result(result: &Result<ParsedImport, ImportError>) -> Self {
        match result {
            Ok(parsed) => Self {
                valid: true,
                code: None,
                message: None,
                kind: Some(parsed.kind),
                coin_type: parsed.coin_type,
                inferred_internal: parsed.inferred_internal,
                from_multipath: parsed.from_multipath,
                single_address: parsed.single_address(),
            },
            Err(e) => Self {
                valid: false,
                code: Some(e.code),
                message: Some(e.message.clone()),
                kind: None,
                coin_type: None,
                inferred_internal: false,
                from_multipath: false,
                single_address: false,
            },
        }
    }
}

/// The `bitcoin::Network` a descriptor wallet's bdk store is created with.
/// Only key serialization checks hang off it — the real chain binding is
/// the BTCX genesis-hash checkpoint (see `manager::open_wallet`). All
/// test-family networks share `tprv`, so `Testnet` covers regtest too.
pub fn bdk_network(network: WalletNetwork) -> bitcoin::Network {
    match network {
        WalletNetwork::Mainnet => bitcoin::Network::Bitcoin,
        WalletNetwork::Testnet | WalletNetwork::Regtest => bitcoin::Network::Testnet,
    }
}

fn expected_network_kind(network: WalletNetwork) -> NetworkKind {
    match network {
        WalletNetwork::Mainnet => NetworkKind::Main,
        WalletNetwork::Testnet | WalletNetwork::Regtest => NetworkKind::Test,
    }
}

const WATCH_ONLY_MESSAGE: &str = "Watch-only wallets are not supported yet — paste the PRIVATE \
     descriptor (it contains an xprv/tprv key)";

/// Base58 body after a recognized extended-key prefix.
fn is_base58_tail(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() && !"0OIl".contains(c))
}

/// Whether `token` is a bare extended key of the given prefix family
/// (BIP32 + the SLIP-132 y/z/u/v variants).
fn bare_key_family(token: &str, families: [&str; 5]) -> bool {
    families
        .iter()
        .any(|p| token.strip_prefix(p).is_some_and(is_base58_tail))
}

/// Verify (when present) and strip the `#checksum` suffix.
fn strip_checksum(token: &str) -> Result<String, ImportError> {
    let Some((body, given)) = token.rsplit_once('#') else {
        return Ok(token.to_string());
    };
    let computed = bdk_wallet::miniscript::descriptor::checksum::desc_checksum(body)
        .map_err(|e| ImportError::new("parse", format!("descriptor checksum: {e}")))?;
    if computed != given {
        return Err(ImportError::new(
            "parse",
            format!("descriptor checksum mismatch (expected #{computed})"),
        ));
    }
    Ok(body.to_string())
}

/// Classify one whitespace-separated token of the paste box.
fn check_token(token: &str) -> Result<(), ImportError> {
    if bare_key_family(token, ["xpub", "ypub", "zpub", "Ypub", "Zpub"])
        || bare_key_family(token, ["tpub", "upub", "vpub", "Upub", "Vpub"])
    {
        return Err(ImportError::new("watch_only", WATCH_ONLY_MESSAGE));
    }
    if bare_key_family(token, ["xprv", "yprv", "zprv", "Yprv", "Zprv"])
        || bare_key_family(token, ["tprv", "uprv", "vprv", "Uprv", "Vprv"])
    {
        return Err(ImportError::new(
            "bare_key",
            "Paste a full descriptor (wpkh(...) or tr(...)), not a bare extended key",
        ));
    }
    // A bare WIF private key (base58check-decodable) gets the wrap-it hint
    // instead of the generic not-a-descriptor error — the vanity-address
    // path into the single-address wallet import.
    if bitcoin::PrivateKey::from_wif(token).is_ok() {
        return Err(ImportError::new(
            "bare_wif",
            "That is a bare WIF private key — wrap it as wpkh(YOUR_WIF) to import it as a \
             single-address wallet",
        ));
    }
    if !token.contains('(') {
        return Err(ImportError::new(
            "parse",
            "Not a descriptor — expected wpkh(...) or tr(...)",
        ));
    }
    Ok(())
}

/// The `/0/*` / `/1/*` branch tail of one single-path descriptor body, when
/// it has exactly one such tail: `Some((branch, sibling_body))`.
fn branch_and_sibling(body: &str) -> Option<(u32, String)> {
    let zeros = body.matches("/0/*").count();
    let ones = body.matches("/1/*").count();
    match (zeros, ones) {
        (1, 0) => Some((0, body.replacen("/0/*", "/1/*", 1))),
        (0, 1) => Some((1, body.replacen("/1/*", "/0/*", 1))),
        _ => None,
    }
}

/// One parsed descriptor of the pair, with everything the pair-level checks
/// need.
struct ParsedSide {
    body: String,
    kind: DescriptorKindCfg,
    coin_type: Option<u32>,
    /// `(origin, account xprv)` of every secret key, sorted — the same-key
    /// pair check compares these.
    keys: Vec<String>,
    network: Option<NetworkKind>,
    /// Non-ranged `wpkh` over a single WIF key — imports as a
    /// single-address wallet (one keychain, change to self).
    single_address: bool,
}

fn classify_type(desc: &Descriptor<DescriptorPublicKey>) -> Result<DescriptorKindCfg, ImportError> {
    match desc.desc_type() {
        DescriptorType::Wpkh => Ok(DescriptorKindCfg::Bip84),
        DescriptorType::Tr => Ok(DescriptorKindCfg::Bip86),
        DescriptorType::Pkh | DescriptorType::ShWpkh => Ok(DescriptorKindCfg::Legacy),
        other => Err(ImportError::new(
            "unsupported_type",
            format!(
                "Unsupported descriptor type {other:?} — supported: wpkh (segwit), tr (taproot), \
                 pkh / sh(wpkh) (legacy)"
            ),
        )),
    }
}

/// Coin type from a secret key's paths: prefer the key origin
/// (`[fp/84'/coin'/0']`), else the in-descriptor derivation path of a
/// master key (`tprv.../84'/coin'/0'/0/*`). Hardened second element only.
fn coin_type_of(secret: &DescriptorSecretKey) -> Option<u32> {
    let DescriptorSecretKey::XPrv(xkey) = secret else {
        return None;
    };
    let from_path = |path: &[ChildNumber]| match path.get(1) {
        Some(ChildNumber::Hardened { index }) => Some(*index),
        _ => None,
    };
    if let Some((_, origin_path)) = &xkey.origin {
        if origin_path.len() >= 2 {
            return from_path(origin_path.as_ref());
        }
    }
    let path: &[ChildNumber] = xkey.derivation_path.as_ref();
    if path.len() >= 3 {
        return from_path(path);
    }
    None
}

fn parse_side(body: &str, network: WalletNetwork) -> Result<ParsedSide, ImportError> {
    let secp = Secp256k1::new();
    let (desc, keymap): (Descriptor<DescriptorPublicKey>, KeyMap) =
        Descriptor::parse_descriptor(&secp, body)
            .map_err(|e| ImportError::new("parse", format!("Not a valid descriptor: {e}")))?;

    // Private-only (v1): every key must carry its secret. A public-only
    // descriptor has an empty keymap; a mixed one comes up short.
    let mut key_count = 0usize;
    desc.for_each_key(|_| {
        key_count += 1;
        true
    });
    if keymap.len() < key_count {
        return Err(ImportError::new("watch_only", WATCH_ONLY_MESSAGE));
    }

    let kind = classify_type(&desc)?;

    // Single WIF keys (no derivation, no wildcard) are the single-address
    // wallet form — segwit only. Everything else must be ranged.
    let all_single_keys = !keymap.is_empty()
        && keymap
            .values()
            .all(|secret| matches!(secret, DescriptorSecretKey::Single(_)));
    let single_address = if desc.has_wildcard() {
        false
    } else if all_single_keys {
        if kind != DescriptorKindCfg::Bip84 {
            return Err(ImportError::new(
                "wif_not_segwit",
                "Only wpkh(WIF) is supported for single-key imports — segwit only (pkh, tr and \
                 sh(wpkh) forms are rejected)",
            ));
        }
        true
    } else {
        return Err(ImportError::new(
            "not_ranged",
            "The descriptor must be ranged (its derivation must end in /*)",
        ));
    };

    // Key network (xprv vs tprv, or the WIF network byte) against the
    // active app network.
    let mut network_kind = None;
    for secret in keymap.values() {
        let (this, is_wif) = match secret {
            DescriptorSecretKey::XPrv(x) => (x.xkey.network, false),
            DescriptorSecretKey::MultiXPrv(x) => (x.xkey.network, false),
            DescriptorSecretKey::Single(s) => (s.key.network, true),
        };
        network_kind = Some(this);
        if this != expected_network_kind(network) {
            let (have, want) = match (this, is_wif) {
                (NetworkKind::Main, false) => ("a mainnet key (xprv)", "tprv"),
                (NetworkKind::Test, false) => ("a testnet key (tprv)", "xprv"),
                (NetworkKind::Main, true) => ("a mainnet WIF key", "testnet WIF"),
                (NetworkKind::Test, true) => ("a testnet WIF key", "mainnet WIF"),
            };
            return Err(ImportError::new(
                "wrong_network",
                format!(
                    "The descriptor contains {have} but the active network is {} — {want} keys \
                     are required here",
                    network.as_str()
                ),
            ));
        }
    }

    // The same-key pair check compares origin + xprv, branch-independent
    // (the branch lives in `derivation_path`, deliberately excluded).
    let mut keys: Vec<String> = keymap
        .values()
        .map(|secret| match secret {
            DescriptorSecretKey::XPrv(x) => format!("{:?}:{}", x.origin, x.xkey),
            DescriptorSecretKey::MultiXPrv(x) => format!("{:?}:{}", x.origin, x.xkey),
            DescriptorSecretKey::Single(s) => s.key.to_wif(),
        })
        .collect();
    keys.sort();

    let coin_type = keymap.values().find_map(coin_type_of);

    Ok(ParsedSide {
        body: body.to_string(),
        kind,
        coin_type,
        keys,
        network: network_kind,
        single_address,
    })
}

/// Parse + validate the import paste box: one or two private descriptors
/// for `network`. See the module docs for the full rule set.
pub fn parse_import(input: &str, network: WalletNetwork) -> Result<ParsedImport, ImportError> {
    let tokens: Vec<&str> = input.split_whitespace().collect();
    let (external_body, internal_body, inferred_internal, from_multipath) = match tokens.as_slice()
    {
        [] => {
            return Err(ImportError::new("empty", "Paste a descriptor to import"));
        }
        [single] => {
            check_token(single)?;
            let body = strip_checksum(single)?;
            if body.contains('<') {
                // Multipath: only the standard <0;1> receive/change pair.
                // Split textually — a PRIVATE multipath key cannot be
                // parsed to its public form by miniscript 12 / bdk 2.
                if body.matches('<').count() != 1 || !body.contains("<0;1>") {
                    return Err(ImportError::new(
                        "multipath_nonstandard",
                        "Only the standard <0;1> receive/change multipath is supported — paste \
                         the external and internal descriptors separately",
                    ));
                }
                (
                    body.replacen("<0;1>", "0", 1),
                    body.replacen("<0;1>", "1", 1),
                    false,
                    true,
                )
            } else {
                // Parse the lone descriptor FIRST so the precise error
                // (watch-only, wrong network, not ranged, unsupported
                // type) wins over the generic paste-both message.
                let side = parse_side(&body, network)?;
                if side.single_address {
                    // `wpkh(WIF)` — a single-address wallet: one keychain,
                    // no internal descriptor, change returns to the same
                    // address. Honor check with the exact single-keychain
                    // build the real store creation runs later.
                    Wallet::create_single(body.clone())
                        .network(bdk_network(network))
                        .create_wallet_no_persist()
                        .map_err(|e| {
                            ImportError::new("parse", format!("Descriptor rejected: {e}"))
                        })?;
                    return Ok(ParsedImport {
                        external: body,
                        internal: None,
                        kind: side.kind,
                        coin_type: side.coin_type,
                        inferred_internal: false,
                        from_multipath: false,
                    });
                }
                match branch_and_sibling(&body) {
                    Some((0, sibling)) => (body, sibling, true, false),
                    Some((_, sibling)) => (sibling, body, true, false),
                    None => {
                        return Err(ImportError::new(
                            "needs_internal",
                            "The derivation does not end in the standard /0/* or /1/* branch — \
                             paste BOTH the external and internal descriptors (separated by a \
                             newline)",
                        ));
                    }
                }
            }
        }
        [first, second] => {
            check_token(first)?;
            check_token(second)?;
            let first = strip_checksum(first)?;
            let second = strip_checksum(second)?;
            if first.contains('<') || second.contains('<') {
                return Err(ImportError::new(
                    "multipath_nonstandard",
                    "A multipath descriptor already contains both branches — paste it alone",
                ));
            }
            let (Some((first_branch, _)), Some((second_branch, _))) =
                (branch_and_sibling(&first), branch_and_sibling(&second))
            else {
                return Err(ImportError::new(
                    "pair_mismatch",
                    "Each descriptor must end in the standard /0/* (external) or /1/* (internal) \
                     branch",
                ));
            };
            match (first_branch, second_branch) {
                (0, 1) => (first, second, false, false),
                (1, 0) => (second, first, false, false),
                _ => {
                    return Err(ImportError::new(
                        "pair_mismatch",
                        "Expected one external (/0/*) and one internal (/1/*) descriptor — got \
                         two of the same branch",
                    ));
                }
            }
        }
        more => {
            return Err(ImportError::new(
                "too_many",
                format!(
                    "Expected one or two descriptors, got {} — paste the external and internal \
                     descriptors only",
                    more.len()
                ),
            ));
        }
    };

    let external = parse_side(&external_body, network)?;
    let internal = parse_side(&internal_body, network)?;

    if external.kind != internal.kind {
        return Err(ImportError::new(
            "pair_mismatch",
            "The two descriptors have different script types",
        ));
    }
    if external.keys != internal.keys || external.network != internal.network {
        return Err(ImportError::new(
            "pair_mismatch",
            "The two descriptors use different keys — external and internal must derive from \
             the same key",
        ));
    }
    if external.body == internal.body {
        return Err(ImportError::new(
            "pair_mismatch",
            "External and internal descriptors are identical",
        ));
    }

    // The final honor check is bdk itself: build the pair into a throwaway
    // in-memory wallet — exactly what the real store creation validates.
    Wallet::create(external.body.clone(), internal.body.clone())
        .network(bdk_network(network))
        .create_wallet_no_persist()
        .map_err(|e| ImportError::new("parse", format!("Descriptor pair rejected: {e}")))?;

    Ok(ParsedImport {
        external: external.body,
        internal: Some(internal.body),
        kind: external.kind,
        coin_type: external.coin_type.or(internal.coin_type),
        inferred_internal,
        from_multipath,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::bip32::Xpriv;
    use keys_btcx::COIN_BTCX;

    /// Deterministic test master keys (NOT real wallets).
    fn master(network: NetworkKind) -> Xpriv {
        Xpriv::new_master(network, &[7u8; 32]).unwrap()
    }

    /// Account-level key at `m/purpose'/coin'/0'` with full origin, the
    /// shape `keys_btcx::WalletSeed::wallet_descriptors` (and Bitcoin
    /// Core's `listdescriptors true`) emits.
    fn account_desc(
        network: NetworkKind,
        func: &str,
        purpose: u32,
        coin: u32,
        branch: u32,
    ) -> String {
        let secp = Secp256k1::new();
        let master = master(network);
        let path: Vec<ChildNumber> = [purpose, coin, 0]
            .iter()
            .map(|&i| ChildNumber::from_hardened_idx(i).unwrap())
            .collect();
        let account = master.derive_priv(&secp, &path).unwrap();
        let fp = master.fingerprint(&secp);
        format!("{func}([{fp}/{purpose}'/{coin}'/0']{account}/{branch}/*)")
    }

    fn tprv_wpkh(branch: u32) -> String {
        account_desc(NetworkKind::Test, "wpkh", 84, 1, branch)
    }

    #[test]
    fn single_external_infers_internal() {
        let parsed = parse_import(&tprv_wpkh(0), WalletNetwork::Regtest).unwrap();
        assert_eq!(parsed.external, tprv_wpkh(0));
        assert_eq!(parsed.internal.as_deref(), Some(tprv_wpkh(1).as_str()));
        assert!(parsed.inferred_internal);
        assert!(!parsed.from_multipath);
        assert_eq!(parsed.kind, DescriptorKindCfg::Bip84);
        assert_eq!(parsed.coin_type, Some(1));
    }

    #[test]
    fn single_internal_infers_external() {
        let parsed = parse_import(&tprv_wpkh(1), WalletNetwork::Regtest).unwrap();
        assert_eq!(parsed.external, tprv_wpkh(0));
        assert_eq!(parsed.internal.as_deref(), Some(tprv_wpkh(1).as_str()));
        assert!(parsed.inferred_internal);
    }

    #[test]
    fn explicit_pair_either_order() {
        let input = format!("{}\n{}", tprv_wpkh(1), tprv_wpkh(0));
        let parsed = parse_import(&input, WalletNetwork::Regtest).unwrap();
        assert_eq!(parsed.external, tprv_wpkh(0));
        assert_eq!(parsed.internal.as_deref(), Some(tprv_wpkh(1).as_str()));
        assert!(!parsed.inferred_internal);
    }

    #[test]
    fn checksummed_descriptor_accepted_and_wrong_checksum_rejected() {
        let body = tprv_wpkh(0);
        let checksum = bdk_wallet::miniscript::descriptor::checksum::desc_checksum(&body).unwrap();
        let parsed = parse_import(&format!("{body}#{checksum}"), WalletNetwork::Regtest).unwrap();
        assert_eq!(parsed.external, body, "stored form is checksum-stripped");

        let err = parse_import(&format!("{body}#00000000"), WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "parse");
        assert!(err.message.contains("checksum"), "{err}");
    }

    #[test]
    fn multipath_standard_splits_into_both_branches() {
        // Build `.../<0;1>/*` from the account descriptor textually — the
        // exact multipath shape Core exports.
        let multipath = tprv_wpkh(0).replacen("/0/*", "/<0;1>/*", 1);
        let parsed = parse_import(&multipath, WalletNetwork::Regtest).unwrap();
        assert_eq!(parsed.external, tprv_wpkh(0));
        assert_eq!(parsed.internal.as_deref(), Some(tprv_wpkh(1).as_str()));
        assert!(parsed.from_multipath);
        assert!(!parsed.inferred_internal);
    }

    #[test]
    fn multipath_nonstandard_rejected() {
        let odd = tprv_wpkh(0).replacen("/0/*", "/<0;2>/*", 1);
        let err = parse_import(&odd, WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "multipath_nonstandard");

        // A multipath descriptor next to a second descriptor is refused too.
        let multipath = tprv_wpkh(0).replacen("/0/*", "/<0;1>/*", 1);
        let err = parse_import(
            &format!("{multipath} {}", tprv_wpkh(1)),
            WalletNetwork::Regtest,
        )
        .unwrap_err();
        assert_eq!(err.code, "multipath_nonstandard");
    }

    #[test]
    fn nonstandard_branch_needs_both() {
        let odd = tprv_wpkh(0).replacen("/0/*", "/5/*", 1);
        let err = parse_import(&odd, WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "needs_internal");
    }

    #[test]
    fn pair_mismatches_are_rejected() {
        // Two of the same branch.
        let err = parse_import(
            &format!("{} {}", tprv_wpkh(0), tprv_wpkh(0)),
            WalletNetwork::Regtest,
        )
        .unwrap_err();
        assert_eq!(err.code, "pair_mismatch");

        // Different script types over the same key.
        let tr = account_desc(NetworkKind::Test, "tr", 84, 1, 1);
        let err =
            parse_import(&format!("{} {tr}", tprv_wpkh(0)), WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "pair_mismatch");

        // Different keys (another purpose derives another account xprv).
        let other = account_desc(NetworkKind::Test, "wpkh", 49, 1, 1);
        let err =
            parse_import(&format!("{} {other}", tprv_wpkh(0)), WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "pair_mismatch");
    }

    #[test]
    fn bare_keys_and_watch_only_are_rejected() {
        // Bare tprv: full-descriptor demand.
        let key = master(NetworkKind::Test).to_string();
        let err = parse_import(&key, WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "bare_key");
        assert!(err.message.contains("full descriptor"), "{err}");

        // Bare xpub / tpub: watch-only-not-yet.
        let secp = Secp256k1::new();
        let tpub = bitcoin::bip32::Xpub::from_priv(&secp, &master(NetworkKind::Test));
        let err = parse_import(&tpub.to_string(), WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "watch_only");

        // Public-only descriptor: watch-only-not-yet.
        let err = parse_import(&format!("wpkh({tpub}/0/*)"), WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "watch_only");
        assert!(err.message.contains("Watch-only"), "{err}");
    }

    #[test]
    fn network_mismatch_is_rejected_both_ways() {
        // tprv keys on mainnet.
        let err = parse_import(&tprv_wpkh(0), WalletNetwork::Mainnet).unwrap_err();
        assert_eq!(err.code, "wrong_network");
        assert!(err.message.contains("mainnet"), "{err}");

        // xprv keys on regtest.
        let xprv_desc = account_desc(NetworkKind::Main, "wpkh", 84, COIN_BTCX, 0);
        let err = parse_import(&xprv_desc, WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "wrong_network");

        // ... and the same xprv descriptor is fine on mainnet.
        let parsed = parse_import(&xprv_desc, WalletNetwork::Mainnet).unwrap();
        assert_eq!(parsed.kind, DescriptorKindCfg::Bip84);
        assert_eq!(parsed.coin_type, Some(COIN_BTCX));
    }

    #[test]
    fn keys_btcx_descriptors_import_as_their_own_branch() {
        // The pair our own seed stack derives must round-trip through the
        // import parser (xprv serialization → mainnet).
        let seed = keys_btcx::WalletSeed::from_mnemonic(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon about",
            "",
        )
        .unwrap();
        let (external, internal) = seed
            .wallet_descriptors(keys_btcx::DescriptorKind::Bip84, COIN_BTCX)
            .unwrap();
        let parsed = parse_import(&external, WalletNetwork::Mainnet).unwrap();
        assert_eq!(
            parsed.internal.as_deref(),
            Some(internal.as_str()),
            "sibling inference matches keys-btcx"
        );
        assert_eq!(parsed.kind, DescriptorKindCfg::Bip84);
        assert_eq!(parsed.coin_type, Some(COIN_BTCX));
    }

    #[test]
    fn classification_covers_all_supported_types() {
        let cases = [
            ("wpkh", DescriptorKindCfg::Bip84),
            ("tr", DescriptorKindCfg::Bip86),
            ("pkh", DescriptorKindCfg::Legacy),
        ];
        for (func, kind) in cases {
            let desc = account_desc(NetworkKind::Test, func, 84, 1, 0);
            let parsed = parse_import(&desc, WalletNetwork::Regtest).unwrap();
            assert_eq!(parsed.kind, kind, "{func}");
        }

        // sh(wpkh(...)) → legacy.
        let inner = account_desc(NetworkKind::Test, "wpkh", 49, 1, 0);
        let sh = format!("sh({inner})");
        let parsed = parse_import(&sh, WalletNetwork::Regtest).unwrap();
        assert_eq!(parsed.kind, DescriptorKindCfg::Legacy);

        // wsh(pk(...)) → unsupported in v1.
        let wsh = format!("wsh(pk({}/0/*))", master(NetworkKind::Test));
        let err = parse_import(&wsh, WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "unsupported_type");
    }

    #[test]
    fn unranged_and_garbage_are_rejected() {
        let fixed = tprv_wpkh(0).replacen("/0/*", "/0/5", 1);
        let err = parse_import(&fixed, WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "not_ranged");

        assert_eq!(
            parse_import("", WalletNetwork::Regtest).unwrap_err().code,
            "empty"
        );
        assert_eq!(
            parse_import("hello world garbage", WalletNetwork::Regtest)
                .unwrap_err()
                .code,
            "too_many"
        );
        assert_eq!(
            parse_import("garbage", WalletNetwork::Regtest)
                .unwrap_err()
                .code,
            "parse"
        );
    }

    /// A deterministic WIF key of the given network (NOT a real wallet).
    fn wif(network: NetworkKind) -> String {
        let secret = bitcoin::secp256k1::SecretKey::from_slice(&[0x42u8; 32]).unwrap();
        bitcoin::PrivateKey::new(secret, network).to_wif()
    }

    #[test]
    fn wpkh_wif_imports_as_single_address_wallet() {
        // Testnet WIF on regtest (WIF has no regtest-specific byte).
        let input = format!("wpkh({})", wif(NetworkKind::Test));
        let parsed = parse_import(&input, WalletNetwork::Regtest).unwrap();
        assert_eq!(parsed.external, input);
        assert_eq!(parsed.internal, None, "single keychain — no internal");
        assert!(parsed.single_address());
        assert_eq!(parsed.kind, DescriptorKindCfg::Bip84);
        assert_eq!(parsed.coin_type, None, "a WIF has no derivation path");
        assert!(!parsed.inferred_internal);
        assert!(!parsed.from_multipath);

        // Mainnet WIF on mainnet works the same way...
        let input = format!("wpkh({})", wif(NetworkKind::Main));
        let parsed = parse_import(&input, WalletNetwork::Mainnet).unwrap();
        assert!(parsed.single_address());

        // ...and a checksummed paste is accepted, stored checksum-stripped.
        let body = format!("wpkh({})", wif(NetworkKind::Test));
        let checksum = bdk_wallet::miniscript::descriptor::checksum::desc_checksum(&body).unwrap();
        let parsed = parse_import(&format!("{body}#{checksum}"), WalletNetwork::Regtest).unwrap();
        assert_eq!(parsed.external, body);
        assert!(parsed.single_address());
    }

    #[test]
    fn wif_wrong_network_is_rejected_both_ways() {
        let err = parse_import(
            &format!("wpkh({})", wif(NetworkKind::Main)),
            WalletNetwork::Regtest,
        )
        .unwrap_err();
        assert_eq!(err.code, "wrong_network");
        assert!(err.message.contains("mainnet WIF"), "{err}");

        let err = parse_import(
            &format!("wpkh({})", wif(NetworkKind::Test)),
            WalletNetwork::Mainnet,
        )
        .unwrap_err();
        assert_eq!(err.code, "wrong_network");
        assert!(err.message.contains("testnet WIF"), "{err}");
    }

    #[test]
    fn non_segwit_wif_forms_are_rejected() {
        // pkh(WIF), tr(WIF), sh(wpkh(WIF)): all parse, all classify, all
        // refused — single-key imports are segwit only (owner decision).
        let key = wif(NetworkKind::Test);
        for form in [
            format!("pkh({key})"),
            format!("tr({key})"),
            format!("sh(wpkh({key}))"),
        ] {
            let err = parse_import(&form, WalletNetwork::Regtest).unwrap_err();
            assert_eq!(err.code, "wif_not_segwit", "{form}");
            assert!(err.message.contains("wpkh(WIF)"), "{err}");
        }
    }

    #[test]
    fn bare_wif_gets_the_wrap_hint() {
        for network in [NetworkKind::Test, NetworkKind::Main] {
            let err = parse_import(&wif(network), WalletNetwork::Regtest).unwrap_err();
            assert_eq!(err.code, "bare_wif");
            assert!(err.message.contains("wpkh(YOUR_WIF)"), "{err}");
        }
    }

    #[test]
    fn wif_next_to_a_second_descriptor_is_refused() {
        // A wpkh(WIF) can never form a pair — it has no branch tail.
        let input = format!("wpkh({}) {}", wif(NetworkKind::Test), tprv_wpkh(1));
        let err = parse_import(&input, WalletNetwork::Regtest).unwrap_err();
        assert_eq!(err.code, "pair_mismatch");
    }

    #[test]
    fn validation_dto_carries_the_single_address_flag() {
        let input = format!("wpkh({})", wif(NetworkKind::Test));
        let v = ImportValidation::from_result(&parse_import(&input, WalletNetwork::Regtest));
        assert!(v.valid);
        assert!(v.single_address);
        assert_eq!(v.kind, Some(DescriptorKindCfg::Bip84));
        assert!(!v.inferred_internal);

        // Ranged imports keep reporting false.
        let v = ImportValidation::from_result(&parse_import(&tprv_wpkh(0), WalletNetwork::Regtest));
        assert!(v.valid);
        assert!(!v.single_address);
    }

    #[test]
    fn validation_dto_mirrors_the_result() {
        let ok =
            ImportValidation::from_result(&parse_import(&tprv_wpkh(0), WalletNetwork::Regtest));
        assert!(ok.valid);
        assert_eq!(ok.kind, Some(DescriptorKindCfg::Bip84));
        assert!(ok.inferred_internal);

        let err = ImportValidation::from_result(&parse_import("tpub", WalletNetwork::Regtest));
        assert!(!err.valid);
        assert_eq!(err.code, Some("parse"));
    }
}
