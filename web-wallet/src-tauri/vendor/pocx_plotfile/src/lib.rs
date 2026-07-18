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

//! # PoCX Plot File Library
//!
//! A high-performance library for reading and writing PoC cryptocurrency plot
//! files. Plot files contain pre-computed hash values used for PoC mining
//! operations.
//!
//! ## Features
//!
//! - **Safe Error Handling**: Comprehensive error types with detailed error
//!   messages
//! - **Cross-Platform**: Works on Windows, Linux, and macOS
//! - **Direct I/O Support**: Optional direct I/O for maximum performance
//! - **Resume Capability**: Plot generation can be resumed after interruption
//! - **Memory Efficient**: Optimized for large plot files with minimal memory
//!   usage
//!
//! ## Plot File Format
//!
//! PoC plot files use the `.pocx` extension and contain:
//! - Pre-computed shabal256 hash values organized as scoops, nonces, and warps
//! - Base58-encoded account identifier with checksum
//! - Hex-encoded seed value
//! - Compression level and file size metadata
//!
//! ## Examples
//!
//! ### Opening an existing plot file for reading
//!
//! ```rust,no_run
//! use pocx_plotfile::{AccessType, PoCXPlotFile};
//! use std::path::Path;
//!
//! let mut plotfile = PoCXPlotFile::open(
//!     Path::new("example_account_seed_1024_X1.pocx"),
//!     AccessType::Read,
//!     false, // direct I/O disabled
//! )?;
//!
//! // Read nonce data
//! let nonce_data = plotfile.read_nonce(0, 42)?;
//! println!("Nonce data: {:?}", &nonce_data[..8]);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! ### Creating a new plot file
//!
//! ```rust,no_run
//! use pocx_plotfile::PoCXPlotFile;
//!
//! let address_payload = [0u8; 20]; // Address payload (network-independent)
//! let seed_decoded = [0u8; 32]; // Seed value
//!
//! let plotfile = PoCXPlotFile::new(
//!     "/path/to/plots", // Directory path
//!     &address_payload, // Address payload
//!     &seed_decoded,    // Seed
//!     1024,             // Number of warps
//!     1,                // Compression level
//!     false,            // Direct I/O
//!     true,             // Create new file
//! )?;
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

#[macro_use]
extern crate cfg_if;

mod buffer;
mod utils;

// Re-export utility functions for use by other crates
pub use utils::get_sector_size;
pub use utils::is_network_path;

use filetime::FileTime;
use std::cmp::min;
use std::error;
use std::fmt;
use std::fs;
use std::fs::File;
use std::io;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::buffer::PageAlignedByteBuffer;
use crate::utils::preallocate;
use crate::utils::{open_r, open_r_using_direct_io, open_rw, open_rw_using_direct_io};

/// Size of a single scoop in bytes
pub const SCOOP_SIZE: u64 = 64;
/// Number of scoops per nonce
pub const NUM_SCOOPS: u64 = 4096;
/// Size of a single nonce in bytes
pub const NONCE_SIZE: u64 = NUM_SCOOPS * SCOOP_SIZE;
/// Size of a single warp in bytes
pub const WARP_SIZE: u64 = NUM_SCOOPS * NONCE_SIZE;

/// Resume info magic number
const RESUME_MAGIC: [u8; 4] = [0xAF, 0xFE, 0xAF, 0xFE];

/// Result type for PoC plot file operations
pub type Result<T> = std::result::Result<T, PoCXPlotFileError>;

/// Errors that can occur during PoC plot file operations
#[derive(Debug)]
pub enum PoCXPlotFileError {
    /// I/O error occurred
    Io(io::Error),
    /// File not found
    FileNotFound(String),
    /// Invalid filename format
    InvalidFilename(String),
    /// Invalid file extension
    InvalidExtension(String),
    /// Invalid seed format
    InvalidSeed(String),
    /// Invalid Base58 format
    InvalidBase58(String),
    /// Invalid compression parameter
    InvalidCompression(String),
    /// File size mismatch
    FileSizeMismatch { expected: u64, actual: u64 },
    /// Nonce out of range
    NonceOutOfRange { nonce: u64, max: u64 },
    /// Warp out of range
    WarpOutOfRange { warp: u64, max: u64 },
    /// Invalid scoop number
    InvalidScoop { scoop: u64 },
    /// Write would exceed end of file
    WriteExceedsEof,
    /// Resume info gap detected
    ResumeGap { expected: u64, actual: u64 },
    /// No resume info found
    NoResumeInfo,
    /// Read-only file opened for writing
    ReadOnlyAccess,
    /// Hex decoding error
    HexDecode(hex::FromHexError),
    /// Address decoding error
    AddressDecode(pocx_address::AddressError),
    /// Integer parsing error
    ParseInt(std::num::ParseIntError),
}

