//! Descriptor-at-rest storage for imported (descriptor-source) wallets.
//!
//! A descriptor-imported wallet has NO mnemonic — its key material is the
//! private descriptor pair itself, stored in the wallet's data dir in place
//! of `seed.mnemonic`. The at-rest bar mirrors `seedstore` where its API
//! allows: seedstore is mnemonic-shaped (`import_seed` BIP39-validates), so
//! it cannot wrap an arbitrary payload — this module re-implements the same
//! two wraps with the same primitives and parameters.
//!
//! ## Format note (`descriptor.secret`, one line)
//!
//! - `PHXDESCv1:<salt>:<nonce>:<ct>` — user passphrase, scrypt
//!   (N=2^15, r=8, p=1) + ChaCha20-Poly1305, hex fields. Byte-for-byte the
//!   seedstore `PACTSEEDv1` scheme under a distinct magic; only this wrap
//!   counts as ENCRYPTED (lockable).
//! - `PHXDESCv1-obfs:<nonce>:<ct>` — no passphrase: ChaCha20-Poly1305 under
//!   a built-in obfuscation key. Like seedstore's `PACTSEEDv2-obfs` this is
//!   treated as UNENCRYPTED for trust decisions — it only lifts the
//!   descriptors off plaintext ASCII. (seedstore's OS-keystore wrap is not
//!   replicated: its keyring plumbing is private to that crate; the
//!   obfuscation wrap is the same bar every Linux seed already has.)
//!
//! The plaintext payload is the JSON [`DescriptorPayload`].

use chacha20poly1305::aead::Aead;
use chacha20poly1305::{ChaCha20Poly1305, KeyInit};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// File name of the descriptor store inside a wallet's data dir — the
/// descriptor-source counterpart of `seedstore::SEED_FILE`.
pub const DESCRIPTOR_FILE: &str = "descriptor.secret";

const DESC_MAGIC: &str = "PHXDESCv1";
const DESC_MAGIC_OBFS: &str = "PHXDESCv1-obfs";
/// scrypt cost, identical to seedstore: N=2^15, r=8, p=1 — interactive.
const SCRYPT_LOG_N: u8 = 15;
/// The no-passphrase obfuscation key. NOT a secret — it ships in the
/// open-source binary and is always treated as UNENCRYPTED for trust; it
/// only raises the file from plaintext ASCII to a binary blob. Bytes spell
/// "PHX-desc-obfs-v1-do-not-trust!!!".
const OBFUSCATION_KEY: [u8; 32] = [
    0x50, 0x48, 0x58, 0x2d, 0x64, 0x65, 0x73, 0x63, 0x2d, 0x6f, 0x62, 0x66, 0x73, 0x2d, 0x76, 0x31,
    0x2d, 0x64, 0x6f, 0x2d, 0x6e, 0x6f, 0x74, 0x2d, 0x74, 0x72, 0x75, 0x73, 0x74, 0x21, 0x21, 0x21,
];

/// The stored key material of a descriptor-imported wallet: the private
/// descriptor pair, exactly as the bdk store opens with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DescriptorPayload {
    /// Format version of this payload (currently 1).
    pub version: u32,
    /// External (receive) private descriptor.
    pub external: String,
    /// Internal (change) private descriptor.
    pub internal: String,
}

/// Lifecycle snapshot of one wallet's descriptor store — mirrors
/// `seedstore::WalletStatus`.
#[derive(Debug, Clone, Copy)]
pub struct DescStatus {
    pub exists: bool,
    /// Passphrase-wrapped (the only wrap that can be locked).
    pub encrypted: bool,
    /// Passphrase-wrapped and no passphrase held in memory.
    pub locked: bool,
}

/// The descriptor file in one wallet data dir, plus the in-memory
/// passphrase (if any) that decrypts it — the descriptor-source counterpart
/// of `seedstore::SeedStore`.
pub struct DescStore {
    dir: PathBuf,
    passphrase: Option<String>,
}

/// Whether on-disk descriptor-store contents are passphrase-encrypted —
/// the only wrap that needs an unlock before it can be read.
pub fn is_passphrase_descriptor_file(contents: &str) -> bool {
    let line = contents.trim_start();
    line.starts_with(DESC_MAGIC) && !line.starts_with(DESC_MAGIC_OBFS)
}

