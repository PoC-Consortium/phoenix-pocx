use serde::Serialize;
use std::net::SocketAddr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::UdpSocket;

const NTP_SERVERS: &[&str] = &["time.cloudflare.com", "time.google.com", "time.nist.gov"];
const NTP_TIMEOUT: Duration = Duration::from_secs(2);
const NTP_EPOCH_OFFSET: u64 = 2_208_988_800; // seconds between 1900-01-01 and 1970-01-01

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NtpSample {
    pub server: String,
    pub offset_ms: i64,
    pub rtt_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockDriftReport {
    /// Median offset across successful samples, in milliseconds.
    /// Positive = local clock is ahead of NTP; negative = behind.
    pub offset_ms: i64,
    pub samples: Vec<NtpSample>,
}

async fn query_ntp(server: &'static str) -> Result<NtpSample, String> {
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host(format!("{}:123", server))
        .await
        .map_err(|e| format!("dns: {}", e))?
        .collect();
    if addrs.is_empty() {
        return Err("no address".to_string());
    }

    // Try each resolved address end-to-end (connect + round-trip). On
    // dual-stack hosts the resolver may return IPv6 first; if that path is
    // unreachable — a family mismatch on the socket, or a configured-but-
    // dead IPv6 route that times out — we fall through to the next address
    // (e.g. IPv4) instead of failing the whole server.
    let mut last_err = "no address".to_string();
    for addr in addrs {
        match query_ntp_addr(server, addr).await {
            Ok(sample) => return Ok(sample),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// Query a single resolved NTP endpoint. The socket's address family is
/// matched to `addr`: an IPv4-bound socket cannot connect to an IPv6
/// address (WSAEAFNOSUPPORT on Windows) and vice versa.
async fn query_ntp_addr(server: &'static str, addr: SocketAddr) -> Result<NtpSample, String> {
    let bind_addr = if addr.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
    let socket = UdpSocket::bind(bind_addr)
        .await
        .map_err(|e| format!("bind: {}", e))?;
    socket
        .connect(addr)
        .await
        .map_err(|e| format!("connect: {}", e))?;

    let mut packet = [0u8; 48];
    packet[0] = 0x1B; // LI=0, VN=3, Mode=3 (client)

    let t1 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time: {}", e))?;
    let (t1_secs, t1_frac) = unix_to_ntp(t1);
    packet[40..44].copy_from_slice(&t1_secs.to_be_bytes());
    packet[44..48].copy_from_slice(&t1_frac.to_be_bytes());

    socket
        .send(&packet)
        .await
        .map_err(|e| format!("send: {}", e))?;

    let mut response = [0u8; 48];
    let n = tokio::time::timeout(NTP_TIMEOUT, socket.recv(&mut response))
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|e| format!("recv: {}", e))?;
    if n < 48 {
        return Err(format!("short response: {} bytes", n));
    }

    let t4 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time: {}", e))?;

    let t2_secs = u32::from_be_bytes(response[32..36].try_into().unwrap());
    let t2_frac = u32::from_be_bytes(response[36..40].try_into().unwrap());
    let t3_secs = u32::from_be_bytes(response[40..44].try_into().unwrap());
    let t3_frac = u32::from_be_bytes(response[44..48].try_into().unwrap());

    // Server returning zero timestamps usually means Kiss-of-Death.
    if (t2_secs | t2_frac | t3_secs | t3_frac) == 0 {
        return Err("server returned zero timestamps".to_string());
    }

    let t1_ns = duration_to_ns(t1);
    let t4_ns = duration_to_ns(t4);
    let t2_ns = ntp_to_unix_ns(t2_secs, t2_frac);
    let t3_ns = ntp_to_unix_ns(t3_secs, t3_frac);

    // Standard NTP offset: ((T2 - T1) + (T3 - T4)) / 2
    let offset_ns = ((t2_ns - t1_ns) + (t3_ns - t4_ns)) / 2;
    let rtt_ns = (t4_ns - t1_ns) - (t3_ns - t2_ns);

    Ok(NtpSample {
        server: server.to_string(),
        offset_ms: (offset_ns / 1_000_000) as i64,
        rtt_ms: (rtt_ns.max(0) / 1_000_000) as u64,
    })
}

fn unix_to_ntp(d: Duration) -> (u32, u32) {
    let secs = (d.as_secs() + NTP_EPOCH_OFFSET) as u32;
    let frac = (((d.subsec_nanos() as u64) << 32) / 1_000_000_000) as u32;
    (secs, frac)
}

fn ntp_to_unix_ns(secs: u32, frac: u32) -> i128 {
    let unix_secs = secs as i128 - NTP_EPOCH_OFFSET as i128;
    let nanos = (frac as u128 * 1_000_000_000 / (1u128 << 32)) as i128;
    unix_secs * 1_000_000_000 + nanos
}

fn duration_to_ns(d: Duration) -> i128 {
    d.as_secs() as i128 * 1_000_000_000 + d.subsec_nanos() as i128
}

/// Query multiple NTP servers in parallel and return the median offset.
/// Requires at least 2 successful samples; otherwise returns an error so
/// the caller can silently skip (avoids spurious warnings on flaky links).
#[tauri::command]
pub async fn check_clock_drift() -> Result<ClockDriftReport, String> {
    let mut handles = Vec::with_capacity(NTP_SERVERS.len());
    for server in NTP_SERVERS {
        handles.push(tokio::spawn(query_ntp(server)));
    }

    let mut samples: Vec<NtpSample> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(sample)) => samples.push(sample),
            Ok(Err(e)) => errors.push(e),
            Err(e) => errors.push(format!("join: {}", e)),
        }
    }

    if samples.len() < 2 {
        return Err(format!(
            "ntp_unreachable: {}/{} servers responded ({})",
            samples.len(),
            NTP_SERVERS.len(),
            errors.join("; ")
        ));
    }

    let mut offsets: Vec<i64> = samples.iter().map(|s| s.offset_ms).collect();
    offsets.sort_unstable();
    let median = offsets[offsets.len() / 2];

    Ok(ClockDriftReport {
        offset_ms: median,
        samples,
    })
}
