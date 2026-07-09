//! Regtest end-to-end smoke test for the nodeless BTCX wallet backend.
//!
//! Ignored by default — it needs a LOCAL regtest stack already running:
//! - bitcoind (Bitcoin PoCX) with RPC on 127.0.0.1:18443, cookie auth, and
//!   a loaded, funded miner wallet
//! - electrs with its Electrum endpoint on tcp://127.0.0.1:60401
//!
//! Run with:
//! ```text
//! BTCX_REGTEST_COOKIE=<path to .cookie> \
//!   cargo test --test btcx_wallet_regtest -- --ignored --nocapture
//! ```
//!
//! What it exercises (gate M3's send/receive on regtest):
//! 1. fresh seed via seedstore → wallet open (BIP-84 / BTCX coin type)
//! 2. new address carries the regtest BTCX HRP (`rpocx1q...`)
//! 3. background sync completes; fresh balance is 0
//! 4. the node's miner wallet funds the address, a block is mined
//!    (`setmocktime` + `generatetoaddress`), the worker picks it up
//! 5. the wallet sends part of it back (build/sign/broadcast over
//!    Electrum), the spend confirms, the balance drops by amount + fee

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use phoenix_pocx_lib::btcx_wallet::config::{DescriptorKindCfg, DescriptorPolicy};
use phoenix_pocx_lib::btcx_wallet::manager::{
    candidate_spks, open_wallet, probe_all_branches, select_restore_policy,
};
use phoenix_pocx_lib::btcx_wallet::state::broadcast_tx_over_electrum;

const ELECTRUM_URL: &str = "tcp://127.0.0.1:60401";
const RPC_ADDR: &str = "127.0.0.1:18443";

fn cookie_path() -> String {
    std::env::var("BTCX_REGTEST_COOKIE").unwrap_or_else(|_| {
        r"C:\code\pocx\electrum\electrs\testkit\regtest-data\regtest\.cookie".to_string()
    })
}