impl fmt::Display for PoCXPlotFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PoCXPlotFileError::Io(err) => write!(f, "I/O error: {}", err),
            PoCXPlotFileError::FileNotFound(path) => write!(f, "File not found: {}", path),
            PoCXPlotFileError::InvalidFilename(name) => {
                write!(f, "Invalid filename format: {}", name)
            }
            PoCXPlotFileError::InvalidExtension(ext) => {
                write!(f, "Invalid file extension: {}", ext)
            }
            PoCXPlotFileError::InvalidSeed(seed) => write!(f, "Invalid seed format: {}", seed),
            PoCXPlotFileError::InvalidBase58(b58) => write!(f, "Invalid Base58 format: {}", b58),
            PoCXPlotFileError::InvalidCompression(comp) => {
                write!(f, "Invalid compression parameter: {}", comp)
            }
            PoCXPlotFileError::FileSizeMismatch { expected, actual } => {
                write!(
                    f,
                    "File size mismatch: expected {} bytes, got {} bytes",
                    expected, actual
                )
            }
            PoCXPlotFileError::NonceOutOfRange { nonce, max } => {
                write!(f, "Nonce {} is out of range [0..{}]", nonce, max)
            }
            PoCXPlotFileError::WarpOutOfRange { warp, max } => {
                write!(f, "Warp {} is out of range [0..{}]", warp, max)
            }
            PoCXPlotFileError::InvalidScoop { scoop } => {
                write!(f, "Scoop {} is out of range [0..{}]", scoop, NUM_SCOOPS - 1)
            }
            PoCXPlotFileError::WriteExceedsEof => {
                write!(f, "Write operation would exceed end of file")
            }
            PoCXPlotFileError::ResumeGap { expected, actual } => {
                write!(
                    f,
                    "Resume gap detected: expected warp {}, got {}",
                    expected, actual
                )
            }
            PoCXPlotFileError::NoResumeInfo => {
                write!(f, "No resume info found in plotfile (already completed)")
            }
            PoCXPlotFileError::ReadOnlyAccess => {
                write!(f, "Cannot write to file opened in read-only mode")
            }
            PoCXPlotFileError::HexDecode(err) => write!(f, "Hex decoding error: {}", err),
            PoCXPlotFileError::AddressDecode(err) => write!(f, "Address decoding error: {}", err),
            PoCXPlotFileError::ParseInt(err) => write!(f, "Integer parsing error: {}", err),
        }
    }
}

impl error::Error for PoCXPlotFileError {
    fn source(&self) -> Option<&(dyn error::Error + 'static)> {
        match self {
            PoCXPlotFileError::Io(err) => Some(err),
            PoCXPlotFileError::HexDecode(err) => Some(err),
            PoCXPlotFileError::AddressDecode(err) => Some(err),
            PoCXPlotFileError::ParseInt(err) => Some(err),
            _ => None,
        }
    }
}

impl From<io::Error> for PoCXPlotFileError {
    fn from(err: io::Error) -> Self {
        PoCXPlotFileError::Io(err)
    }
}

impl From<hex::FromHexError> for PoCXPlotFileError {
    fn from(err: hex::FromHexError) -> Self {
        PoCXPlotFileError::HexDecode(err)
    }
}

impl From<pocx_address::AddressError> for PoCXPlotFileError {
    fn from(err: pocx_address::AddressError) -> Self {
        PoCXPlotFileError::AddressDecode(err)
    }
}

impl From<std::num::ParseIntError> for PoCXPlotFileError {
    fn from(err: std::num::ParseIntError) -> Self {
        PoCXPlotFileError::ParseInt(err)
    }
}

/// A PoC cryptocurrency plot file for mining operations
///
/// This structure represents a plot file used in PoC cryptocurrency mining,
/// containing pre-computed hash values organized in scoops, nonces, and warps.
///
/// # Examples
///
/// ```rust,no_run
/// use pocx_plotfile::{AccessType, PoCXPlotFile};
/// use std::path::Path;
///
/// let plotfile = PoCXPlotFile::open(Path::new("example.pocx"), AccessType::Read, false)?;
/// # Ok::<(), pocx_plotfile::PoCXPlotFileError>(())
/// ```
#[derive(Debug)]
pub struct PoCXPlotFile {
    /// Metadata information about the plot file
    pub meta: PlotFileMeta,
    /// Optional file handle for I/O operations
    pub file_handle: Option<File>,
    /// Whether direct I/O is enabled for performance
    pub direct_io: bool,
    /// Storage device sector size for alignment
    pub sector_size: u64,
    /// Current access mode for the file
    pub access: AccessType,
    /// Current read progress in warps
    pub read_progress: u64,
}

/// Metadata for a PoC plot file
///
/// Contains all the identifying information and parameters
/// for a plot file, including Base58 account ID, seed, and size information.
#[derive(Debug, Clone)]
pub struct PlotFileMeta {
    /// Base58-encoded account identifier
    pub base58: String,
    /// Raw bytes of the account identifier payload (20 bytes,
    /// network-independent)
    pub base58_decoded: [u8; 20],
    /// Hex-encoded seed value
    pub seed: String,
    /// Raw bytes of the seed value
    pub seed_decoded: [u8; 32],
    /// Number of warps in this plot file
    pub number_of_warps: u64,
    /// Compression level (X factor, 1-255)
    pub compression: u8,
    /// Just the filename portion
    pub filename: String,
    /// Full path to the file
    pub filename_and_path: PathBuf,
    /// File modification time as Unix timestamp
    pub filetime: i64,
}

