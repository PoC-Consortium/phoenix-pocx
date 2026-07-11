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

use phoenix_pocx_lib::btcx_wallet::commands::{
    create_wallet_impl, current_address_of, import_descriptor_wallet_impl, rename_wallet_impl,
    restore_wallet_impl, select_wallet_impl, tx_display_address,
};
use phoenix_pocx_lib::btcx_wallet::config::{DescriptorKindCfg, DescriptorPolicy, WalletNetwork};
use phoenix_pocx_lib::btcx_wallet::manager::{
    candidate_spks, open_wallet, probe_all_branches, select_restore_policy,
};
use phoenix_pocx_lib::btcx_wallet::state::broadcast_tx_over_electrum;
use phoenix_pocx_lib::btcx_wallet::SharedBtcxWalletState;

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

/// Nudge the node's clock past the PoC deadline and mine one block to
/// `miner_addr`. The mock time must beat EVERY consensus clock: the
/// median-time-past rule AND PoCX's monotonic tip-timestamp rule — each
/// mined block escalates the tip timestamp by ~1h, so after a few blocks
/// `now + 3600` alone falls behind the tip (`time-too-old`). The tip's
/// `time` from getblockchaininfo covers that.
fn mine_block(miner_addr: &str) {
    let info = rpc(None, "getblockchaininfo", serde_json::json!([]));
    let mediantime = info["mediantime"].as_u64().unwrap();
    let tip_time = info["time"].as_u64().unwrap_or(mediantime);
    rpc(
        None,
        "setmocktime",
        serde_json::json!([now_secs().max(mediantime).max(tip_time) + 3600]),
    );
    rpc(
        None,
        "generatetoaddress",
        serde_json::json!([1, miner_addr]),
    );
}

