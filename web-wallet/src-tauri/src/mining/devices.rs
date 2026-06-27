//! Device detection for mining and plotting
//!
//! Detects available CPU and GPU devices for use with the plotter and miner.

use serde::{Deserialize, Serialize};
use sysinfo::System;

/// CPU information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: String,
    pub cores: u32,
    pub threads: u32,
    pub features: Vec<String>,
}

/// GPU information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub memory_mb: u64,
    pub platform_index: u32,
    pub device_index: u32,
    pub opencl_version: String,
    pub is_apu: bool,
    pub kernel_workgroup_size: u64,
}

/// System device information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub cpu: CpuInfo,
    pub gpus: Vec<GpuInfo>,
    pub total_memory_mb: u64,
    pub available_memory_mb: u64,
}

/// Detect CPU features
fn detect_cpu_features() -> Vec<String> {
    let mut features = Vec::new();

    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        if is_x86_feature_detected!("sse2") {
            features.push("SSE2".to_string());
        }
        if is_x86_feature_detected!("avx") {
            features.push("AVX".to_string());
        }
        if is_x86_feature_detected!("avx2") {
            features.push("AVX2".to_string());
        }
        if is_x86_feature_detected!("avx512f") {
            features.push("AVX512".to_string());
        }
    }

    #[cfg(target_arch = "aarch64")]
    {
        features.push("NEON".to_string());
    }

    features
}

/// Detect CPU information
pub fn detect_cpu() -> CpuInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu_all();

    let cpu_name = sys
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| {
            #[cfg(target_arch = "aarch64")]
            {
                "ARM/Other CPU".to_string()
            }
            #[cfg(not(target_arch = "aarch64"))]
            {
                "Unknown CPU".to_string()
            }
        });

    let cores = sys.physical_core_count().unwrap_or(1) as u32;
    let threads = num_cpus::get() as u32;

    CpuInfo {
        name: cpu_name,
        cores,
        threads,
        features: detect_cpu_features(),
    }
}

/// Detect GPU devices using pocx_plotter (compiles kernel to get accurate workgroup size)
pub fn detect_gpus() -> Vec<GpuInfo> {
    // Use pocx_plotter's GPU detection which compiles the kernel to get accurate workgroup size
    let plotter_gpus = pocx_plotter_v2::get_gpu_device_info();

    plotter_gpus
        .into_iter()
        .map(|g| {
            let gpu_id = format!(
                "{}:{}:{}",
                g.platform_index, g.device_index, g.compute_units
            );
            GpuInfo {
                id: gpu_id,
                name: g.name,
                vendor: g.vendor,
                memory_mb: g.memory_bytes / 1024 / 1024,
                platform_index: g.platform_index as u32,
                device_index: g.device_index as u32,
                opencl_version: g.opencl_version,
                is_apu: g.is_apu,
                kernel_workgroup_size: g.kernel_workgroup_size as u64,
            }
        })
        .collect()
}

/// Helper to read and parse /proc/meminfo on Android to bypass cgroup/container memory limits.
/// Returns (total_memory_mb, available_memory_mb) if successful.
#[cfg(target_os = "android")]
fn get_android_memory() -> Option<(u64, u64)> {
    let contents = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb = None;
    let mut available_kb = None;
    let mut free_kb = None;
    let mut buffers_kb = None;
    let mut cached_kb = None;

    for line in contents.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let key = parts[0].trim_end_matches(':');
            if let Ok(val) = parts[1].parse::<u64>() {
                match key {
                    "MemTotal" => total_kb = Some(val),
                    "MemAvailable" => available_kb = Some(val),
                    "MemFree" => free_kb = Some(val),
                    "Buffers" => buffers_kb = Some(val),
                    "Cached" => cached_kb = Some(val),
                    _ => {}
                }
            }
        }
    }

    let total_mb = total_kb.map(|kb| kb / 1024)?;
    let available_mb = if let Some(avail) = available_kb {
        avail / 1024
    } else if let (Some(free), Some(buf), Some(cache)) = (free_kb, buffers_kb, cached_kb) {
        (free + buf + cache) / 1024
    } else {
        total_mb * 2 / 3 // Fallback: estimate available as 2/3 of total
    };

    Some((total_mb, available_mb))
}

/// Detect all system devices
pub fn detect_devices() -> DeviceInfo {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let cpu = detect_cpu();
    let gpus = detect_gpus();

    #[cfg(target_os = "android")]
    let (total_memory_mb, available_memory_mb) = get_android_memory().unwrap_or_else(|| {
        (
            sys.total_memory() / 1024 / 1024,
            sys.available_memory() / 1024 / 1024,
        )
    });

    #[cfg(not(target_os = "android"))]
    let (total_memory_mb, available_memory_mb) = (
        sys.total_memory() / 1024 / 1024,
        sys.available_memory() / 1024 / 1024,
    );

    DeviceInfo {
        cpu,
        gpus,
        total_memory_mb,
        available_memory_mb,
    }
}
