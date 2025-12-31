import { Injectable } from '@angular/core';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { base58check } from '@scure/base';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Descriptor types for Bitcoin Core
 */
export type DescriptorType = 'pkh' | 'sh_wpkh' | 'wpkh' | 'tr';

/**
 * A single descriptor with its metadata
 */
export interface DescriptorInfo {
  descriptor: string; // Full descriptor with checksum
  type: DescriptorType; // Type of descriptor
  path: string; // Derivation path
  internal: boolean; // true = change, false = receive
  active: boolean; // Should be active in wallet
  range: [number, number]; // Address range to derive
  timestamp: number | 'now'; // When to start scanning
}

/**
 * Full set of descriptors for a wallet
 */
export interface WalletDescriptors {
  fingerprint: string;
  descriptors: DescriptorInfo[];
}

/**
 * Options for descriptor generation
 */
export interface DescriptorOptions {
  passphrase?: string;
  isTestnet?: boolean;
  account?: number;
  addressRange?: [number, number];
  enableLegacy?: boolean; // BIP44 (pkh)
  enableNestedSegwit?: boolean; // BIP49 (sh(wpkh))
  enableNativeSegwit?: boolean; // BIP84 (wpkh)
  enableTaproot?: boolean; // BIP86 (tr)
}

// Version bytes for different networks
const VERSION_BYTES = {
  mainnet: { xprv: 0x0488ade4, xpub: 0x0488b21e },
  testnet: { tprv: 0x04358394, tpub: 0x043587cf },
};

// Descriptor checksum character set (same as bech32)
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * DescriptorService handles BIP39 mnemonic and Bitcoin descriptor operations.
 *
 * Generates all standard descriptor types for Bitcoin Core wallet import:
 * - BIP44: Legacy P2PKH (pkh)
 * - BIP49: Nested SegWit P2SH-P2WPKH (sh(wpkh))
 * - BIP84: Native SegWit P2WPKH (wpkh)
 * - BIP86: Taproot P2TR (tr)
 *
 * Implements BIP-380 descriptor checksums.
 */
@Injectable({ providedIn: 'root' })
export class DescriptorService {
  /**
   * Generate a new BIP39 mnemonic
   * @param strength - 128 for 12 words, 256 for 24 words
   */
  generateMnemonic(strength: 128 | 256 = 256): string {
    return bip39.generateMnemonic(wordlist, strength);
  }