#[test]
#[ignore = "needs a running regtest bitcoind (127.0.0.1:18443) + electrs (127.0.0.1:60401)"]
fn regtest_end_to_end() {
    let params = &params_btcx::params::BTCX_REGTEST;
    let dir = tempfile::tempdir().unwrap();

    // 1. Fresh seed (never-plaintext at rest) → wallet seed → bdk wallet.
    //    24 words — the app's create default (`btcx_wallet_generate_mnemonic`);
    //    the restore-probe test below keeps exercising 12-word seeds.
    let mut store = seedstore::SeedStore::open(dir.path(), None).unwrap();
    let mnemonic = store.create_seed(None, 24).unwrap();
    assert_eq!(mnemonic.split_whitespace().count(), 24);
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
    let fund_txid = rpc(
        Some(&wallet_name),
        "sendtoaddress",
        serde_json::json!([address, 0.5]),
    );
    println!("funded {address} with 0.5 BTCX: {fund_txid}");
    mine_block(&miner_addr);

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
    mine_block(&miner_addr);
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

    // 6. Display addresses (the btcx_wallet_transactions enrichment): the
    //    send shows the counterparty, the receive our funded address.
    {
        let entry = handle.lock().unwrap();
        assert_eq!(
            tx_display_address(&entry, WalletNetwork::Regtest, &activity[0]).as_deref(),
            Some(miner_addr.as_str()),
            "sent entry shows the counterparty output address"
        );
        assert_eq!(
            tx_display_address(&entry, WalletNetwork::Regtest, &activity[1]).as_deref(),
            Some(address.as_str()),
            "received entry shows our receiving address"
        );
    }

    // 7. Send-all (the mobile MAX path): sweep the rest back to the miner
    //    and the balance must hit zero; the sweep has no change output and
    //    still resolves the counterparty as its display address.
    let sweep_txid = backend
        .wallet_send_all(&miner_addr, electrum_btcx::SendFee::RatePerKvb(2000))
        .unwrap();
    assert_eq!(sweep_txid.len(), 64, "sweep txid: {sweep_txid}");
    mine_block(&miner_addr);
    let mut swept = after;
    for _ in 0..30 {
        worker.poke();
        std::thread::sleep(Duration::from_secs(1));
        swept = backend.wallet_balance().unwrap();
        if swept == 0 {
            break;
        }
    }
    assert_eq!(swept, 0, "send-all must sweep the whole balance");
    let activity = backend.wallet_transactions().unwrap();
    assert_eq!(activity.len(), 3);
    assert_eq!(activity[0].direction, "sent");
    {
        let entry = handle.lock().unwrap();
        assert_eq!(
            tx_display_address(&entry, WalletNetwork::Regtest, &activity[0]).as_deref(),
            Some(miner_addr.as_str()),
            "sweep entry shows the counterparty output address"
        );
    }

    // Leave the node's clock alone for whoever runs next.
    rpc(None, "setmocktime", serde_json::json!([0]));
    worker.shutdown();
    println!("regtest end-to-end smoke: OK (funded {funded}, after spend {after}, swept to 0)");
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

    // 12 words on purpose: restore must keep accepting 12-word seeds even
    // though create now defaults to 24.
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
    let fund_txid = rpc(
        Some(&wallet_name),
        "sendtoaddress",
        serde_json::json!([address, 0.25]),
    );
    println!("funded BIP-86/BTCX {address} with 0.25 BTCX: {fund_txid}");
    mine_block(&miner_addr);

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

/// Fund `address` from the node's miner wallet and confirm it with one
/// mined block (PoCX regtest needs the clock nudged past the deadline).
fn fund_and_mine(address: &str, amount_btcx: f64) {
    let wallets = rpc(None, "listwallets", serde_json::json!([]));
    let wallet_name = wallets[0]
        .as_str()
        .expect("a loaded miner wallet on the regtest node")
        .to_string();
    let miner_addr = rpc(Some(&wallet_name), "getnewaddress", serde_json::json!([]))
        .as_str()
        .unwrap()
        .to_string();
    let txid = rpc(
        Some(&wallet_name),
        "sendtoaddress",
        serde_json::json!([address, amount_btcx]),
    );
    println!("funded {address} with {amount_btcx} BTCX: {txid}");
    mine_block(&miner_addr);
}

/// Poke the open wallet's sync worker until its total balance reaches
/// `expected_sat` (or the attempts run out — then assert loudly).
fn wait_for_balance(state: &SharedBtcxWalletState, expected_sat: u64, what: &str) {
    let mut balance = u64::MAX;
    for _ in 0..30 {
        state.poke().unwrap();
        std::thread::sleep(Duration::from_secs(1));
        balance = state
            .backend()
            .unwrap()
            .wallet_balance()
            .unwrap_or_default();
        if balance == expected_sat {
            return;
        }
    }
    panic!("{what}: expected {expected_sat} sat, still {balance} sat");
}

/// The mobile multi-wallet feature, live: two NAMED wallets over the SAME
/// mnemonic — "alpha" on BIP-84 (`rpocx1q...`) and "beta" on BIP-86
/// (`rpocx1p...`) — switching between them with independent balances, and
/// the dual-restore flow: after funding both branches, one plain restore
/// (opens the BIP-84 winner and reports BOTH hits) plus one kind-forced
/// restore (opens the BIP-86 branch), exactly what the mobile "create both
/// wallets" flow drives through `btcx_wallet_restore`.
#[test]
#[ignore = "needs a running regtest bitcoind (127.0.0.1:18443) + electrs (127.0.0.1:60401)"]
fn regtest_named_dual_kind_wallets() {
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("PHOENIX_DATA_DIR", dir.path());
    // Never touch the developer's real OS keychain from a test.
    std::env::set_var("PACT_DISABLE_KEYRING", "1");

    let state = phoenix_pocx_lib::btcx_wallet::create_btcx_wallet_state();
    state
        .update_config(|c| {
            c.network = WalletNetwork::Regtest;
            c.set_servers(WalletNetwork::Regtest, vec![ELECTRUM_URL.to_string()]);
        })
        .unwrap();

    // A FRESH mnemonic every run — the shared regtest chain must not leak
    // history from earlier runs into the probe.
    let seed_dir = tempfile::tempdir().unwrap();
    let mut scratch = seedstore::SeedStore::open(seed_dir.path(), None).unwrap();
    let mnemonic = scratch.create_seed(None, 24).unwrap();

    // 1. Wallet A: named create, default kind → BIP-84, rpocx1q addresses.
    let status = create_wallet_impl(&state, None, &mnemonic, None, Some("alpha".into()), None)
        .expect("create alpha");
    assert_eq!(status.wallet_name, "alpha");
    assert!(status.wallet_active);
    let alpha_addr = state.backend().unwrap().wallet_new_address().unwrap();
    assert!(
        alpha_addr.starts_with("rpocx1q"),
        "BIP-84 wallet must hand out rpocx1q... addresses, got {alpha_addr}"
    );

    // 2. Wallet B: SAME mnemonic, named create with kind=bip86 → taproot,
    //    rpocx1p addresses. Two wallets over one seed is legal — each has
    //    its own data dir and descriptor branch.
    let status = create_wallet_impl(
        &state,
        None,
        &mnemonic,
        None,
        Some("beta".into()),
        Some(DescriptorKindCfg::Bip86),
    )
    .expect("create beta");
    assert_eq!(status.wallet_name, "beta");
    let beta_addr = state.backend().unwrap().wallet_new_address().unwrap();
    assert!(
        beta_addr.starts_with("rpocx1p"),
        "BIP-86 wallet must hand out rpocx1p... addresses, got {beta_addr}"
    );

    // 3. Fund each branch with a DIFFERENT amount and watch the balances
    //    stay independent across switches (one open wallet at a time).
    let status = select_wallet_impl(&state, None, "alpha").expect("switch to alpha");
    assert_eq!(status.wallet_name, "alpha");
    fund_and_mine(&alpha_addr, 0.3);
    wait_for_balance(&state, 30_000_000, "alpha after funding");

    let status = select_wallet_impl(&state, None, "beta").expect("switch to beta");
    assert_eq!(status.wallet_name, "beta");
    fund_and_mine(&beta_addr, 0.2);
    wait_for_balance(&state, 20_000_000, "beta after funding");

    // Switching back re-opens alpha's own store with alpha's own balance.
    select_wallet_impl(&state, None, "alpha").expect("switch back to alpha");
    wait_for_balance(&state, 30_000_000, "alpha after switching back");

    // 4. Dual-restore flow, as the mobile UI drives it. First the plain
    //    restore: BOTH funded branches must be reported, the BIP-84 one
    //    opens (priority order), and its balance is alpha's.
    let result = restore_wallet_impl(&state, None, &mnemonic, None, Some("gamma".into()), None)
        .expect("plain restore");
    assert!(!result.fresh);
    assert_eq!(
        result.hits.len(),
        2,
        "both funded branches must be reported: {:?}",
        result.hits
    );
    assert_eq!(
        result.selected,
        DescriptorPolicy::default(),
        "priority order opens BIP-84 / BTCX"
    );
    assert_eq!(result.status.wallet_name, "gamma");
    wait_for_balance(&state, 30_000_000, "gamma (restored BIP-84 branch)");

    // Then the second, kind-forced restore — the "create both wallets"
    // button: same mnemonic, new name, kind=bip86 → the taproot branch.
    let result = restore_wallet_impl(
        &state,
        None,
        &mnemonic,
        None,
        Some("gamma-taproot".into()),
        Some(DescriptorKindCfg::Bip86),
    )
    .expect("kind-forced restore");
    assert!(!result.fresh);
    assert_eq!(result.selected.kind, DescriptorKindCfg::Bip86);
    assert_eq!(result.selected.coin_type, keys_btcx::COIN_BTCX);
    assert_eq!(result.status.wallet_name, "gamma-taproot");
    wait_for_balance(&state, 20_000_000, "gamma-taproot (restored BIP-86 branch)");
    let gamma_taproot_addr = state.backend().unwrap().wallet_new_address().unwrap();
    assert!(
        gamma_taproot_addr.starts_with("rpocx1p"),
        "restored BIP-86 wallet must hand out rpocx1p... addresses, got {gamma_taproot_addr}"
    );

    // 5. The registry lists all four named wallets on regtest.
    let config = state.get_config();
    let names = config.wallet_names(WalletNetwork::Regtest);
    for name in ["alpha", "beta", "gamma", "gamma-taproot"] {
        assert!(
            names.contains(&name.to_string()),
            "missing {name}: {names:?}"
        );
    }

    // Leave the node's clock alone for whoever runs next.
    rpc(None, "setmocktime", serde_json::json!([0]));
    state.close_runtime();
    std::env::remove_var("PHOENIX_DATA_DIR");
    std::env::remove_var("PACT_DISABLE_KEYRING");
    println!("named dual-kind wallets smoke: OK (alpha/beta/gamma/gamma-taproot)");
}

/// The receive page's current-address semantics (feedback round 4, a7),
/// live: `current_address_of` — the peek behind `btcx_wallet_current_address`
/// — is STABLE across calls (it reveals a fresh address only when nothing
/// unused is outstanding), while `wallet_new_address` (the explicit
/// "new address" button AND the mining wizard's address fetch, #115) keeps
/// revealing fresh addresses under the handout cap, unaffected. Once the
/// current address sees funds on-chain, the peek moves to the next unused.
#[test]
#[ignore = "needs a running regtest bitcoind (127.0.0.1:18443) + electrs (127.0.0.1:60401)"]
fn regtest_current_address_stable_until_used_or_new() {
    use phoenix_pocx_lib::btcx_wallet::config::WalletNetwork;

    let params = &params_btcx::params::BTCX_REGTEST;
    let dir = tempfile::tempdir().unwrap();

    // Fresh seed → open wallet, same skeleton as regtest_end_to_end.
    let mut store = seedstore::SeedStore::open(dir.path(), None).unwrap();
    let mnemonic = store.create_seed(None, 24).unwrap();
    let seed = keys_btcx::WalletSeed::from_mnemonic(&mnemonic, "").unwrap();
    let db = dir
        .path()
        .join("regtest")
        .join("wallet")
        .join("btcx.sqlite");
    let handle = open_wallet(&db, params, &seed, DescriptorPolicy::default()).unwrap();

    let chain = Arc::new(electrum_btcx::ElectrumBackend::new(params, ELECTRUM_URL).unwrap());
    let worker_chain = Arc::new(electrum_btcx::ElectrumBackend::new(params, ELECTRUM_URL).unwrap());
    let worker = electrum_btcx::SyncWorker::spawn("btcx", worker_chain, &handle);
    let backend = wallet_btcx::BdkWalletBackend::new(
        params,
        chain,
        Vec::new(),
        Some((handle.clone(), worker.clone())),
    );

    // 1. Entering the receive page twice hands out the SAME address —
    //    the first call reveals index 0 (nothing unused yet), the second
    //    peeks it again instead of burning a fresh one.
    let current = {
        let mut entry = handle.lock().unwrap();
        let first = current_address_of(&mut entry, WalletNetwork::Regtest).unwrap();
        let second = current_address_of(&mut entry, WalletNetwork::Regtest).unwrap();
        assert_eq!(
            first, second,
            "current address must be stable across receive-page visits"
        );
        first
    };
    assert!(
        current.starts_with("rpocx1q"),
        "expected an rpocx1q... address, got {current}"
    );

    // 2. The explicit "new address" button (and the mining wizard's fetch)
    //    still reveals a FRESH address under the cap — unaffected by the
    //    peek — while the current address stays put at the older unused one.
    let fresh = backend.wallet_new_address().unwrap();
    assert_ne!(
        fresh, current,
        "wallet_new_address must keep revealing fresh addresses"
    );
    {
        let mut entry = handle.lock().unwrap();
        let still = current_address_of(&mut entry, WalletNetwork::Regtest).unwrap();
        assert_eq!(
            still, current,
            "an explicit reveal must not move the current (lowest-unused) address"
        );
    }

    // 3. Fund the current address and confirm it: once it is USED, the
    //    peek advances to the next unused one (the explicitly revealed
    //    address from step 2).
    assert!(
        worker.wait_first_sync(Duration::from_secs(30)),
        "first sync did not complete — is electrs up on {ELECTRUM_URL}?"
    );
    fund_and_mine(&current, 0.2);
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
        funded, 20_000_000,
        "expected the confirmed 0.2 BTCX funding, balance is {funded} sat"
    );
    {
        let mut entry = handle.lock().unwrap();
        let advanced = current_address_of(&mut entry, WalletNetwork::Regtest).unwrap();
        assert_eq!(
            advanced, fresh,
            "after the current address is used, the peek moves to the next unused address"
        );
    }

    // Leave the node's clock alone for whoever runs next.
    rpc(None, "setmocktime", serde_json::json!([0]));
    worker.shutdown();
    println!("current-address semantics smoke: OK (current {current}, fresh {fresh})");
}