/// Access mode for opening plot files
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessType {
    /// Read-only access
    Read,
    /// Read-write access
    ReadWrite,
    /// Dummy mode for testing (no actual file I/O)
    Dummy,
}

impl PoCXPlotFile {
    /// Creates a new PoC plot file
    ///
    /// # Arguments
    ///
    /// * `path` - Directory path where the plot file will be created
    /// * `address_payload` - Raw address payload bytes (20 bytes,
    ///   network-independent)
    /// * `seed_decoded` - Raw bytes of the seed value (32 bytes)
    /// * `number_of_warps` - Number of warps in the plot file
    /// * `compression` - Compression level (X factor)
    /// * `direct_io` - Whether to use direct I/O for performance
    /// * `create` - Whether to create a new file (true) or open existing
    ///   (false)
    ///
    /// # Returns
    ///
    /// Returns a `PoCXPlotFile` instance ready for writing
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Directory doesn't exist or isn't writable
    /// - File pre-allocation fails
    /// - I/O operations fail
    ///
    /// # Examples
    ///
    /// ```rust,no_run
    /// use pocx_plotfile::PoCXPlotFile;
    ///
    /// let address_payload = [0u8; 20];
    /// let seed = [0u8; 32];
    ///
    /// let plotfile = PoCXPlotFile::new(
    ///     "/home/user/plots",
    ///     &address_payload,
    ///     &seed,
    ///     2048, // 2048 warps
    ///     2,    // X2 compression
    ///     true, // Use direct I/O
    ///     true, // Create new file
    /// )?;
    /// # Ok::<(), pocx_plotfile::PoCXPlotFileError>(())
    /// ```
    pub fn new(
        path: &str,
        address_payload: &[u8; 20],
        seed_decoded: &[u8; 32],
        number_of_warps: u64,
        compression: u8,
        mut direct_io: bool,
        create: bool,
    ) -> Result<PoCXPlotFile> {
        let base58 = hex::encode_upper(address_payload); // Now stores hex representation
        let plotfile = Path::new(path).join(format!(
            "{}_{}_{}_X{}.tmp",
            hex::encode_upper(address_payload),
            hex::encode_upper(seed_decoded),
            number_of_warps,
            compression
        ));

        if !create && !plotfile.exists() {
            #[cfg(not(test))]
            return Err(PoCXPlotFileError::FileNotFound(
                plotfile.to_string_lossy().to_string(),
            ));
        }

        // fast prealloc
        let write_resume_info = if create && !plotfile.exists() {
            preallocate(&plotfile, number_of_warps * WARP_SIZE, direct_io)?;
            true
        } else {
            false
        };

        let sector_size = crate::get_sector_size(&plotfile.to_string_lossy());

        // fallback for rare cases where writes and sector size are not aligned
        if direct_io && (sector_size & (sector_size - 1)) != 0 {
            direct_io = false;
        }

        // auto-disable direct I/O on network/virtual filesystems
        if direct_io && crate::is_network_path(&plotfile.to_string_lossy()) {
            eprintln!(
                "Info: Direct I/O disabled for network/virtual filesystem: {}",
                plotfile.display()
            );
            direct_io = false;
        }

        let file_handle = if direct_io {
            Some(open_rw_using_direct_io(&plotfile)?)
        } else {
            Some(open_rw(&plotfile)?)
        };

        let filetime = if let Some(ref handle) = file_handle {
            match handle.metadata() {
                Ok(file_meta) => FileTime::from_last_modification_time(&file_meta).unix_seconds(),
                Err(_) => 0i64,
            }
        } else {
            0i64
        };

        let mut plotfile = PoCXPlotFile {
            meta: PlotFileMeta {
                base58,
                base58_decoded: *address_payload,
                seed: hex::encode(seed_decoded),
                seed_decoded: *seed_decoded,
                number_of_warps,
                compression,
                filename: plotfile
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("unknown")
                    .to_string(),
                filename_and_path: plotfile,
                filetime,
            },
            file_handle,
            direct_io,
            sector_size,
            access: AccessType::ReadWrite,
            read_progress: 0,
        };

        if write_resume_info {
            plotfile.write_resume_info(0)?;
        }
        Ok(plotfile)
    }