impl DescStore {
    /// Open the store in `dir` (created if missing) with no passphrase
    /// held. Reading an encrypted store then requires [`Self::unlock`].
    pub fn open(dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("creating {}: {e}", dir.display()))?;
        Ok(Self {
            dir: dir.to_path_buf(),
            passphrase: None,
        })
    }

    fn file_path(&self) -> PathBuf {
        self.dir.join(DESCRIPTOR_FILE)
    }

    /// Lifecycle snapshot — cheap (a file probe, no scrypt).
    pub fn status(&self) -> DescStatus {
        let Ok(contents) = std::fs::read_to_string(self.file_path()) else {
            return DescStatus {
                exists: false,
                encrypted: false,
                locked: false,
            };
        };
        let encrypted = is_passphrase_descriptor_file(&contents);
        DescStatus {
            exists: true,
            encrypted,
            locked: encrypted && self.passphrase.is_none(),
        }
    }

    /// Write `payload` to disk, wrapped: passphrase-encrypted when a
    /// non-empty passphrase is given, obfuscation-wrapped otherwise (never
    /// plaintext ASCII). Refuses to overwrite an existing store — never
    /// clobber key material.
    pub fn import(
        &mut self,
        payload: &DescriptorPayload,
        passphrase: Option<&str>,
    ) -> Result<(), String> {
        let path = self.file_path();
        if path.exists() {
            return Err(format!(
                "{} already exists — refusing to overwrite a descriptor store",
                path.display()
            ));
        }
        let json =
            serde_json::to_string(payload).map_err(|e| format!("serializing descriptors: {e}"))?;
        let pass = passphrase.filter(|p| !p.is_empty());
        let contents = match pass {
            Some(pass) => encrypt_passphrase(&json, pass)?,
            None => encrypt_obfs(&json)?,
        };
        write_atomic(&path, &contents)?;
        self.passphrase = pass.map(str::to_string);
        Ok(())
    }

    /// Supply the passphrase of an encrypted store, verifying it by trial
    /// decryption before holding it in memory.
    pub fn unlock(&mut self, passphrase: &str) -> Result<(), String> {
        let contents = std::fs::read_to_string(self.file_path())
            .map_err(|_| "no imported descriptors here".to_string())?;
        if !is_passphrase_descriptor_file(&contents) {
            return Err("descriptor store is not passphrase-encrypted — no unlock needed".into());
        }
        decrypt_passphrase(contents.trim(), passphrase)?;
        self.passphrase = Some(passphrase.to_string());
        Ok(())
    }

    /// Read and unwrap the stored descriptor payload.
    pub fn payload(&self) -> Result<DescriptorPayload, String> {
        let path = self.file_path();
        let contents = std::fs::read_to_string(&path)
            .map_err(|_| format!("no descriptor store at {}", path.display()))?;
        let line = contents.trim();
        let json = if let Some(rest) = line.strip_prefix(&format!("{DESC_MAGIC_OBFS}:")) {
            let mut parts = rest.split(':');
            let nonce = parts.next().ok_or("malformed descriptor store")?;
            let ct = parts.next().ok_or("malformed descriptor store")?;
            decrypt_v1(nonce, ct, &OBFUSCATION_KEY)?
        } else if line.starts_with(DESC_MAGIC) {
            let pass = self
                .passphrase
                .as_deref()
                .ok_or("descriptor store is encrypted — supply the passphrase first")?;
            decrypt_passphrase(line, pass)?
        } else {
            return Err("unknown descriptor store format".into());
        };
        serde_json::from_str(&json).map_err(|e| format!("parsing descriptor store: {e}"))
    }
}

fn random_bytes<const N: usize>() -> [u8; N] {
    use rand::RngCore;
    let mut b = [0u8; N];
    rand::thread_rng().fill_bytes(&mut b);
    b
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    let params =
        scrypt::Params::new(SCRYPT_LOG_N, 8, 1, 32).map_err(|e| format!("scrypt params: {e}"))?;
    scrypt::scrypt(passphrase.as_bytes(), salt, &params, &mut key)
        .map_err(|e| format!("scrypt key derivation: {e}"))?;
    Ok(key)
}

fn encrypt_passphrase(plaintext: &str, passphrase: &str) -> Result<String, String> {
    let salt = random_bytes::<16>();
    let nonce = random_bytes::<12>();
    let key = derive_key(passphrase, &salt)?;
    let cipher = ChaCha20Poly1305::new((&key).into());
    let ct = cipher
        .encrypt((&nonce).into(), plaintext.as_bytes())
        .map_err(|_| "descriptor encryption failed".to_string())?;
    Ok(format!(
        "{DESC_MAGIC}:{}:{}:{}\n",
        hex::encode(salt),
        hex::encode(nonce),
        hex::encode(ct)
    ))
}

fn decrypt_passphrase(line: &str, passphrase: &str) -> Result<String, String> {
    let mut parts = line.split(':');
    let magic = parts.next().unwrap_or_default();
    if magic != DESC_MAGIC {
        return Err(format!("unknown descriptor store format {magic:?}"));
    }
    let salt = parts.next().ok_or("malformed descriptor store")?;
    let nonce = parts.next().ok_or("malformed descriptor store")?;
    let ct = parts.next().ok_or("malformed descriptor store")?;
    let key = derive_key(passphrase, &hex::decode(salt).map_err(|e| format!("{e}"))?)?;
    decrypt_raw(nonce, ct, &key).map_err(|_| "wrong passphrase?".to_string())
}

