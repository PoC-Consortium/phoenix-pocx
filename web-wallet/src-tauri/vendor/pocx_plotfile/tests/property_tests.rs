// Copyright (c) 2025 Proof of Capacity Consortium
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

//! Property-based tests for pocx_plotfile

use pocx_plotfile::{AccessType, PoCXPlotFile, NUM_SCOOPS};
use proptest::prelude::*;
use tempfile::TempDir;

/// Strategy for generating valid plot file parameters
fn valid_plot_params() -> impl Strategy<Value = (u64, u32)> {
    (
        1u64..50u64, // number_of_warps: small but meaningful for tests
        1u32..5u32,  // compression: reasonable range
    )
}

/// Strategy for generating test address payload and seed data
fn account_and_seed_strategy() -> impl Strategy<Value = ([u8; 20], [u8; 32])> {
    any::<([u8; 20], [u8; 32])>().prop_map(|(account, seed)| {
        // Address payload is already in correct format (20 bytes)
        (account, seed)
    })
}

proptest! {
    /// Test that plot file creation and metadata are consistent
    #[test]
    fn test_create_consistency(
        (number_of_warps, compression) in valid_plot_params(),
        (account, seed) in account_and_seed_strategy()
    ) {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path().to_str().unwrap();

        // Create plot file (dummy mode for testing)
        let plotfile_result = PoCXPlotFile::new(
            temp_path,
            &account,
            &seed,
            number_of_warps,
            compression as u8,
            false, // no direct I/O
            false  // don't create actual file
        );

        if let Ok(plotfile) = plotfile_result {
            // Verify parameters are preserved
            assert_eq!(plotfile.meta.number_of_warps, number_of_warps);
            assert_eq!(plotfile.meta.compression, compression as u8);
            assert_eq!(plotfile.meta.base58_decoded, account);
            assert_eq!(plotfile.meta.seed_decoded, seed);

            // Verify metadata consistency
            assert!(!plotfile.meta.base58.is_empty());
            assert_eq!(plotfile.meta.seed.len(), 64); // Hex string should be 64 chars
        }
    }

    /// Test that reading operations are safe with various parameters
    #[test]
    fn test_safe_reading(
        (number_of_warps, compression) in valid_plot_params(),
        (account, seed) in account_and_seed_strategy(),
        scoop in 0u64..4096u64,
        nonce in 0u64..100u64
    ) {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path().to_str().unwrap();

        let plotfile_result = PoCXPlotFile::new(
            temp_path,
            &account,
            &seed,
            number_of_warps,
            compression as u8,
            false,
            false
        );

        if let Ok(mut plotfile) = plotfile_result {
            // Override to dummy mode for safe testing
            plotfile.access = AccessType::Dummy;

            // Calculate valid nonce range for this plotfile
            let max_nonces = number_of_warps * NUM_SCOOPS;

            if nonce < max_nonces {
                // This should not panic for valid nonces
                let result = plotfile.read_nonce(scoop, nonce);

                // Either succeeds or fails gracefully
                if let Ok(data) = result {
                    assert_eq!(data.len(), 64);
                }
                // Errors are acceptable, just no panics
            } else {
                // Out of bounds nonce should return an error, not panic
                let result = plotfile.read_nonce(scoop, nonce);
                assert!(result.is_err());
            }
        }
    }
}
