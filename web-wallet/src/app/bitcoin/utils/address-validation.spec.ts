import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { validatePocxAddress, POCX_NETWORKS } from './address-validation';

const mainnetZeroHash = new Uint8Array(20); // all-zero pubkey hash for tests
const segwitProgram = new Uint8Array(20); // witness-v0 20-byte program

function encodeBase58(version: number, hash: Uint8Array): string {
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.set(hash, 1);
  return base58check(sha256).encode(payload);
}

function encodeBech32(hrp: string, witnessVersion: number, program: Uint8Array): string {
  const encoder = witnessVersion === 0 ? bech32 : bech32m;
  const words = [witnessVersion, ...encoder.toWords(program)];
  return encoder.encode(hrp, words);
}

describe('validatePocxAddress', () => {
  it('returns empty for blank input', () => {
    expect(validatePocxAddress('').kind).toBe('empty');
    expect(validatePocxAddress('   ').kind).toBe('empty');
  });

  it('rejects garbage input', () => {
    // Either error kind is acceptable — garbage can look like a base58
    // checksum failure or a shape mismatch depending on which chars survive.
    const r = validatePocxAddress('not an address');
    expect(['invalid_format', 'invalid_checksum']).toContain(r.kind);
  });

  it('accepts a synthesized mainnet P2PKH address', () => {
    const addr = encodeBase58(POCX_NETWORKS.mainnet.p2pkh, mainnetZeroHash);
    const r = validatePocxAddress(addr);
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') {
      expect(r.network).toBe('mainnet');
      expect(r.type).toBe('P2PKH');
    }
  });

  it('accepts a synthesized testnet P2SH address', () => {
    const addr = encodeBase58(POCX_NETWORKS.testnet.p2sh, mainnetZeroHash);
    const r = validatePocxAddress(addr);
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') {
      expect(r.network).toBe('testnet');
      expect(r.type).toBe('P2SH');
    }
  });

  it('accepts a synthesized mainnet bech32 (segwit v0) address', () => {
    const addr = encodeBech32(POCX_NETWORKS.mainnet.hrp, 0, segwitProgram);
    const r = validatePocxAddress(addr);
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') {
      expect(r.network).toBe('mainnet');
      expect(r.type).toContain('Bech32');
    }
  });

  it('accepts a synthesized testnet bech32m (taproot v1) address', () => {
    const addr = encodeBech32(POCX_NETWORKS.testnet.hrp, 1, new Uint8Array(32));
    const r = validatePocxAddress(addr);
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') {
      expect(r.network).toBe('testnet');
      expect(r.type).toContain('Taproot');
    }
  });

  it('rejects a bech32 address with a tampered checksum', () => {
    const good = encodeBech32(POCX_NETWORKS.mainnet.hrp, 0, segwitProgram);
    // Flip the last char of the checksum to guarantee a mismatch
    const tampered = good.slice(0, -1) + (good.slice(-1) === 'q' ? 'p' : 'q');
    expect(validatePocxAddress(tampered).kind).toBe('invalid_checksum');
  });

  it('rejects a base58check address with a tampered checksum', () => {
    const good = encodeBase58(POCX_NETWORKS.mainnet.p2pkh, mainnetZeroHash);
    const tampered = good.slice(0, -1) + (good.slice(-1) === '1' ? '2' : '1');
    expect(validatePocxAddress(tampered).kind).toBe('invalid_checksum');
  });
});