/// Descriptor import (feature: import a wallet from descriptor strings),
/// live: a fresh tprv-based `wpkh` EXTERNAL descriptor is imported as a NEW
/// named wallet through `import_descriptor_wallet_impl` — the seam behind
/// `btcx_wallet_import_descriptor` — with the internal descriptor INFERRED
/// (`/0/*` → `/1/*`). The wallet opens, syncs, gets funded, and spends part
/// of the funds back (build/sign/broadcast over Electrum). Then the SAME
/// account is imported a second time as an EXPLICIT external+internal pair
/// under another name: the fresh store's first gap scan must find the
/// existing on-chain history (received AND change outputs) without any
/// probe assist.
#[test]
#[ignore = "needs a running regtest bitcoind (127.0.0.1:18443) + electrs (127.0.0.1:60401)"]
fn regtest_import_descriptor_wallet() {
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("PHOENIX_DATA_DIR", dir.path());
    // Never touch the developer's real OS keychain from a test.
    std::env::set_var("PACT_DISABLE_KEYRING", "1");

    let state = phoenix_pocx_lib::btcx_wallet::create_btcx_wallet_state();
    state
        .update_config(|c| {
            c.network = WalletNetwork::Regtest;
            c.set_servers(WalletNetwork::Regtest, vec![ELECTRUM_URL.to_string()]);
        })
        .unwrap();

    // A FRESH key every run — the shared regtest chain must not leak
    // history from earlier runs.
    let secp = bitcoin::secp256k1::Secp256k1::new();
    let seed_bytes: [u8; 32] = {
        use rand::RngCore;
        let mut b = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut b);
        b
    };
    let master =
        bitcoin::bip32::Xpriv::new_master(bitcoin::NetworkKind::Test, &seed_bytes).unwrap();
    let path: Vec<bitcoin::bip32::ChildNumber> = [84u32, 1, 0]
        .iter()
        .map(|&i| bitcoin::bip32::ChildNumber::from_hardened_idx(i).unwrap())
        .collect();
    let account = master.derive_priv(&secp, &path).unwrap();
    let fp = master.fingerprint(&secp);
    let external = format!("wpkh([{fp}/84'/1'/0']{account}/0/*)");
    let internal = format!("wpkh([{fp}/84'/1'/0']{account}/1/*)");

    // 1. Import the external descriptor alone: the internal branch is
    //    inferred, the wallet registers as descriptor-source BIP-84 and
    //    opens.
    let result = import_descriptor_wallet_impl(&state, None, &external, None, Some("desc".into()))
        .expect("import external descriptor");
    assert_eq!(result.status.wallet_name, "desc");
    assert!(result.status.wallet_active);
    assert!(result.inferred_internal);
    assert_eq!(result.policy.kind, DescriptorKindCfg::Bip84);

    // 2. Fresh receive address carries the regtest BTCX segwit-v0 HRP.
    let address = state.backend().unwrap().wallet_new_address().unwrap();
    assert!(
        address.starts_with("rpocx1q"),
        "expected an rpocx1q... address, got {address}"
    );

    // 3. Fund it, watch the background sync pick the coin up.
    fund_and_mine(&address, 0.4);
    wait_for_balance(&state, 40_000_000, "imported wallet after funding");

    // 4. Spend 0.1 BTCX back to the miner: coin-select, sign (from the
    //    imported descriptors), broadcast over Electrum, confirm.
    let wallets = rpc(None, "listwallets", serde_json::json!([]));
    let wallet_name = wallets[0]
        .as_str()
        .expect("a loaded miner wallet on the regtest node")
        .to_string();
    let miner_addr = rpc(Some(&wallet_name), "getnewaddress", serde_json::json!([]))
        .as_str()
        .unwrap()
        .to_string();
    let spend_txid = state
        .backend()
        .unwrap()
        .wallet_send(
            &miner_addr,
            10_000_000,
            electrum_btcx::SendFee::RatePerKvb(2000),
        )
        .expect("send from the imported wallet");
    assert_eq!(spend_txid.len(), 64, "txid: {spend_txid}");
    println!("imported wallet sent 0.1 BTCX back to the miner: {spend_txid}");
    mine_block(&miner_addr);

    let mut after = 0u64;
    for _ in 0..30 {
        state.poke().unwrap();
        std::thread::sleep(Duration::from_secs(1));
        after = state
            .backend()
            .unwrap()
            .wallet_balance()
            .unwrap_or_default();
        if after != 40_000_000 && after < 30_000_000 {
            break;
        }
    }
    assert!(
        after < 30_000_000 && after > 30_000_000 - 100_000,
        "balance after the spend should be 0.4 - 0.1 BTCX - a small fee, got {after}"
    );

    // 5. Import the SAME account as an EXPLICIT pair (both descriptors,
    //    internal first — order must not matter) under a new name: the
    //    fresh store's first gap scan finds the existing history, received
    //    AND change outputs, with no probe assist.
    let pair_input = format!("{internal}\n{external}");
    let result =
        import_descriptor_wallet_impl(&state, None, &pair_input, None, Some("desc-pair".into()))
            .expect("import explicit descriptor pair");
    assert_eq!(result.status.wallet_name, "desc-pair");
    assert!(!result.inferred_internal);
    wait_for_balance(
        &state,
        after,
        "explicit-pair reimport sees the same history",
    );

    // 6. Both named wallets are registered; switching back re-opens the
    //    first one with its balance intact.
    let config = state.get_config();
    let names = config.wallet_names(WalletNetwork::Regtest);
    for name in ["desc", "desc-pair"] {
        assert!(
            names.contains(&name.to_string()),
            "missing {name}: {names:?}"
        );
    }
    let status = select_wallet_impl(&state, None, "desc").expect("switch back to desc");
    assert_eq!(status.wallet_name, "desc");
    wait_for_balance(&state, after, "desc after switching back");

    // Leave the node's clock alone for whoever runs next.
    rpc(None, "setmocktime", serde_json::json!([0]));
    state.close_runtime();
    std::env::remove_var("PHOENIX_DATA_DIR");
    std::env::remove_var("PACT_DISABLE_KEYRING");
    println!(
        "descriptor import smoke: OK (funded 40000000, after spend {after}, pair reimport matched)"
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
    mine_block(&dest);
    rpc(None, "setmocktime", serde_json::json!([0]));
    println!("chain-only Electrum broadcast smoke: OK ({txid})");
}

