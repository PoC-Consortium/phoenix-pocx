//! 25th-word (BIP39 passphrase) derivation round-trip — the REAL mobile /
//! nodeless path.
//!
//! Purpose: settle empirically whether the desktop (TypeScript,
//! `@scure/bip39` via `descriptor.service.ts`) and mobile/nodeless (Rust,
//! `keys_btcx::WalletSeed` → bdk/BIP-84) derivations produce the SAME first
//! receive address for the same (mnemonic, BIP39 passphrase). The matching
//! TypeScript test lives at
//! `web-wallet/src/app/bitcoin/services/wallet/derivation-roundtrip.spec.ts`.
//!
//! This test reuses the ACTUAL production derivation helpers so it reflects
//! real behavior — it does not hand-roll BIP-84:
//!   - seed:    `keys_btcx::WalletSeed::from_mnemonic` (the exact call
//!              `create_wallet_impl` makes, keys-btcx lib.rs:55)
//!   - spk #0:  `manager::candidate_spks` — the real restore-probe
//!              derivation (`probe_all_branches`, manager.rs:362/230)
//!   - address: `psbt::spk_to_address` — the real receive-page encoder
//!              (`current_address_of`, commands.rs:1733 / psbt.rs:38)
//!   - cross-check: a real bdk `Wallet` built from
//!              `WalletSeed::wallet_descriptors` (the exact descriptors
//!              `open_wallet` creates, keys-btcx lib.rs:108) peeked at
//!              external index 0.
//!
//! Do NOT edit production logic to satisfy this test — it is measurement.

use bdk_wallet::{KeychainKind, Wallet};
use keys_btcx::{DescriptorKind, WalletSeed, COIN_BTCX};

use super::config::{DescriptorKindCfg, DescriptorPolicy, WalletNetwork};
use super::manager::candidate_spks;
use super::psbt::spk_to_address;

/// The SAME 24-word all-zero-entropy BIP39 vector used by the mobile unit
/// tests (`commands.rs` `MNEMONIC_24`) and by the TypeScript spec.
const MNEMONIC_24: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
     abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
     abandon abandon abandon abandon art";

/// P0 = no 25th word, P1 = pure ASCII, P2 = contains non-ASCII `ü`.
const PASSPHRASES: [(&str, &str); 3] = [
    ("P0 (empty)", ""),
    ("P1 (ascii)", "correcthorse123"),
    ("P2 (umlaut)", "prüfung"),
];

/// Desktop (TypeScript `@scure/bip39`) first receive addresses for
/// MNEMONIC_24, mainnet PoCX BIP-84 external index 0 — the exact values the
/// sibling TS spec (`derivation-roundtrip.spec.ts`) derives for P0/P1/P2.
/// `@scure/bip39`'s `mnemonicToSeedSync` NFKD-normalizes the passphrase
/// internally, so DESKTOP_P2 is the address of the DECOMPOSED `prüfung`.
const DESKTOP_P0: &str = "pocx1qcpueamxr0aa82t7dtvhzdksq59c993f9heu9te";
const DESKTOP_P1: &str = "pocx1qc7axsl082uqm0t3fuqefy7rw2ug52pl338esjk";
const DESKTOP_P2: &str = "pocx1qqc2ka02m9jq43vmufl29xx4sutef0a03zenrq7";

/// NFKD-normalize a string — the same transform the app boundary now applies
/// to the BIP39 25th-word passphrase (`btcx-wallet.service.ts`,
/// `bip39Passphrase.normalize('NFKD')`) before handing it to keys-btcx's
/// `to_seed_normalized` (which hashes its input RAW).
fn nfkd(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.nfkd().collect()
}

