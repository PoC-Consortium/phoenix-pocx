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

use phoenix_pocx_lib::btcx_wallet::config::DescriptorPolicy;
use phoenix_pocx_lib::btcx_wallet::manager::open_wallet;

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
