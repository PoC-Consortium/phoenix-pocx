//! SHA256 hash verification
//!
//! Verifies downloaded files against expected hashes.

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// Result of hash verification
#[derive(Debug, Clone)]
pub struct HashResult {
    /// The computed hash (lowercase hex)
    pub computed: String,
    /// The expected hash (lowercase hex)
    pub expected: String,
    /// Whether they match
    pub matches: bool,
}

/// Compute SHA256 hash of a file
pub fn compute_file_hash(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;

    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    let hash = hasher.finalize();
    Ok(hex::encode(hash))
}

/// Verify a file's SHA256 hash against expected value
pub fn verify_file_hash(path: &Path, expected_hash: &str) -> Result<HashResult, String> {
    let computed = compute_file_hash(path)?;
    let expected = expected_hash.to_lowercase();
    let matches = computed == expected;

    log::info!(
        "Hash verification for {}: computed={}, expected={}, matches={}",
        path.display(),
        &computed[..16],
        &expected[..16.min(expected.len())],
        matches
    );

    Ok(HashResult {
        computed,
        expected,
        matches,
    })
}

/// Compute SHA256 hash of bytes (for small data)
pub fn compute_bytes_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_compute_bytes_hash() {
        // Known hash for "hello world"
        let hash = compute_bytes_hash(b"hello world");
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn test_verify_file_hash() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"test content").unwrap();

        let result = verify_file_hash(
            file.path(),
            "6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72",
        )
        .unwrap();

        assert!(result.matches);
    }

    #[test]
    fn test_verify_file_hash_mismatch() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"test content").unwrap();

        let result = verify_file_hash(file.path(), "0000000000000000000000000000000000000000000000000000000000000000").unwrap();

        assert!(!result.matches);
    }
}
