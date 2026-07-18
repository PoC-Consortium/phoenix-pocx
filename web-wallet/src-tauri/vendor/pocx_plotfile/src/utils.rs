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

use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;

cfg_if! {
    if #[cfg(unix)] {
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        #[cfg(not(target_vendor = "apple"))]
        use std::os::unix::fs::OpenOptionsExt;
        use fs2::FileExt;

        #[cfg(not(target_vendor = "apple"))]
        fn apply_direct_io_flags(opts: &mut OpenOptions) {
            opts.custom_flags(libc::O_DIRECT);
        }

        #[cfg(target_vendor = "apple")]
        fn apply_direct_io_post_open(file: &File) -> io::Result<()> {
            use std::os::unix::io::AsRawFd;
            let fd = file.as_raw_fd();
            if unsafe { libc::fcntl(fd, libc::F_NOCACHE, 1) } != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        pub fn open_r_using_direct_io<P: AsRef<Path>>(path: P) -> io::Result<File> {
            let mut opts = OpenOptions::new();
            opts.read(true);
            #[cfg(not(target_vendor = "apple"))]
            apply_direct_io_flags(&mut opts);
            let file = opts.open(path)?;
            #[cfg(target_vendor = "apple")]
            apply_direct_io_post_open(&file)?;
            Ok(file)
        }

        pub fn open_r<P: AsRef<Path>>(path: P) -> io::Result<File> {
            OpenOptions::new()
                .read(true)
                .open(path)
        }

        pub fn open_rw_using_direct_io<P: AsRef<Path>>(path: P) -> io::Result<File> {
            let mut opts = OpenOptions::new();
            opts.read(true).write(true).create(true);
            #[cfg(not(target_vendor = "apple"))]
            apply_direct_io_flags(&mut opts);
            let file = opts.open(path)?;
            #[cfg(target_vendor = "apple")]
            apply_direct_io_post_open(&file)?;
            Ok(file)
        }

        pub fn open_rw<P: AsRef<Path>>(path: P) -> io::Result<File> {
            OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)
        }

        /// Returns the filesystem block size for direct I/O alignment.
        ///
        /// Uses statvfs() instead of external commands (df, lsblk, diskutil).
        /// Returns f_frsize which is the correct alignment for direct I/O on all
        /// filesystem types including network (NFS, SMB, 9p) and virtual (FUSE).
        pub fn get_sector_size(path: &str) -> u64 {
            let c_path = match CString::new(path) {
                Ok(p) => p,
                Err(_) => return 4096,
            };

            let mut stat: MaybeUninit<libc::statvfs> = MaybeUninit::uninit();
            if unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) } != 0 {
                return 4096;
            }
            let stat = unsafe { stat.assume_init() };

            #[allow(clippy::unnecessary_cast)]
            let block_size = if stat.f_frsize > 0 {
                stat.f_frsize as u64
            } else if stat.f_bsize > 0 {
                stat.f_bsize as u64
            } else {
                4096
            };

            // Must be power of 2 and reasonable (up to 1 MiB)
            if block_size > 0 && block_size <= 1_048_576 && (block_size & (block_size - 1)) == 0 {
                block_size
            } else {
                4096
            }
        }

        /// Detects if a path resides on a network or virtual filesystem.
        ///
        /// Checks the filesystem type via statfs(). Known network/virtual FS types:
        /// NFS, SMB/CIFS, 9p/virtio, FUSE, AFS, Ceph.
        pub fn is_network_path(path: &str) -> bool {
            let c_path = match CString::new(path) {
                Ok(p) => p,
                Err(_) => return false,
            };

            #[cfg(target_vendor = "apple")]
            {
                let mut stat: MaybeUninit<libc::statfs> = MaybeUninit::uninit();
                if unsafe { libc::statfs(c_path.as_ptr(), stat.as_mut_ptr()) } != 0 {
                    return false;
                }
                let stat = unsafe { stat.assume_init() };
                // macOS uses f_fstypename string instead of f_type magic number
                let fstype = unsafe {
                    std::ffi::CStr::from_ptr(stat.f_fstypename.as_ptr())
                };
                let fstype_str = fstype.to_str().unwrap_or("");
                matches!(fstype_str, "nfs" | "smbfs" | "afpfs" | "webdav" | "osxfuse"
                    | "macfuse" | "fuse" | "fusefs")
            }

            #[cfg(not(target_vendor = "apple"))]
            {
                let mut stat: MaybeUninit<libc::statfs> = MaybeUninit::uninit();
                if unsafe { libc::statfs(c_path.as_ptr(), stat.as_mut_ptr()) } != 0 {
                    return false;
                }
                let stat = unsafe { stat.assume_init() };
                // Linux filesystem magic numbers from statfs(2).
                // Allow cast: __fsword_t is i64 on x86_64 but i32 on 32-bit.
                #[allow(clippy::unnecessary_cast)]
                let ftype = stat.f_type as i64;
                matches!(
                    ftype,
                    0x6969        // NFS
                    | 0x517B      // SMB
                    | 0x01021997  // 9p/virtio
                    | 0x65735546  // FUSE
                    | 0x5346414F  // AFS
                    | 0x00C36400  // Ceph
                ) || ftype as u32 == 0xFE534D42  // SMB2
                  || ftype as u32 == 0xFF534D42   // CIFS
            }
        }

        /// Preallocates disk space for a file.
        ///
        /// Attempts fallocate() first for instant contiguous preallocation, then
        /// falls back to ftruncate (set_len) for filesystems that don't support
        /// fallocate (e.g., 9p/virtio, NFS, FUSE).
        pub fn preallocate(file: &Path, size_in_bytes: u64, use_direct_io: bool) -> io::Result<()> {
            let f = if use_direct_io {
                open_rw_using_direct_io(file)
            } else {
                open_rw(file)
            }?;

            if f.allocate(size_in_bytes).is_err() {
                // fallocate unsupported (network/virtual FS) — fallback to ftruncate
                eprintln!(
                    "WARNING: fallocate unsupported, using ftruncate. \
                     Disk space is NOT reserved — ensure sufficient free space."
                );
                f.set_len(size_in_bytes)?;
            }

            Ok(())
        }
    } else {
        use std::ptr::null_mut;
        use std::iter::once;
        use std::ffi::OsStr;
        use std::os::windows::io::AsRawHandle;
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::fs::OpenOptionsExt;
        use core::mem::size_of_val;
        use winapi::um::errhandlingapi::GetLastError;
        use winapi::um::fileapi::SetFileValidData;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::processthreadsapi::{OpenProcessToken,GetCurrentProcess};
        use winapi::um::securitybaseapi::AdjustTokenPrivileges;
        use winapi::um::winbase::LookupPrivilegeValueW;
        use winapi::um::winnt::{LUID, TOKEN_ADJUST_PRIVILEGES,TOKEN_PRIVILEGES,LUID_AND_ATTRIBUTES,SE_PRIVILEGE_ENABLED,SE_MANAGE_VOLUME_NAME};

        const FILE_FLAG_NO_BUFFERING: u32 = 0x2000_0000;
        const FILE_FLAG_RANDOM_ACCESS: u32 = 0x1000_0000;
        const FILE_FLAG_WRITE_THROUGH: u32 = 0x8000_0000;

        pub fn open_r_using_direct_io<P: AsRef<Path>>(path: P) -> io::Result<File> {
            OpenOptions::new()
                .read(true)
                .custom_flags(FILE_FLAG_NO_BUFFERING)
                .open(path)
        }

        pub fn open_r<P: AsRef<Path>>(path: P) -> io::Result<File> {
            OpenOptions::new()
                .read(true)
                .custom_flags(FILE_FLAG_RANDOM_ACCESS)
                .open(path)
        }

        pub fn open_rw_using_direct_io<P: AsRef<Path>>(path: P) -> io::Result<File> {
            OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .custom_flags(FILE_FLAG_NO_BUFFERING)
                .open(path)
        }

        pub fn open_rw<P: AsRef<Path>>(path: P) -> io::Result<File> {
            OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .custom_flags(FILE_FLAG_WRITE_THROUGH)
                .open(path)
        }

        /// Resolves a file path to its volume root with trailing backslash.
        fn get_volume_root(path: &str) -> Option<String> {
            let path_encoded: Vec<u16> = OsStr::new(path)
                .encode_wide()
                .chain(once(0))
                .collect();

            const MAX_PATH: usize = 260;
            let mut volume_buf: Vec<u16> = vec![0u16; MAX_PATH + 1];

            if unsafe {
                winapi::um::fileapi::GetVolumePathNameW(
                    path_encoded.as_ptr(),
                    volume_buf.as_mut_ptr(),
                    (MAX_PATH + 1) as u32,
                )
            } == 0 {
                return None;
            }

            let result = String::from_utf16_lossy(&volume_buf);
            let trimmed = result.trim_end_matches('\0');
            let mut root = trimmed.to_string();
            if !root.ends_with('\\') && !root.ends_with('/') {
                root.push('\\');
            }
            Some(root)
        }

        /// Detects if a path is on a network share (UNC path or mapped network drive).
        pub fn is_network_path(path: &str) -> bool {
            // Check UNC path prefix
            if path.starts_with("\\\\") || path.starts_with("//") {
                return true;
            }

            // Check mapped drives via GetDriveTypeW
            const DRIVE_REMOTE: u32 = 4;
            if let Some(root) = get_volume_root(path) {
                let root_encoded: Vec<u16> = OsStr::new(&root)
                    .encode_wide()
                    .chain(once(0))
                    .collect();
                let drive_type = unsafe {
                    winapi::um::fileapi::GetDriveTypeW(root_encoded.as_ptr())
                };
                return drive_type == DRIVE_REMOTE;
            }
            false
        }

        pub fn get_sector_size(path: &str) -> u64 {
            if is_network_path(path) {
                return 4096;
            }

            let root = match get_volume_root(path) {
                Some(r) => r,
                None => return 4096,
            };

            let root_encoded: Vec<u16> = OsStr::new(&root)
                .encode_wide()
                .chain(once(0))
                .collect();

            let mut sectors_per_cluster: u32 = 0;
            let mut bytes_per_sector: u32 = 0;
            let mut number_of_free_clusters: u32 = 0;
            let mut total_number_of_clusters: u32 = 0;

            if unsafe {
                winapi::um::fileapi::GetDiskFreeSpaceW(
                    root_encoded.as_ptr(),
                    &mut sectors_per_cluster,
                    &mut bytes_per_sector,
                    &mut number_of_free_clusters,
                    &mut total_number_of_clusters,
                )
            } == 0 {
                return 4096;
            }
            u64::from(bytes_per_sector)
        }

        pub fn preallocate(file: &Path, size_in_bytes: u64, use_direct_io: bool) -> io::Result<()> {
            let mut result = true;
            result &= obtain_privilege();

            let file = if use_direct_io {
                open_rw_using_direct_io(file)
            } else {
                open_rw(file)
            }?;

            file.set_len(size_in_bytes)?;

            if result {
                let handle = file.as_raw_handle();
                unsafe {
                    if SetFileValidData(handle, size_in_bytes as i64) == 0 {
                        eprintln!("WARNING: SetFileValidData failed, but file preallocation completed");
                    }
                }
            }

            Ok(())
        }

        fn obtain_privilege() -> bool {
            let mut result = true;

            let privilege_encoded: Vec<u16> = OsStr::new(SE_MANAGE_VOLUME_NAME)
                .encode_wide()
                .chain(once(0))
                .collect();

            let luid = LUID{
                HighPart: 0i32,
                LowPart: 0u32
            };

            unsafe {
                let mut htoken = null_mut();
                let mut tp = TOKEN_PRIVILEGES{
                    PrivilegeCount: 1,
                    Privileges: [LUID_AND_ATTRIBUTES{
                    Luid: luid,
                    Attributes: SE_PRIVILEGE_ENABLED,
                    }]
                };

                let temp = OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES, &mut htoken);
                result &= temp == 1;

                let temp = LookupPrivilegeValueW(null_mut(), privilege_encoded.as_ptr(), &mut tp.Privileges[0].Luid);
                result &= temp == 1;

                let temp = AdjustTokenPrivileges(htoken, 0, &mut tp, size_of_val(&tp) as u32, null_mut(), null_mut());

                CloseHandle(htoken);
                result &= temp == 1;
                result &=
                    GetLastError() == 0u32
            }
            result
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use std::env;

    #[test]
    fn test_get_sector_size() {
        let cwd = env::current_dir().expect("Should be able to get current directory in test");
        let test_string = cwd
            .into_os_string()
            .into_string()
            .expect("Should be able to convert path to string in test");
        let size = get_sector_size(&test_string);
        assert_ne!(0, size);
        assert_eq!(size & (size - 1), 0, "sector size must be power of 2");
    }

    #[test]
    fn test_is_network_path_local() {
        assert!(!is_network_path("."));
    }

    #[cfg(windows)]
    #[test]
    fn test_is_network_path_unc() {
        assert!(is_network_path("\\\\server\\share\\path"));
    }
}