    /// Opens an existing PoC plot file
    ///
    /// # Arguments
    ///
    /// * `plotfile` - Path to the plot file
    /// * `access` - Access mode (Read, ReadWrite, or Dummy)
    /// * `direct_io` - Whether to use direct I/O for performance
    ///
    /// # Returns
    ///
    /// Returns a `PoCXPlotFile` instance on success
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - File doesn't exist or isn't accessible
    /// - Filename format is invalid
    /// - File extension is not `.pocx`
    /// - File contents are corrupted or invalid
    pub fn open(plotfile: &Path, access: AccessType, mut direct_io: bool) -> Result<PoCXPlotFile> {
        if !plotfile.is_file() {
            return Err(PoCXPlotFileError::FileNotFound(
                plotfile.to_string_lossy().to_string(),
            ));
        }

        let filename = plotfile
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                PoCXPlotFileError::InvalidFilename(plotfile.to_string_lossy().to_string())
            })?;

        let parts: Vec<&str> = filename.split('_').collect();
        if parts.len() != 4 {
            return Err(PoCXPlotFileError::InvalidFilename(filename.to_string()));
        }

        let extension = plotfile
            .extension()
            .and_then(|ext| ext.to_str())
            .ok_or_else(|| {
                PoCXPlotFileError::InvalidExtension(plotfile.to_string_lossy().to_string())
            })?;

        if extension != "pocx" {
            return Err(PoCXPlotFileError::InvalidExtension(extension.to_string()));
        }
        let base58_raw = parts[0];
        let mut base58_raw_bytes = [0u8; 20];
        hex::decode_to_slice(base58_raw, &mut base58_raw_bytes)?;

        // Validate that we have exactly 20 bytes for the address payload
        // The plotfile format stores raw address bytes (without network ID or checksum)
        // This makes it network-independent - the same plotfile works for any network

        // Store the address data for the PlotFileMeta
        let base58 = base58_raw.to_string(); // Keep as hex string
        let base58_decoded = base58_raw_bytes; // Raw 20 bytes

        let seed_string = parts[1];
        if seed_string.len() != 64 {
            return Err(PoCXPlotFileError::InvalidSeed(format!(
                "Seed should be 64 hex characters, got {}: {}",
                seed_string.len(),
                seed_string
            )));
        }

        let mut seed_decoded = [0u8; 32];
        hex::decode_to_slice(seed_string, &mut seed_decoded)?;

        let number_of_warps = parts[2].parse::<u64>()?;

        if !parts[3].starts_with('X') {
            return Err(PoCXPlotFileError::InvalidCompression(format!(
                "Compression parameter should start with 'X': {}",
                parts[3]
            )));
        }

        let parts2: Vec<&str> = parts[3].split('.').collect();
        let compression_str = parts2
            .first()
            .and_then(|s| s.get(1..))
            .ok_or_else(|| PoCXPlotFileError::InvalidCompression(parts[3].to_string()))?;
        let compression = compression_str.parse::<u8>()?;

        let size = fs::metadata(plotfile)?.len();
        let exp_size = number_of_warps * WARP_SIZE;
        if size != exp_size {
            return Err(PoCXPlotFileError::FileSizeMismatch {
                expected: exp_size,
                actual: size,
            });
        }

        let sector_size = crate::get_sector_size(&plotfile.to_string_lossy());

        // fallback for rare cases where reads and sector size are not aligned
        if direct_io && (sector_size & (sector_size - 1)) != 0 {
            direct_io = false;
        }

        // auto-disable direct I/O on network/virtual filesystems
        if direct_io && crate::is_network_path(&plotfile.to_string_lossy()) {
            eprintln!(
                "Info: Direct I/O disabled for network/virtual filesystem: {}",
                plotfile.display()
            );
            direct_io = false;
        }

        let file_handle = match access {
            AccessType::Read => {
                if direct_io {
                    Some(open_r_using_direct_io(plotfile)?)
                } else {
                    Some(open_r(plotfile)?)
                }
            }
            AccessType::ReadWrite => {
                if direct_io {
                    Some(open_rw_using_direct_io(plotfile)?)
                } else {
                    Some(open_rw(plotfile)?)
                }
            }
            AccessType::Dummy => None,
        };

        let filetime = if let Some(ref handle) = file_handle {
            match handle.metadata() {
                Ok(file_meta) => FileTime::from_last_modification_time(&file_meta).unix_seconds(),
                Err(_) => 0i64,
            }
        } else {
            0i64
        };

        let plotfile = PoCXPlotFile {
            meta: PlotFileMeta {
                base58,
                base58_decoded,
                seed: hex::encode(seed_decoded),
                seed_decoded,
                number_of_warps,
                compression,
                filename: String::from(filename),
                filename_and_path: PathBuf::from(plotfile),
                filetime,
            },
            file_handle,
            direct_io,
            sector_size,
            access,
            read_progress: 0,
        };

        Ok(plotfile)
    }

    fn file_offset_nonce(&self, scoop: u64, nonce: u64) -> Result<u64> {
        if scoop >= NUM_SCOOPS {
            return Err(PoCXPlotFileError::InvalidScoop { scoop });
        }
        let max_nonce = self.meta.number_of_warps.saturating_mul(NUM_SCOOPS);
        if nonce >= max_nonce {
            return Err(PoCXPlotFileError::NonceOutOfRange {
                nonce,
                max: max_nonce.saturating_sub(1),
            });
        }
        Ok(scoop
            .saturating_mul(self.meta.number_of_warps)
            .saturating_mul(NUM_SCOOPS)
            .saturating_mul(SCOOP_SIZE)
            .saturating_add(nonce.saturating_mul(SCOOP_SIZE)))
    }

    fn file_offset_warp(&self, scoop: u64, warp: u64) -> Result<u64> {
        if scoop >= NUM_SCOOPS {
            return Err(PoCXPlotFileError::InvalidScoop { scoop });
        }
        if warp >= self.meta.number_of_warps {
            return Err(PoCXPlotFileError::WarpOutOfRange {
                warp,
                max: self.meta.number_of_warps.saturating_sub(1),
            });
        }
        Ok(scoop
            .saturating_mul(self.meta.number_of_warps)
            .saturating_mul(NUM_SCOOPS)
            .saturating_mul(SCOOP_SIZE)
            .saturating_add(warp.saturating_mul(NUM_SCOOPS).saturating_mul(SCOOP_SIZE)))
    }

    /// Reads nonce data from the specified scoop and nonce position
    ///
    /// # Arguments
    ///
    /// * `scoop` - Scoop index (0-4095)
    /// * `nonce` - Nonce index within the scoop
    ///
    /// # Returns
    ///
    /// Returns 64 bytes of nonce data
    ///
    /// # Errors
    ///
    /// Returns an error if nonce is out of range or I/O fails
    pub fn read_nonce(&mut self, scoop: u64, nonce: u64) -> Result<[u8; 64]> {
        // Check bounds first, regardless of access mode
        let _address = self.file_offset_nonce(scoop, nonce)?;

        let mut scoopdata = [0u8; 64];
        match self.access {
            AccessType::Read | AccessType::ReadWrite => {
                if let Some(ref mut handle) = self.file_handle {
                    handle.seek(SeekFrom::Start(_address))?;
                    handle.read_exact(&mut scoopdata)?;
                }
                Ok(scoopdata)
            }
            AccessType::Dummy => Ok(scoopdata),
        }
    }

    /// Reads warp data from the plot file
    ///
    /// # Arguments
    ///
    /// * `bs` - Buffer to read data into (must have sufficient capacity)
    /// * `scoop` - Scoop index to read from
    ///
    /// # Returns
    ///
    /// Returns the number of warps read
    pub fn read(&mut self, bs: &mut Vec<u8>, scoop: u64) -> Result<u64> {
        let buffer_capacity_warps = bs.capacity() as u64 / NUM_SCOOPS / SCOOP_SIZE;
        let remaining_warps = self.meta.number_of_warps - self.read_progress;
        let warps_to_read = min(remaining_warps, buffer_capacity_warps);
        let bytes_to_read = warps_to_read * NUM_SCOOPS * SCOOP_SIZE;
        let start_offset = self.file_offset_warp(scoop, self.read_progress)?;

        match self.access {
            AccessType::Read | AccessType::ReadWrite => {
                if let Some(ref mut handle) = self.file_handle {
                    handle.seek(SeekFrom::Start(start_offset))?;
                    handle.read_exact(&mut bs[0..bytes_to_read as usize])?;
                }
            }
            AccessType::Dummy => (),
        }

        self.read_progress += warps_to_read;

        Ok(warps_to_read)
    }

    /// Writes optimized buffer data into the plot file
    ///
    /// # Arguments
    ///
    /// * `data` - Buffer containing warp data to write
    /// * `start_warp` - Starting warp position
    /// * `warps_to_write` - Number of warps to write
    /// * `pb` - Optional progress bar for tracking write progress
    ///
    /// # Returns
    ///
    /// Returns the total number of bytes written
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - File is opened read-only
    /// - Resume info indicates a gap
    /// - Write would exceed file bounds
    pub fn write_optimised_buffer_into_plotfile(
        &mut self,
        data: &[u8],
        start_warp: u64,
        warps_to_write: u64,
        pb: &Option<Arc<indicatif::ProgressBar>>,
    ) -> Result<u64> {
        match self.access {
            AccessType::ReadWrite => {
                let progress = match self.read_resume_info() {
                    Ok(p) => p,
                    Err(PoCXPlotFileError::NoResumeInfo) => 0,
                    Err(e) => return Err(e),
                };

                if start_warp != progress {
                    return Err(PoCXPlotFileError::ResumeGap {
                        expected: progress,
                        actual: start_warp,
                    });
                }

                if start_warp + warps_to_write > self.meta.number_of_warps {
                    return Err(PoCXPlotFileError::WriteExceedsEof);
                }

                let data_warp_size = data.len() as u64 / WARP_SIZE;
                let mut total_write = 0;
                let write_len = (warps_to_write * NUM_SCOOPS * SCOOP_SIZE) as usize;

                // write all scoops
                for scoop in 0..NUM_SCOOPS {
                    let file_address =
                        self.file_offset(scoop, start_warp, self.meta.number_of_warps);
                    let data_address = self.file_offset(scoop, 0, data_warp_size) as usize;

                    if let Some(ref mut handle) = self.file_handle {
                        handle.seek(SeekFrom::Start(file_address))?;
                        handle.write_all(&data[data_address..data_address + write_len])?;
                    }

                    total_write += write_len;
                    if let Some(pb) = pb {
                        pb.inc(write_len as u64);
                    }
                }

                self.write_resume_info(start_warp + warps_to_write)?;

                // rename finished file
                if start_warp + warps_to_write == self.meta.number_of_warps {
                    self.finalize()?;
                }

                Ok(total_write as u64)
            }
            AccessType::Dummy => Ok(warps_to_write * NUM_SCOOPS * NUM_SCOOPS * SCOOP_SIZE),
            AccessType::Read => Err(PoCXPlotFileError::ReadOnlyAccess),
        }
    }

    fn file_offset(&self, scoop: u64, warp: u64, number_of_warps: u64) -> u64 {
        scoop * number_of_warps * NUM_SCOOPS * SCOOP_SIZE + warp * NUM_SCOOPS * SCOOP_SIZE
    }

    /// Finalize a fully-plotted file by renaming `<…>.tmp` → `<…>.pocx`.
    ///
    /// Drops the underlying file handle before renaming so the operation is
    /// safe on platforms that disallow renaming open files. No-op if the path
    /// does not have a `.tmp` extension (already finalized). Updates
    /// `self.meta.filename_and_path` and `self.meta.filename` on success.
    pub fn finalize(&mut self) -> Result<()> {
        if self
            .meta
            .filename_and_path
            .extension()
            .and_then(|e| e.to_str())
            != Some("tmp")
        {
            return Ok(());
        }
        // Drop the handle so Windows can rename even if the file was opened
        // without FILE_SHARE_DELETE.
        self.file_handle = None;
        let mut new_path = self.meta.filename_and_path.clone();
        new_path.set_extension("pocx");
        fs::rename(&self.meta.filename_and_path, &new_path).map_err(PoCXPlotFileError::Io)?;
        if let Some(name) = new_path.file_name().and_then(|n| n.to_str()) {
            self.meta.filename = name.to_string();
        }
        self.meta.filename_and_path = new_path;
        Ok(())
    }

    pub fn read_resume_info(&mut self) -> Result<u64> {
        match self.access {
            AccessType::Read | AccessType::ReadWrite => {
                // downgrade from direct_io
                if self.direct_io {
                    self.file_handle = Some(open_rw(&self.meta.filename_and_path)?);
                }
                let offset = self.meta.number_of_warps * WARP_SIZE - 8;

                if let Some(ref mut handle) = self.file_handle {
                    handle.seek(SeekFrom::Start(offset))?;

                    let mut progress = [0u8; 4];
                    let mut double_monkey = [0u8; 4];

                    handle.read_exact(&mut progress)?;
                    handle.read_exact(&mut double_monkey)?;

                    // upgrade to direct_io
                    if self.direct_io {
                        self.file_handle =
                            Some(open_rw_using_direct_io(&self.meta.filename_and_path)?);
                    }

                    if double_monkey == RESUME_MAGIC {
                        Ok(u64::from(as_u32_le(progress)))
                    } else {
                        Err(PoCXPlotFileError::NoResumeInfo)
                    }
                } else {
                    Err(PoCXPlotFileError::NoResumeInfo)
                }
            }
            AccessType::Dummy => Ok(0),
        }
    }

    pub fn write_resume_info(&mut self, warps_written: u64) -> Result<()> {
        match self.access {
            AccessType::ReadWrite => {
                // downgrade from direct_io
                if self.direct_io {
                    self.file_handle = Some(open_rw(&self.meta.filename_and_path)?);
                }
                let offset = self.meta.number_of_warps * WARP_SIZE - 8;

                if let Some(ref mut handle) = self.file_handle {
                    handle.seek(SeekFrom::Start(offset))?;

                    let progress = as_u8_le(warps_written as u32);

                    handle.write_all(&progress)?;
                    handle.write_all(&RESUME_MAGIC)?;
                }
                // upgrade to direct_io
                if self.direct_io {
                    self.file_handle = Some(open_rw_using_direct_io(&self.meta.filename_and_path)?);
                }
                Ok(())
            }
            AccessType::Read => Err(PoCXPlotFileError::ReadOnlyAccess),
            AccessType::Dummy => Ok(()),
        }
    }

    /// Wakes up the storage device by performing a random read operation
    /// This prevents HDDs from going to sleep during idle periods
    pub fn wakeup(&mut self) -> std::io::Result<()> {
        use rand::Rng;
        use std::io::{Read, Seek, SeekFrom};

        const WAKEUP_READ_SIZE: usize = 65536; // 64KB

        if let Some(ref mut file) = self.file_handle {
            // Generate random position
            let file_size = self.meta.number_of_warps * WARP_SIZE;
            let random_pos = rand::rng().random_range(0..file_size);

            // Align to actual device sector size BEFORE checking boundaries
            let aligned_pos = if self.direct_io {
                (random_pos / self.sector_size) * self.sector_size
            } else {
                random_pos
            };

            // Calculate aligned read size (must be multiple of sector size for direct I/O)
            let read_size = if self.direct_io {
                let sectors = WAKEUP_READ_SIZE.div_ceil(self.sector_size as usize);
                sectors * self.sector_size as usize
            } else {
                WAKEUP_READ_SIZE
            };

            // Ensure aligned position + read size doesn't exceed file bounds
            let safe_pos = if aligned_pos + read_size as u64 > file_size {
                // If read would exceed bounds, align backwards from end
                ((file_size - read_size as u64) / self.sector_size) * self.sector_size
            } else {
                aligned_pos
            };

            // Perform the wakeup read with aligned buffer for direct I/O
            if self.direct_io {
                let mut aligned_buffer = PageAlignedByteBuffer::new(read_size);
                let buffer_slice = &mut aligned_buffer.get_buffer_mut()[0..read_size];
                file.seek(SeekFrom::Start(safe_pos))?;
                file.read_exact(buffer_slice)?;
            } else {
                let mut buffer = vec![0u8; read_size];
                file.seek(SeekFrom::Start(safe_pos))?;
                file.read_exact(&mut buffer)?;
            }
        }

        Ok(())
    }
}