  /**
   * Validate a BIP39 mnemonic
   */
  validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic.trim().toLowerCase(), wordlist);
  }

  /**
   * Get BIP39 wordlist
   */
  getWordlist(): string[] {
    return [...wordlist];
  }

  /**
   * Get word suggestions from the BIP39 wordlist
   */
  getWordSuggestions(prefix: string, limit = 5): string[] {
    if (!prefix) return [];
    const lowerPrefix = prefix.toLowerCase();
    return wordlist.filter((word: string) => word.startsWith(lowerPrefix)).slice(0, limit);
  }

  /**
   * Split mnemonic into word array
   */
  mnemonicToWordArray(mnemonic: string): string[] {
    return mnemonic.trim().split(/\s+/);
  }

  /**
   * Generate all standard descriptors from a mnemonic for Bitcoin Core import
   *
   * By default creates 8 descriptors (4 types × 2 for receive/change).
   * Can be customized via options to enable/disable specific types.
   */
  generateDescriptors(mnemonic: string, options: DescriptorOptions = {}): WalletDescriptors {
    const {
      passphrase = '',
      isTestnet = true,
      account = 0,
      addressRange = [0, 999],
      enableLegacy = true,
      enableNestedSegwit = true,
      enableNativeSegwit = true,
      enableTaproot = true,
    } = options;

    // Validate mnemonic
    if (!this.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }

    // Generate seed from mnemonic
    const normalizedMnemonic = mnemonic.trim().toLowerCase();
    const seed = bip39.mnemonicToSeedSync(normalizedMnemonic, passphrase);

    // Create master key
    const masterKey = HDKey.fromMasterSeed(seed);

    // Get master fingerprint
    const fingerprint = this.getFingerprint(masterKey);

    const coinType = isTestnet ? 1 : 0;
    const descriptors: DescriptorInfo[] = [];
    const timestamp = 'now' as const;

    // BIP44 - Legacy P2PKH (pkh)
    if (enableLegacy) {
      const path = `m/44'/${coinType}'/${account}'`;
      const key = masterKey.derive(path);
      const xprv = this.serializeKey(key, false, isTestnet);

      descriptors.push(
        this.createDescriptorInfo(
          'pkh',
          fingerprint,
          `44h/${coinType}h/${account}h`,
          xprv,
          0,
          path,
          addressRange,
          timestamp
        ),
        this.createDescriptorInfo(
          'pkh',
          fingerprint,
          `44h/${coinType}h/${account}h`,
          xprv,
          1,
          path,
          addressRange,
          timestamp
        )
      );
    }

    // BIP49 - Nested SegWit P2SH-P2WPKH (sh(wpkh))
    if (enableNestedSegwit) {
      const path = `m/49'/${coinType}'/${account}'`;
      const key = masterKey.derive(path);
      const xprv = this.serializeKey(key, false, isTestnet);

      descriptors.push(
        this.createDescriptorInfo(
          'sh_wpkh',
          fingerprint,
          `49h/${coinType}h/${account}h`,
          xprv,
          0,
          path,
          addressRange,
          timestamp
        ),
        this.createDescriptorInfo(
          'sh_wpkh',
          fingerprint,
          `49h/${coinType}h/${account}h`,
          xprv,
          1,
          path,
          addressRange,
          timestamp
        )
      );
    }

    // BIP84 - Native SegWit P2WPKH (wpkh)
    if (enableNativeSegwit) {
      const path = `m/84'/${coinType}'/${account}'`;
      const key = masterKey.derive(path);
      const xprv = this.serializeKey(key, false, isTestnet);

      descriptors.push(
        this.createDescriptorInfo(
          'wpkh',
          fingerprint,
          `84h/${coinType}h/${account}h`,
          xprv,
          0,
          path,
          addressRange,
          timestamp
        ),
        this.createDescriptorInfo(
          'wpkh',
          fingerprint,
          `84h/${coinType}h/${account}h`,
          xprv,
          1,
          path,
          addressRange,
          timestamp
        )
      );
    }

    // BIP86 - Taproot P2TR (tr)
    if (enableTaproot) {
      const path = `m/86'/${coinType}'/${account}'`;
      const key = masterKey.derive(path);
      const xprv = this.serializeKey(key, false, isTestnet);

      descriptors.push(
        this.createDescriptorInfo(
          'tr',
          fingerprint,
          `86h/${coinType}h/${account}h`,
          xprv,
          0,
          path,
          addressRange,
          timestamp
        ),
        this.createDescriptorInfo(
          'tr',
          fingerprint,
          `86h/${coinType}h/${account}h`,
          xprv,
          1,
          path,
          addressRange,
          timestamp
        )
      );
    }

    return { fingerprint, descriptors };
  }

  /**
   * Format descriptors for Bitcoin Core importdescriptors RPC call
   */
  formatForImport(walletDescriptors: WalletDescriptors): Array<{
    desc: string;
    active: boolean;
    internal: boolean;
    range: [number, number];
    timestamp: number | 'now';
  }> {
    return walletDescriptors.descriptors.map(d => ({
      desc: d.descriptor,
      active: d.active,
      internal: d.internal,
      range: d.range,
      timestamp: d.timestamp,
    }));
  }

  /**
   * Calculate descriptor checksum per BIP-380
   */
  calculateChecksum(descriptor: string): string {
    return this.descriptorChecksum(descriptor);
  }

  /**
   * Add checksum to a descriptor if it doesn't have one
   */
  addChecksum(descriptor: string): string {
    if (descriptor.includes('#')) {
      return descriptor; // Already has checksum
    }
    return `${descriptor}#${this.descriptorChecksum(descriptor)}`;
  }

  /**
   * Get human-readable label for a descriptor type
   */
  getDescriptorLabel(type: DescriptorType): string {
    switch (type) {
      case 'pkh':
        return 'Legacy (P2PKH)';
      case 'sh_wpkh':
        return 'Nested SegWit (P2SH-P2WPKH)';
      case 'wpkh':
        return 'Native SegWit (P2WPKH)';
      case 'tr':
        return 'Taproot (P2TR)';
      default:
        return 'Unknown';
    }
  }

  // ============================================================
  // Private Helper Methods
  // ============================================================

  private createDescriptorInfo(
    type: DescriptorType,
    fingerprint: string,
    pathPart: string,
    xprv: string,
    changeIndex: number,
    basePath: string,
    range: [number, number],
    timestamp: number | 'now'
  ): DescriptorInfo {
    return {
      descriptor: this.createDescriptor(type, fingerprint, pathPart, xprv, changeIndex),
      type,
      path: `${basePath}/${changeIndex}/*`,
      internal: changeIndex === 1,
      active: true,
      range,
      timestamp,
    };
  }

  private getFingerprint(masterKey: HDKey): string {
    const pubkey = masterKey.publicKey;
    if (!pubkey) {
      throw new Error('Cannot get fingerprint: no public key');
    }
    const hash = ripemd160(sha256(pubkey));
    return bytesToHex(hash.slice(0, 4));
  }

  private serializeKey(key: HDKey, isPublic: boolean, isTestnet: boolean): string {
    const keyData = isPublic ? key.publicKey : key.privateKey;
    if (!keyData) {
      throw new Error('Key data not available');
    }

    const version = isTestnet
      ? isPublic
        ? VERSION_BYTES.testnet.tpub
        : VERSION_BYTES.testnet.tprv
      : isPublic
        ? VERSION_BYTES.mainnet.xpub
        : VERSION_BYTES.mainnet.xprv;

    // Build 78-byte serialized key using Uint8Array (browser-compatible)
    const buffer = new Uint8Array(78);
    const view = new DataView(buffer.buffer);

    // 4 bytes: version (big endian)
    view.setUint32(0, version, false);

    // 1 byte: depth
    buffer[4] = key.depth;

    // 4 bytes: parent fingerprint (big endian)
    view.setUint32(5, key.parentFingerprint, false);

    // 4 bytes: child index (big endian)
    view.setUint32(9, key.index, false);

    // 32 bytes: chain code
    if (key.chainCode) {
      buffer.set(key.chainCode, 13);
    }

    // 33 bytes: key data
    if (isPublic) {
      buffer.set(keyData, 45);
    } else {
      buffer[45] = 0; // Private key prefix
      buffer.set(keyData, 46);
    }

    return base58check(sha256).encode(buffer);
  }

  private createDescriptor(
    type: DescriptorType,
    fingerprint: string,
    pathPart: string,
    xprv: string,
    changeIndex: number
  ): string {
    const keyOrigin = `[${fingerprint}/${pathPart}]`;
    const keyWithPath = `${keyOrigin}${xprv}/${changeIndex}/*`;

    let desc: string;
    switch (type) {
      case 'pkh':
        desc = `pkh(${keyWithPath})`;
        break;
      case 'sh_wpkh':
        desc = `sh(wpkh(${keyWithPath}))`;
        break;
      case 'wpkh':
        desc = `wpkh(${keyWithPath})`;
        break;
      case 'tr':
        desc = `tr(${keyWithPath})`;
        break;
      default:
        throw new Error(`Unknown descriptor type: ${type}`);
    }

    const checksum = this.descriptorChecksum(desc);
    return `${desc}#${checksum}`;
  }

  private descriptorChecksum(desc: string): string {
    const INPUT_CHARSET =
      '0123456789()[]\',/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ ';

    let c = BigInt(1);
    let cls = 0;
    let clscount = 0;

    for (const ch of desc) {
      const pos = INPUT_CHARSET.indexOf(ch);
      if (pos === -1) {
        throw new Error(`Invalid character in descriptor: ${ch}`);
      }

      c = this.polymod(c, pos & 31);
      cls = cls * 3 + (pos >> 5);
      clscount++;

      if (clscount === 3) {
        c = this.polymod(c, cls);
        cls = 0;
        clscount = 0;
      }
    }

    if (clscount > 0) {
      c = this.polymod(c, cls);
    }

    for (let i = 0; i < 8; i++) {
      c = this.polymod(c, 0);
    }
    c ^= BigInt(1);

    let result = '';
    for (let i = 0; i < 8; i++) {
      result += CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - i))) & BigInt(31))];
    }

    return result;
  }

  private polymod(c: bigint, val: number): bigint {
    const c0 = c >> BigInt(35);
    c = ((c & BigInt(0x7ffffffff)) << BigInt(5)) ^ BigInt(val);

    if (c0 & BigInt(1)) c ^= BigInt(0xf5dee51989);
    if (c0 & BigInt(2)) c ^= BigInt(0xa9fdca3312);
    if (c0 & BigInt(4)) c ^= BigInt(0x1bab10e32d);
    if (c0 & BigInt(8)) c ^= BigInt(0x3706b1677a);
    if (c0 & BigInt(16)) c ^= BigInt(0x644d626ffd);

    return c;
  }
}