/// Tiny base64 encoder (RFC 4648) — enough for HTTP basic auth without
/// pulling a crate into the dev-dependencies.
fn base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Minimal JSON-RPC-over-HTTP call to the regtest node (cookie auth,
/// `Connection: close`) — std-only so the test adds no HTTP client dep.
fn rpc(wallet: Option<&str>, method: &str, params: serde_json::Value) -> serde_json::Value {
    let cookie = std::fs::read_to_string(cookie_path())
        .unwrap_or_else(|e| panic!("reading RPC cookie {}: {e}", cookie_path()));
    let auth = base64(cookie.trim().as_bytes());
    let path = match wallet {
        Some(name) => format!("/wallet/{name}"),
        None => "/".to_string(),
    };
    let body = serde_json::json!({
        "jsonrpc": "1.0",
        "id": "btcx-wallet-smoke",
        "method": method,
        "params": params,
    })
    .to_string();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {RPC_ADDR}\r\nAuthorization: Basic {auth}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let mut stream = TcpStream::connect(RPC_ADDR)
        .unwrap_or_else(|e| panic!("connecting to bitcoind RPC at {RPC_ADDR}: {e}"));
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    let response = String::from_utf8_lossy(&response);
    let json_body = response
        .split_once("\r\n\r\n")
        .map(|(_, b)| b)
        .unwrap_or(&response);
    let parsed: serde_json::Value = serde_json::from_str(json_body.trim())
        .unwrap_or_else(|e| panic!("{method}: bad RPC response ({e}): {json_body}"));
    assert!(
        parsed["error"].is_null(),
        "{method} failed: {}",
        parsed["error"]
    );
    parsed["result"].clone()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

#[test]
#[ignore = "needs a running regtest bitcoind (127.0.0.1:18443) + electrs (127.0.0.1:60401)"]
fn regtest_end_to_end() {
    let params = &params_btcx::params::BTCX_REGTEST;
    let dir = tempfile::tempdir().unwrap();

    // 1. Fresh seed (never-plaintext at rest) → wallet seed → bdk wallet.
    let mut store = seedstore::SeedStore::open(dir.path(), None).unwrap();
    let mnemonic = store.create_seed(None, 12).unwrap();
    assert_eq!(mnemonic.split_whitespace().count(), 12);
    let seed = keys_btcx::WalletSeed::from_mnemonic(&mnemonic, "").unwrap();

    let db = dir
        .path()
        .join("regtest")
        .join("wallet")
        .join("btcx.sqlite");
    let handle = open_wallet(&db, params, &seed, DescriptorPolicy::default()).unwrap();

    // Pooled-style chain connection for the backend, a private one for the
    // worker — the same split the app runtime uses.
    let chain = Arc::new(electrum_btcx::ElectrumBackend::new(params, ELECTRUM_URL).unwrap());
    let worker_chain = Arc::new(electrum_btcx::ElectrumBackend::new(params, ELECTRUM_URL).unwrap());
    let worker = electrum_btcx::SyncWorker::spawn("btcx", worker_chain, &handle);
    let backend = wallet_btcx::BdkWalletBackend::new(
        params,
        chain,
        Vec::new(),
        Some((handle.clone(), worker.clone())),
    );

    // 2. Fresh receive address: regtest BTCX P2WPKH bech32.
    let address = backend.wallet_new_address().unwrap();
    assert!(
        address.starts_with("rpocx1q"),
        "expected an rpocx1q... address, got {address}"
    );

    // 3. First sync completes against the live electrs; nothing owned yet.
    assert!(
        worker.wait_first_sync(Duration::from_secs(30)),
        "first sync did not complete — is electrs up on {ELECTRUM_URL}?"
    );
    assert_eq!(backend.wallet_balance().unwrap(), 0);

    // 4. Fund the fresh address from the node's miner wallet and mine a
    //    block. PoCX regtest blocks need the clock nudged past the
    //    deadline, hence setmocktime before generatetoaddress.
    let wallets = rpc(None, "listwallets", serde_json::json!([]));
    let wallet_name = wallets[0]
        .as_str()
        .expect("a loaded miner wallet on the regtest node")
        .to_string();
    let miner_addr = rpc(Some(&wallet_name), "getnewaddress", serde_json::json!([]))
        .as_str()
        .unwrap()
        .to_string();
    let mediantime = rpc(None, "getblockchaininfo", serde_json::json!([]))["mediantime"]
        .as_u64()
        .unwrap();
    let fund_txid = rpc(
        Some(&wallet_name),
        "sendtoaddress",
        serde_json::json!([address, 0.5]),
    );
    println!("funded {address} with 0.5 BTCX: {fund_txid}");
    rpc(
        None,
        "setmocktime",
        serde_json::json!([now_secs().max(mediantime) + 3600]),
    );
    rpc(
        None,
        "generatetoaddress",
        serde_json::json!([1, miner_addr]),
    );

    // The worker's next pass folds the confirmed funding in.
    let mut funded = 0u64;
    for _ in 0..30 {
        worker.poke();
        std::thread::sleep(Duration::from_secs(1));
        funded = backend.wallet_balance().unwrap();
        if funded > 0 {
            break;
        }
    }
    assert_eq!(
        funded, 50_000_000,
        "expected the confirmed 0.5 BTCX funding, balance is {funded} sat"
    );

    // 5. Send 0.1 BTCX back: coin-select, sign, broadcast over Electrum.
    let spend_txid = backend
        .wallet_send(
            &miner_addr,
            10_000_000,
            electrum_btcx::SendFee::RatePerKvb(2000),
        )
        .unwrap();
    assert_eq!(spend_txid.len(), 64, "txid: {spend_txid}");
    println!("sent 0.1 BTCX back to the miner: {spend_txid}");

    // Confirm the spend and watch the balance drop by amount + fee.
    rpc(
        None,
        "generatetoaddress",
        serde_json::json!([1, miner_addr]),
    );
    let mut after = funded;
    for _ in 0..30 {
        worker.poke();
        std::thread::sleep(Duration::from_secs(1));
        after = backend.wallet_balance().unwrap();
        if after != funded && after < funded - 10_000_000 {
            break;
        }
    }
    assert!(
        after < funded - 10_000_000 && after > funded - 10_000_000 - 100_000,
        "balance after the spend should be funded - 0.1 BTCX - a small fee, got {after}"
    );

    // The activity feed shows both movements, newest first.
    let activity = backend.wallet_transactions().unwrap();
    assert_eq!(activity.len(), 2);
    assert_eq!(activity[0].direction, "sent");
    assert_eq!(activity[0].amount_sat, 10_000_000);
    assert_eq!(activity[1].direction, "received");
    assert_eq!(activity[1].amount_sat, 50_000_000);

    // Leave the node's clock alone for whoever runs next.
    rpc(None, "setmocktime", serde_json::json!([0]));
    worker.shutdown();
    println!("regtest end-to-end smoke: OK (funded {funded}, after spend {after})");
}

/// Hardened restore probe, live: a fresh seed first gets an HONEST empty
/// verdict from the real electrs; then ONE branch (BIP-86 / BTCX coin
/// type) is funded through the node's miner wallet, and the probe must
/// come back with exactly that branch — selected for the restore and
/// reported in the hit list with the funded index.
#[test]
#[ignore = "needs a running regtest bitcoind (127.0.0.1:18443) + electrs (127.0.0.1:60401)"]
fn regtest_restore_probe_selects_funded_branch() {
    let params = &params_btcx::params::BTCX_REGTEST;
    let dir = tempfile::tempdir().unwrap();

    let mut store = seedstore::SeedStore::open(dir.path(), None).unwrap();
    let mnemonic = store.create_seed(None, 12).unwrap();
    let seed = keys_btcx::WalletSeed::from_mnemonic(&mnemonic, "").unwrap();

    let chain = electrum_btcx::ElectrumBackend::new(params, ELECTRUM_URL).unwrap();

    // 1. Brand-new seed: no branch has history — the probe must say so
    //    honestly and the selection must fall back to the fresh default.
    let hits = probe_all_branches(&seed, &chain).expect("probe against live electrs");
    assert!(
        hits.is_empty(),
        "a fresh seed cannot have history: {hits:?}"
    );
    let (selected, fresh) = select_restore_policy(&hits);
    assert!(fresh);
    assert_eq!(selected, DescriptorPolicy::default());

    // 2. Fund external index 0 of the BIP-86 / BTCX branch via the miner
    //    wallet (bech32m address with the regtest BTCX HRP).
    let funded_policy = DescriptorPolicy {
        kind: DescriptorKindCfg::Bip86,
        coin_type: keys_btcx::COIN_BTCX,
    };
    let spk = candidate_spks(&seed, funded_policy, 0, 1).unwrap()[0].clone();
    let output_key =
        bitcoin::XOnlyPublicKey::from_slice(&spk.as_bytes()[2..]).expect("p2tr program");
    let address = params.p2tr_address(&output_key).unwrap();
    assert!(
        address.starts_with("rpocx1p"),
        "expected a taproot rpocx1p... address, got {address}"
    );
    assert_eq!(
        params.parse_address(&address).unwrap(),
        spk,
        "address round-trips to the derived scriptPubKey"
    );

    let wallets = rpc(None, "listwallets", serde_json::json!([]));
    let wallet_name = wallets[0]
        .as_str()
        .expect("a loaded miner wallet on the regtest node")
        .to_string();
    let miner_addr = rpc(Some(&wallet_name), "getnewaddress", serde_json::json!([]))
        .as_str()
        .unwrap()
        .to_string();
    let mediantime = rpc(None, "getblockchaininfo", serde_json::json!([]))["mediantime"]
        .as_u64()
        .unwrap();
    let fund_txid = rpc(
        Some(&wallet_name),
        "sendtoaddress",
        serde_json::json!([address, 0.25]),
    );
    println!("funded BIP-86/BTCX {address} with 0.25 BTCX: {fund_txid}");
    rpc(
        None,
        "setmocktime",
        serde_json::json!([now_secs().max(mediantime) + 3600]),
    );
    rpc(
        None,
        "generatetoaddress",
        serde_json::json!([1, miner_addr]),
    );

    // Wait for electrs to index the confirmed funding.
    let mut indexed = false;
    for _ in 0..30 {
        std::thread::sleep(Duration::from_secs(1));
        let histories = chain.histories(std::slice::from_ref(&spk)).unwrap();
        if !histories[0].is_empty() {
            indexed = true;
            break;
        }
    }
    assert!(indexed, "electrs did not index the funding tx in time");

    // 3. The probe now finds EXACTLY the funded branch, selects it, and
    //    reports the funded index in the hit list.
    let hits = probe_all_branches(&seed, &chain).expect("probe against live electrs");
    assert_eq!(
        hits.len(),
        1,
        "only the funded branch has history: {hits:?}"
    );
    assert_eq!(hits[0].policy, funded_policy);
    assert_eq!(hits[0].deepest_external, Some(0));
    assert_eq!(hits[0].deepest_internal, None);
    let (selected, fresh) = select_restore_policy(&hits);
    assert!(!fresh);
    assert_eq!(selected, funded_policy);

    // Leave the node's clock alone for whoever runs next.
    rpc(None, "setmocktime", serde_json::json!([0]));
    println!(
        "restore-probe smoke: OK (selected {:?} 0x{:x}, hits {})",
        selected.kind,
        selected.coin_type,
        hits.len()
    );
}

/// Chain-only Electrum broadcast (Phase 6a): a raw transaction built and
/// signed by the NODE's wallet — never broadcast by it — goes out through
/// `broadcast_tx_over_electrum`, the seedless path behind the
/// `btcx_broadcast_tx` Tauri command, and must land in the node's mempool.
#[test]
#[ignore = "needs a running regtest bitcoind (127.0.0.1:18443) + electrs (127.0.0.1:60401)"]
fn regtest_chain_only_broadcast() {
    let params = &params_btcx::params::BTCX_REGTEST;

    // Build a signed-but-unbroadcast spend with the node's miner wallet:
    // walletcreatefundedpsbt + walletprocesspsbt + finalizepsbt yields the
    // raw hex without the node ever relaying it.
    let wallets = rpc(None, "listwallets", serde_json::json!([]));
    let wallet_name = wallets[0]
        .as_str()
        .expect("a loaded miner wallet on the regtest node")
        .to_string();
    let dest = rpc(Some(&wallet_name), "getnewaddress", serde_json::json!([]))
        .as_str()
        .unwrap()
        .to_string();
    let mut output = serde_json::Map::new();
    output.insert(dest.clone(), serde_json::json!(0.05));
    let funded = rpc(
        Some(&wallet_name),
        "walletcreatefundedpsbt",
        serde_json::json!([[], [output]]),
    );
    let processed = rpc(
        Some(&wallet_name),
        "walletprocesspsbt",
        serde_json::json!([funded["psbt"]]),
    );
    assert_eq!(processed["complete"], true, "psbt should be fully signed");
    let finalized = rpc(
        Some(&wallet_name),
        "finalizepsbt",
        serde_json::json!([processed["psbt"]]),
    );
    let tx_hex = finalized["hex"]
        .as_str()
        .expect("finalizepsbt returns raw hex")
        .to_string();
    let expected_txid = rpc(None, "decoderawtransaction", serde_json::json!([tx_hex]))["txid"]
        .as_str()
        .unwrap()
        .to_string();

    // Error taxonomy first, on the same tx: no server configured, then no
    // server reachable (port 1 refuses fast).
    let err = broadcast_tx_over_electrum(params, &[], &tx_hex).unwrap_err();
    assert!(
        err.contains("No Electrum server configured"),
        "empty server list: {err}"
    );
    let err = broadcast_tx_over_electrum(params, &["tcp://127.0.0.1:1".to_string()], &tx_hex)
        .unwrap_err();
    assert!(
        err.contains("No Electrum server reachable"),
        "unreachable server: {err}"
    );

    // The real broadcast: through electrs, chain-only (no seed, no wallet).
    let txid = broadcast_tx_over_electrum(params, &[ELECTRUM_URL.to_string()], &tx_hex)
        .expect("chain-only Electrum broadcast");
    assert_eq!(txid, expected_txid);

    // The transaction must be in the NODE's mempool now (rpc() panics on a
    // getmempoolentry error, i.e. if the tx never arrived).
    let entry = rpc(None, "getmempoolentry", serde_json::json!([txid]));
    assert!(entry["vsize"].as_u64().unwrap_or(0) > 0);

    // Re-broadcasting the same tx is a no-op success, not an error.
    let again = broadcast_tx_over_electrum(params, &[ELECTRUM_URL.to_string()], &tx_hex)
        .expect("already-in-mempool broadcast is a no-op success");
    assert_eq!(again, expected_txid);

    // Confirm it so repeated runs start from a clean mempool, then leave
    // the node's clock alone for whoever runs next.
    let mediantime = rpc(None, "getblockchaininfo", serde_json::json!([]))["mediantime"]
        .as_u64()
        .unwrap();
    rpc(
        None,
        "setmocktime",
        serde_json::json!([now_secs().max(mediantime) + 3600]),
    );
    rpc(None, "generatetoaddress", serde_json::json!([1, dest]));
    rpc(None, "setmocktime", serde_json::json!([0]));
    println!("chain-only Electrum broadcast smoke: OK ({txid})");
}