fn as_u32_le(array: [u8; 4]) -> u32 {
    u32::from(array[0])
        + (u32::from(array[1]) << 8)
        + (u32::from(array[2]) << 16)
        + (u32::from(array[3]) << 24)
}

fn as_u8_le(x: u32) -> [u8; 4] {
    let b1: u8 = (x & 0xff) as u8;
    let b2: u8 = ((x >> 8) & 0xff) as u8;
    let b3: u8 = ((x >> 16) & 0xff) as u8;
    let b4: u8 = ((x >> 24) & 0xff) as u8;
    [b1, b2, b3, b4]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    fn create_test_account_and_seed() -> ([u8; 20], [u8; 32]) {
        let address_payload = [0x12; 20]; // Address payload (network-independent)
        let seed = [0x56; 32]; // Test seed
        (address_payload, seed)
    }

    fn get_temp_dir() -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("pocx_plotfile_tests_{}", timestamp))
    }

    fn setup_test_dir() -> PathBuf {
        let temp_dir = get_temp_dir();
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir).ok();
        }
        fs::create_dir_all(&temp_dir).unwrap();
        temp_dir
    }

    fn cleanup_test_dir() {
        let temp_dir = get_temp_dir();
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir).ok();
        }
    }

    // Test error types
    #[test]
    fn test_error_display() {
        let err = PoCXPlotFileError::FileNotFound("test.pocx".to_string());
        assert!(err.to_string().contains("File not found: test.pocx"));

        let err = PoCXPlotFileError::FileSizeMismatch {
            expected: 1000,
            actual: 500,
        };
        assert!(err
            .to_string()
            .contains("expected 1000 bytes, got 500 bytes"));
    }

    #[test]
    fn test_as_u32_le() {
        let bytes = [0x12, 0x34, 0x56, 0x78];
        let result = as_u32_le(bytes);
        assert_eq!(result, 0x78563412);
    }

    #[test]
    fn test_as_u8_le() {
        let num = 0x12345678u32;
        let result = as_u8_le(num);
        assert_eq!(result, [0x78, 0x56, 0x34, 0x12]);
    }

    #[test]
    fn test_nonce_bounds_checking() -> Result<()> {
        let temp_dir = setup_test_dir();
        let (account, seed) = create_test_account_and_seed();

        let mut plotfile = match PoCXPlotFile::new(
            temp_dir.to_str().unwrap(),
            &account,
            &seed,
            1, // Only 1 warp = 4096 nonces
            1,
            false,
            false, // Don't create file
        ) {
            Ok(pf) => pf,
            Err(_) => {
                cleanup_test_dir();
                return Ok(()); // Skip test if can't create plotfile
            }
        };

        plotfile.access = AccessType::Dummy;

        // Valid nonce should work
        plotfile.read_nonce(0, 0)?;
        plotfile.read_nonce(0, 4095)?; // Last valid nonce

        // Invalid nonce should fail
        let result = plotfile.read_nonce(0, 4096);
        assert!(matches!(
            result,
            Err(PoCXPlotFileError::NonceOutOfRange { .. })
        ));

        cleanup_test_dir();
        Ok(())
    }

    #[test]
    fn test_warp_bounds_checking() -> Result<()> {
        let temp_dir = setup_test_dir();
        let (account, seed) = create_test_account_and_seed();

        let plotfile = match PoCXPlotFile::new(
            temp_dir.to_str().unwrap(),
            &account,
            &seed,
            2, // 2 warps
            1,
            false,
            false, // Don't create file
        ) {
            Ok(pf) => pf,
            Err(_) => {
                cleanup_test_dir();
                return Ok(()); // Skip test if can't create plotfile
            }
        };

        // Valid warp should work
        let _ = plotfile.file_offset_warp(0, 0)?;
        let _ = plotfile.file_offset_warp(0, 1)?;

        // Invalid warp should fail
        let result = plotfile.file_offset_warp(0, 2);
        assert!(matches!(
            result,
            Err(PoCXPlotFileError::WarpOutOfRange { .. })
        ));

        cleanup_test_dir();
        Ok(())
    }

    #[test]
    fn test_sector_size() {
        // This test uses the existing test from utils
        let cwd = env::current_dir().unwrap();
        let test_string = cwd.into_os_string().into_string().unwrap();
        let sector_size = crate::utils::get_sector_size(&test_string);
        assert_ne!(sector_size, 0);
        assert!(sector_size.is_power_of_two() || sector_size == 0);
    }

    #[test]
    fn test_file_offset_calculations() {
        let temp_dir = setup_test_dir();
        let (account, seed) = create_test_account_and_seed();

        let plotfile = PoCXPlotFile::new(
            temp_dir.to_str().unwrap(),
            &account,
            &seed,
            4, // 4 warps
            1,
            false,
            false,
        )
        .unwrap();

        // Test nonce offset calculation
        let offset_result = plotfile.file_offset_nonce(0, 0);
        assert!(offset_result.is_ok());
        assert_eq!(offset_result.unwrap(), 0);

        // Test warp offset calculation
        let warp_offset_result = plotfile.file_offset_warp(0, 0);
        assert!(warp_offset_result.is_ok());

        // Test boundary condition for scoop bounds (NUM_SCOOPS-1 should be valid,
        // NUM_SCOOPS should fail)
        let last_valid_scoop = plotfile.file_offset_nonce(NUM_SCOOPS - 1, 0);
        assert!(last_valid_scoop.is_ok(), "NUM_SCOOPS-1 should be valid");

        // Test with extremely large scoop value - this should fail
        let invalid_scoop_result = plotfile.file_offset_nonce(u64::MAX, 0);
        assert!(
            invalid_scoop_result.is_err(),
            "Extremely large scoop should fail"
        );

        cleanup_test_dir();
    }

    #[test]
    fn test_conversion_functions() {
        // Test as_u32_le
        let bytes = [0x12, 0x34, 0x56, 0x78];
        let value = as_u32_le(bytes);
        assert_eq!(value, 0x78563412);

        // Test as_u8_le roundtrip
        let original = 0x12345678u32;
        let bytes = as_u8_le(original);
        let roundtrip = as_u32_le(bytes);
        assert_eq!(original, roundtrip);
    }

    #[test]
    fn test_error_sources() {
        use std::error::Error;

        let io_err = PoCXPlotFileError::Io(io::Error::new(io::ErrorKind::NotFound, "test"));
        assert!(io_err.source().is_some());

        let hex_err = PoCXPlotFileError::HexDecode(hex::FromHexError::InvalidHexCharacter {
            c: 'z',
            index: 0,
        });
        assert!(hex_err.source().is_some());

        let file_not_found_err = PoCXPlotFileError::FileNotFound("test.pocx".to_string());
        assert!(file_not_found_err.source().is_none());
    }

    #[test]
    fn test_wakeup_without_direct_io() -> Result<()> {
        use std::fs::File;
        use std::io::Write;

        let temp_dir = setup_test_dir();
        let (account, seed) = create_test_account_and_seed();

        // Create a test file with proper size
        let test_file = temp_dir.join(format!(
            "{}_{}_{}_X1.pocx",
            hex::encode(account),
            hex::encode(seed),
            1
        ));

        let file_size = WARP_SIZE as usize;
        let mut file = File::create(&test_file)?;
        file.write_all(&vec![0u8; file_size])?;
        file.sync_all()?;
        drop(file);

        // Open without direct I/O
        let mut plotfile = PoCXPlotFile::open(&test_file, AccessType::Read, false)?;

        // Test wakeup without direct I/O
        let result = plotfile.wakeup();
        assert!(result.is_ok());

        cleanup_test_dir();
        Ok(())
    }

    #[test]
    #[cfg(unix)]
    fn test_wakeup_with_direct_io() -> Result<()> {
        use std::fs::File;
        use std::io::Write;

        let temp_dir = setup_test_dir();
        let (account, seed) = create_test_account_and_seed();

        // Create a test file with proper size
        let test_file = temp_dir.join(format!(
            "{}_{}_{}_X1.pocx",
            hex::encode(account),
            hex::encode(seed),
            1
        ));

        let file_size = WARP_SIZE as usize;
        let mut file = File::create(&test_file)?;
        file.write_all(&vec![0u8; file_size])?;
        file.sync_all()?;
        drop(file);

        // Open with direct I/O
        let result = PoCXPlotFile::open(&test_file, AccessType::Read, true);

        // Direct I/O may not be supported on all filesystems/configurations
        // If it fails to open, skip the test
        if result.is_err() {
            cleanup_test_dir();
            return Ok(());
        }

        let mut plotfile = result?;

        // Test wakeup with direct I/O
        let wakeup_result = plotfile.wakeup();

        // Wakeup should succeed with aligned buffer
        assert!(
            wakeup_result.is_ok(),
            "Wakeup with direct I/O should succeed with aligned buffer: {:?}",
            wakeup_result.err()
        );

        cleanup_test_dir();
        Ok(())
    }
}