fn encrypt_obfs(plaintext: &str) -> Result<String, String> {
    let nonce = random_bytes::<12>();
    let cipher = ChaCha20Poly1305::new((&OBFUSCATION_KEY).into());
    let ct = cipher
        .encrypt((&nonce).into(), plaintext.as_bytes())
        .map_err(|_| "descriptor wrap failed".to_string())?;
    Ok(format!(
        "{DESC_MAGIC_OBFS}:{}:{}\n",
        hex::encode(nonce),
        hex::encode(ct)
    ))
}

fn decrypt_v1(nonce_hex: &str, ct_hex: &str, key: &[u8; 32]) -> Result<String, String> {
    decrypt_raw(nonce_hex, ct_hex, key).map_err(|e| e.to_string())
}

fn decrypt_raw(nonce_hex: &str, ct_hex: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = ChaCha20Poly1305::new(key.into());
    let nonce = hex::decode(nonce_hex).map_err(|e| format!("{e}"))?;
    let ct = hex::decode(ct_hex).map_err(|e| format!("{e}"))?;
    let pt = cipher
        .decrypt(nonce.as_slice().into(), ct.as_slice())
        .map_err(|_| "descriptor decryption failed".to_string())?;
    String::from_utf8(pt).map_err(|_| "decrypted descriptors are not UTF-8".to_string())
}

/// Atomic write (temp file + fsync + rename), the seedstore pattern: the
/// file is only ever observed fully written or not at all.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("secret.tmp");
    {
        use std::io::Write;
        let mut f =
            std::fs::File::create(&tmp).map_err(|e| format!("creating {}: {e}", tmp.display()))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| format!("writing {}: {e}", tmp.display()))?;
        f.sync_all()
            .map_err(|e| format!("flushing {}: {e}", tmp.display()))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("installing {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> DescriptorPayload {
        DescriptorPayload {
            version: 1,
            external: "wpkh(tprvEXAMPLE/0/*)".into(),
            internal: "wpkh(tprvEXAMPLE/1/*)".into(),
        }
    }

    #[test]
    fn unattended_roundtrip_never_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = DescStore::open(dir.path()).unwrap();
        assert!(!store.status().exists);

        store.import(&payload(), None).unwrap();
        let on_disk = std::fs::read_to_string(dir.path().join(DESCRIPTOR_FILE)).unwrap();
        assert!(
            on_disk.starts_with(DESC_MAGIC_OBFS),
            "no-passphrase store must be obfuscation-wrapped, got: {on_disk}"
        );
        assert!(!on_disk.contains("tprvEXAMPLE"), "never plaintext ASCII");
        assert!(!is_passphrase_descriptor_file(&on_disk));

        let status = store.status();
        assert!(status.exists && !status.encrypted && !status.locked);
        assert_eq!(store.payload().unwrap(), payload());

        // A reopened store reads without any unlock (auto-read wrap).
        let reopened = DescStore::open(dir.path()).unwrap();
        assert_eq!(reopened.payload().unwrap(), payload());

        // Never overwrite existing key material.
        assert!(store.import(&payload(), None).is_err());
    }

    #[test]
    fn passphrase_roundtrip_lock_and_unlock() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = DescStore::open(dir.path()).unwrap();
        store.import(&payload(), Some("hunter2")).unwrap();

        let on_disk = std::fs::read_to_string(dir.path().join(DESCRIPTOR_FILE)).unwrap();
        assert!(is_passphrase_descriptor_file(&on_disk));

        // Importer holds the passphrase — readable, encrypted, not locked.
        let status = store.status();
        assert!(status.exists && status.encrypted && !status.locked);
        assert_eq!(store.payload().unwrap(), payload());

        // A fresh open is locked; reading refuses; wrong passphrase fails.
        let mut reopened = DescStore::open(dir.path()).unwrap();
        assert!(reopened.status().locked);
        assert!(reopened.payload().is_err());
        assert!(reopened.unlock("wrong").is_err());
        assert!(reopened.status().locked);

        // The right passphrase unlocks; same payload.
        reopened.unlock("hunter2").unwrap();
        assert!(!reopened.status().locked);
        assert_eq!(reopened.payload().unwrap(), payload());
    }

    #[test]
    fn empty_passphrase_is_treated_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = DescStore::open(dir.path()).unwrap();
        store.import(&payload(), Some("")).unwrap();
        let on_disk = std::fs::read_to_string(dir.path().join(DESCRIPTOR_FILE)).unwrap();
        assert!(on_disk.starts_with(DESC_MAGIC_OBFS));
        assert!(!store.status().encrypted);
    }
}