/// Parse a hex string into bytes (avoids pulling a hex crate into scope).
fn hex_to_bytes(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// First EXTERNAL (receive) address at index 0, BIP-84, mainnet PoCX
/// (coin type 0x504F4358, HRP `pocx`) — via the real probe derivation +
/// the real receive-address encoder.
fn first_receive_addr_via_candidate_spks(mnemonic: &str, passphrase: &str) -> String {
    let seed = WalletSeed::from_mnemonic(mnemonic, passphrase).unwrap();
    let policy = DescriptorPolicy {
        kind: DescriptorKindCfg::Bip84,
        coin_type: COIN_BTCX,
    };
    // change = 0 (external / receive), count = 1 → index 0 only.
    let spks = candidate_spks(&seed, policy, 0, 1).unwrap();
    spk_to_address(WalletNetwork::Mainnet, &spks[0]).unwrap()
}

/// Same address, but through a real bdk `Wallet` built from the production
/// descriptor pair and peeked at external index 0 — proves candidate_spks
/// agrees with what bdk derives from `wallet_descriptors`.
fn first_receive_addr_via_bdk_peek(mnemonic: &str, passphrase: &str) -> String {
    let seed = WalletSeed::from_mnemonic(mnemonic, passphrase).unwrap();
    let (external, internal) = seed
        .wallet_descriptors(DescriptorKind::Bip84, COIN_BTCX)
        .unwrap();
    let wallet = Wallet::create(external, internal)
        .network(bitcoin::Network::Bitcoin)
        .create_wallet_no_persist()
        .unwrap();
    let info = wallet.peek_address(KeychainKind::External, 0);
    spk_to_address(WalletNetwork::Mainnet, &info.address.script_pubkey()).unwrap()
}

/// V0 — validates the Rust BIP39 seed path against the canonical BIP39 test
/// vector (mnemonic `abandon…about`, passphrase `TREZOR`). `WalletSeed`
/// does not expose raw seed bytes, so we prove equivalence at the master
/// xprv: `from_mnemonic(…, "TREZOR")` must equal `from_seed(<canonical>)`.
#[test]
fn v0_seed_matches_canonical_bip39_vector() {
    const V0_MNEMONIC: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const CANONICAL_SEED_HEX: &str = "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04";

    let from_mnemonic = WalletSeed::from_mnemonic(V0_MNEMONIC, "TREZOR").unwrap();
    let from_seed = WalletSeed::from_seed(&hex_to_bytes(CANONICAL_SEED_HEX)).unwrap();

    let via_mnemonic = from_mnemonic.master_xpriv().to_string();
    let via_canonical = from_seed.master_xpriv().to_string();
    eprintln!("V0 master xprv via from_mnemonic(TREZOR): {via_mnemonic}");
    eprintln!("V0 master xprv via canonical seed bytes:  {via_canonical}");
    assert_eq!(
        via_mnemonic, via_canonical,
        "keys_btcx BIP39 seed derivation for an ASCII passphrase must match the canonical vector"
    );
    eprintln!("V0 SEED ASSERTION: PASS");
}

#[test]
fn print_first_receive_addresses_for_p0_p1_p2() {
    eprintln!("=== MOBILE (Rust keys_btcx → bdk/BIP-84) first receive addr, mainnet PoCX ===");
    eprintln!("mnemonic (24w): {MNEMONIC_24}");
    for (label, pass) in PASSPHRASES {
        let via_spks = first_receive_addr_via_candidate_spks(MNEMONIC_24, pass);
        let via_peek = first_receive_addr_via_bdk_peek(MNEMONIC_24, pass);
        assert_eq!(
            via_spks, via_peek,
            "candidate_spks and bdk peek must agree for {label}"
        );
        eprintln!("MOBILE {label} passphrase={pass:?} -> {via_spks}");
    }
}

/// The RAW-passphrase state of play (measurement, not a fix):
/// - P0 (empty) and P1 (pure ASCII) already MATCH desktop — no normalization
///   changes ASCII bytes, so the nodeless path agreed all along.
/// - P2 (`prüfung`, non-ASCII) DIFFERS from desktop, because keys-btcx's
///   `to_seed_normalized` hashes the passphrase RAW (precomposed `ü`, U+00FC)
///   while desktop's `@scure/bip39` NFKD-normalizes it (decomposed `u`+`◌̈`).
///   This assertion DOCUMENTS the underlying library divergence the app
///   boundary fix (NFKD before invoke) exists to close.
#[test]
fn raw_passphrase_p0_p1_match_desktop_but_p2_diverges() {
    let p0 = first_receive_addr_via_candidate_spks(MNEMONIC_24, "");
    let p1 = first_receive_addr_via_candidate_spks(MNEMONIC_24, "correcthorse123");
    let p2_raw = first_receive_addr_via_candidate_spks(MNEMONIC_24, "prüfung");

    eprintln!("MOBILE(raw) P0 -> {p0}   DESKTOP P0 -> {DESKTOP_P0}");
    eprintln!("MOBILE(raw) P1 -> {p1}   DESKTOP P1 -> {DESKTOP_P1}");
    eprintln!("MOBILE(raw) P2 -> {p2_raw}   DESKTOP P2 -> {DESKTOP_P2}");

    assert_eq!(p0, DESKTOP_P0, "P0 (no 25th word) must already match desktop");
    assert_eq!(p1, DESKTOP_P1, "P1 (ASCII passphrase) must already match desktop");
    assert_ne!(
        p2_raw, DESKTOP_P2,
        "P2 raw non-ASCII passphrase is EXPECTED to diverge from desktop \
         (keys-btcx hashes it un-normalized) — this is the bug the fix closes"
    );
}

/// Proves the app-boundary fix: NFKD-normalizing the P2 passphrase BEFORE
/// `WalletSeed::from_mnemonic` (exactly what `btcx-wallet.service.ts` now does
/// with `bip39Passphrase.normalize('NFKD')`) makes the nodeless first receive
/// address EQUAL desktop's. Both the real probe encoder and a real bdk peek
/// are checked, so the equality holds through the whole nodeless derivation.
///
/// This also confirms the boundary math holds: the app computes the seed salt
/// as `"mnemonic" + NFKD(passphrase)` (keys-btcx raw over an NFKD input),
/// which equals desktop's `"mnemonic" + NFKD(passphrase)` — normalizing the
/// passphrase alone is sufficient (the mnemonic is already parse-normalized).
#[test]
fn p2_matches_desktop_after_nfkd_normalization() {
    let normalized = nfkd("prüfung");
    // The normalization must actually change the bytes (precomposed → NFKD),
    // otherwise this test would prove nothing.
    assert_ne!(normalized, "prüfung", "NFKD must decompose the precomposed ü");

    let via_spks = first_receive_addr_via_candidate_spks(MNEMONIC_24, &normalized);
    let via_peek = first_receive_addr_via_bdk_peek(MNEMONIC_24, &normalized);

    eprintln!("MOBILE(NFKD) P2 -> {via_spks}   DESKTOP P2 -> {DESKTOP_P2}");

    assert_eq!(
        via_spks, via_peek,
        "candidate_spks and bdk peek must agree for the normalized P2 passphrase"
    );
    assert_eq!(
        via_spks, DESKTOP_P2,
        "NFKD-normalizing the 25th word makes the nodeless P2 address match desktop"
    );
}
