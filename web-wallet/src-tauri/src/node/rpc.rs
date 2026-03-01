//! Simple RPC client for node management
//!
//! Used for checking node readiness and graceful shutdown.

use super::config::NodeConfig;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::time::Duration;

/// RPC request structure
#[derive(Debug, Serialize)]
struct RpcRequest<'a> {
    jsonrpc: &'static str,
    id: u32,
    method: &'a str,
    params: Vec<serde_json::Value>,
}

/// RPC response structure
#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

/// RPC error structure
#[derive(Debug, Deserialize)]
struct RpcError {
    code: i32,
    message: String,
}

/// Simple RPC client for node management
pub struct NodeRpcClient {
    url: String,
    auth: Option<String>,
}

impl NodeRpcClient {
    /// Create a new RPC client from node config
    pub fn from_config(config: &NodeConfig) -> Self {
        let port = config.effective_rpc_port();
        let url = format!("http://127.0.0.1:{}", port);

        // Try to read cookie file for authentication
        let auth = Self::read_cookie_auth(config);

        Self { url, auth }
    }

    /// Read cookie authentication from data directory
    fn read_cookie_auth(config: &NodeConfig) -> Option<String> {
        let data_dir = config.get_data_directory();

        // Cookie file location depends on network
        let cookie_path = match config.network {
            super::config::Network::Mainnet => data_dir.join(".cookie"),
            super::config::Network::Testnet => {
                // Try testnet3 first (Bitcoin Core default), then testnet
                let testnet3 = data_dir.join("testnet3").join(".cookie");
                if testnet3.exists() {
                    testnet3
                } else {
                    let testnet = data_dir.join("testnet").join(".cookie");
                    if testnet.exists() {
                        testnet
                    } else {
                        testnet3 // Default to testnet3
                    }
                }
            }
            super::config::Network::Regtest => data_dir.join("regtest").join(".cookie"),
        };

        match std::fs::read_to_string(&cookie_path) {
            Ok(content) => {
                let trimmed = content.trim();
                // Cookie format is __cookie__:randomhex
                let encoded = base64_encode(trimmed);
                Some(format!("Basic {}", encoded))
            }
            Err(_) => None,
        }
    }

    /// Make an RPC call
    async fn call<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<T, String> {
        let request = RpcRequest {
            jsonrpc: "1.0",
            id: 1,
            method,
            params,
        };

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let mut req = client.post(&self.url).json(&request);

        if let Some(ref auth) = self.auth {
            req = req.header("Authorization", auth);
        }

        let response = req
            .send()
            .await
            .map_err(|e| format!("RPC request failed: {}", e))?;

        let rpc_response: RpcResponse<T> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse RPC response: {}", e))?;

        if let Some(error) = rpc_response.error {
            return Err(format!("RPC error {}: {}", error.code, error.message));
        }

        rpc_response
            .result
            .ok_or_else(|| "RPC response missing result".to_string())
    }

    /// Check if the node is ready by calling getblockchaininfo
    pub async fn is_ready(&self) -> bool {
        // Try to get blockchain info - if it works, node is ready
        let result: Result<serde_json::Value, _> = self.call("getblockchaininfo", vec![]).await;
        result.is_ok()
    }

    /// Send stop command for graceful shutdown
    pub async fn stop(&self) -> Result<String, String> {
        self.call("stop", vec![]).await
    }

    /// Get blockchain info
    pub async fn get_blockchain_info(&self) -> Result<serde_json::Value, String> {
        self.call("getblockchaininfo", vec![]).await
    }
}

/// Wait for the node to be ready (RPC responding)
pub async fn wait_for_node_ready(config: &NodeConfig, timeout_secs: u64) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    log::info!(
        "Waiting for node to be ready (timeout: {}s)...",
        timeout_secs
    );

    loop {
        if start.elapsed() > timeout {
            return Err(format!(
                "Node failed to become ready within {} seconds",
                timeout_secs
            ));
        }

        // Create a new client each time to re-read the cookie file
        // (cookie file may not exist when node is just starting)
        let client = NodeRpcClient::from_config(config);
        if client.is_ready().await {
            log::info!("Node is ready (took {:?})", start.elapsed());
            return Ok(());
        }

        // Wait before retrying
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Gracefully stop the node via RPC
pub async fn stop_node_gracefully(config: &NodeConfig) -> Result<(), String> {
    let client = NodeRpcClient::from_config(config);

    log::info!("Sending RPC stop command...");
    match client.stop().await {
        Ok(msg) => {
            log::info!("Node stop response: {}", msg);
            Ok(())
        }
        Err(e) => {
            // If we can't connect, node might already be stopped
            if e.contains("request failed") || e.contains("connection") {
                log::info!("Node appears to already be stopped");
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

/// Simple base64 encoding (no external dependency)
fn base64_encode(input: &str) -> String {
    let mut buf = Vec::new();
    {
        let mut encoder = Base64Encoder::new(&mut buf);
        encoder.write_all(input.as_bytes()).unwrap();
        encoder.finish().unwrap();
    }
    String::from_utf8(buf).unwrap()
}

/// Simple base64 encoder
struct Base64Encoder<W: Write> {
    writer: W,
    buffer: [u8; 3],
    buffer_len: usize,
}

impl<W: Write> Base64Encoder<W> {
    fn new(writer: W) -> Self {
        Self {
            writer,
            buffer: [0; 3],
            buffer_len: 0,
        }
    }

    fn finish(mut self) -> std::io::Result<()> {
        if self.buffer_len > 0 {
            self.flush_buffer()?;
        }
        Ok(())
    }

    fn flush_buffer(&mut self) -> std::io::Result<()> {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

        let b = &self.buffer[..self.buffer_len];
        let mut out = [b'='; 4];

        match b.len() {
            3 => {
                out[0] = ALPHABET[(b[0] >> 2) as usize];
                out[1] = ALPHABET[(((b[0] & 0x03) << 4) | (b[1] >> 4)) as usize];
                out[2] = ALPHABET[(((b[1] & 0x0f) << 2) | (b[2] >> 6)) as usize];
                out[3] = ALPHABET[(b[2] & 0x3f) as usize];
            }
            2 => {
                out[0] = ALPHABET[(b[0] >> 2) as usize];
                out[1] = ALPHABET[(((b[0] & 0x03) << 4) | (b[1] >> 4)) as usize];
                out[2] = ALPHABET[((b[1] & 0x0f) << 2) as usize];
            }
            1 => {
                out[0] = ALPHABET[(b[0] >> 2) as usize];
                out[1] = ALPHABET[((b[0] & 0x03) << 4) as usize];
            }
            _ => {}
        }

        self.writer.write_all(&out)?;
        self.buffer_len = 0;
        Ok(())
    }
}

impl<W: Write> Write for Base64Encoder<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        for &byte in buf {
            self.buffer[self.buffer_len] = byte;
            self.buffer_len += 1;

            if self.buffer_len == 3 {
                self.flush_buffer()?;
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