/// The wallet rename flow (feedback round 6), live: a funded named wallet
/// is closed, renamed (`rename_wallet_impl`, the seam behind
/// `btcx_wallet_rename` — registry move + data-dir rename), and reopens
/// under the new name with its balance intact. Also the guardrails: the
/// OPEN wallet is refused, a case-insensitive name collision is refused,
/// an invalid name is refused, and the active-wallet pointer follows a
/// selected-but-closed wallet across its rename.
#[test]
#[ignore = "needs a running regtest bitcoind (127.0.0.1:18443) + electrs (127.0.0.1:60401)"]
fn regtest_rename_wallet_preserves_funds() {
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("PHOENIX_DATA_DIR", dir.path());
    // Never touch the developer's real OS keychain from a test.
    std::env::set_var("PACT_DISABLE_KEYRING", "1");

    let state = phoenix_pocx_lib::btcx_wallet::create_btcx_wallet_state();
    state
        .update_config(|c| {
            c.network = WalletNetwork::Regtest;
            c.set_servers(WalletNetwork::Regtest, vec![ELECTRUM_URL.to_string()]);
        })
        .unwrap();

    // A FRESH mnemonic every run — the shared regtest chain must not leak
    // history from earlier runs.
    let seed_dir = tempfile::tempdir().unwrap();
    let mut scratch = seedstore::SeedStore::open(seed_dir.path(), None).unwrap();
    let mnemonic = scratch.create_seed(None, 24).unwrap();

    // 1. Create + fund "payroll" (BIP-84).
    let status = create_wallet_impl(&state, None, &mnemonic, None, Some("payroll".into()), None)
        .expect("create payroll");
    assert_eq!(status.wallet_name, "payroll");
    let addr = state.backend().unwrap().wallet_new_address().unwrap();
    fund_and_mine(&addr, 0.25);
    wait_for_balance(&state, 25_000_000, "payroll after funding");

    // 2. Renaming the OPEN wallet is refused (switch-first, like delete).
    let err = rename_wallet_impl(&state, "payroll", "salaries").unwrap_err();
    assert!(
        err.contains("close it first"),
        "open-wallet rename must be refused: {err}"
    );

    // 3. A second wallet (same mnemonic, taproot branch) becomes the open
    //    one; "payroll" is now registered-but-closed.
    let status = create_wallet_impl(
        &state,
        None,
        &mnemonic,
        None,
        Some("other".into()),
        Some(DescriptorKindCfg::Bip86),
    )
    .expect("create other");
    assert_eq!(status.wallet_name, "other");

    // 4. Collision (case-insensitive) and invalid names are refused.
    let err = rename_wallet_impl(&state, "payroll", "OTHER").unwrap_err();
    assert!(err.contains("already exists"), "collision: {err}");
    let err = rename_wallet_impl(&state, "payroll", "bad name!").unwrap_err();
    assert!(err.contains("may only contain"), "invalid name: {err}");

    // 5. The real rename: registry entry moves, data dir moves.
    rename_wallet_impl(&state, "payroll", "salaries").expect("rename payroll -> salaries");
    let config = state.get_config();
    let names = config.wallet_names(WalletNetwork::Regtest);
    assert!(names.contains(&"salaries".to_string()), "{names:?}");
    assert!(!names.contains(&"payroll".to_string()), "{names:?}");
    let old_root = phoenix_pocx_lib::btcx_wallet::BtcxWalletConfig::wallet_root(
        WalletNetwork::Regtest,
        "payroll",
    );
    let new_root = phoenix_pocx_lib::btcx_wallet::BtcxWalletConfig::wallet_root(
        WalletNetwork::Regtest,
        "salaries",
    );
    assert!(!old_root.exists(), "old dir must be gone");
    assert!(
        new_root.join(seedstore::SEED_FILE).exists(),
        "seed must live under the new dir"
    );
    // The pointer still names the open wallet, untouched by the rename.
    assert_eq!(config.active_wallet_name(), "other");

    // 6. Reopen under the new name: the moved store carries the funds.
    let status = select_wallet_impl(&state, None, "salaries").expect("open renamed wallet");
    assert_eq!(status.wallet_name, "salaries");
    wait_for_balance(&state, 25_000_000, "salaries after rename + reopen");

    // 7. Pointer-follow: a SELECTED-but-closed wallet keeps the selection
    //    across its rename (an absent runtime lifts the open-wallet block).
    state.close_runtime();
    rename_wallet_impl(&state, "salaries", "salaries-2026").expect("rename the selected wallet");
    assert_eq!(state.get_config().active_wallet_name(), "salaries-2026");
    let status = select_wallet_impl(&state, None, "salaries-2026").expect("reopen");
    assert_eq!(status.wallet_name, "salaries-2026");
    wait_for_balance(&state, 25_000_000, "salaries-2026 after second rename");

    // Leave the node's clock alone for whoever runs next.
    rpc(None, "setmocktime", serde_json::json!([0]));
    state.close_runtime();
    std::env::remove_var("PHOENIX_DATA_DIR");
    std::env::remove_var("PACT_DISABLE_KEYRING");
    println!("wallet rename smoke: OK (payroll -> salaries -> salaries-2026, funds intact)");
}
