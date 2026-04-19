import {
  detectDescriptorNetwork,
  detectEntryKind,
  validateDescriptorChecksum,
} from './descriptor-validation';
import { descriptorChecksum } from './descriptor-checksum';
import { base58check, bech32 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { POCX_NETWORKS } from './address-validation';

function withChecksum(body: string): string {
  return `${body}#${descriptorChecksum(body)}`;
}

function mainnetP2pkhAddress(): string {
  const payload = new Uint8Array(21);
  payload[0] = POCX_NETWORKS.mainnet.p2pkh;
  return base58check(sha256).encode(payload);
}

function mainnetBech32Address(): string {
  const program = new Uint8Array(20);
  const words = [0, ...bech32.toWords(program)];
  return bech32.encode(POCX_NETWORKS.mainnet.hrp, words);
}

describe('detectEntryKind', () => {
  it('returns unknown for blank input', () => {
    expect(detectEntryKind('')).toBe('unknown');
    expect(detectEntryKind('   ')).toBe('unknown');
  });

  it('recognizes descriptor function wrappers', () => {
    expect(detectEntryKind('wpkh(xpub6...)/0/*')).toBe('descriptor');
    expect(detectEntryKind(withChecksum('wpkh(xpub6aaaa/0/*)'))).toBe('descriptor');
    expect(detectEntryKind('tr(aaaa)')).toBe('descriptor');
    expect(detectEntryKind('sortedmulti(2,aaaa,bbbb)')).toBe('descriptor');
  });

  it('recognizes a valid PoCX address', () => {
    expect(detectEntryKind(mainnetP2pkhAddress())).toBe('address');
    expect(detectEntryKind(mainnetBech32Address())).toBe('address');
  });

  it('flags bare xpub-family strings', () => {
    // Prefix-shaped strings trigger bare_xpub even if not fully valid base58 keys
    expect(
      detectEntryKind('xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz')
    ).toBe('bare_xpub');
    expect(detectEntryKind('tpub1zzzzzzzz')).toBe('bare_xpub');
    expect(detectEntryKind('ypub1aaaaaaaa')).toBe('bare_xpub');
  });

  it('returns unknown for things that are neither', () => {
    expect(detectEntryKind('hello world')).toBe('unknown');
  });
});

describe('validateDescriptorChecksum', () => {
  it('accepts a freshly computed checksum', () => {
    const body = 'wpkh(0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798)';
    expect(validateDescriptorChecksum(withChecksum(body))).toBeTrue();
  });

  it('rejects when the #checksum suffix is missing', () => {
    expect(validateDescriptorChecksum('wpkh(xpub)')).toBeFalse();
  });

  it('rejects a wrong-length checksum', () => {
    expect(validateDescriptorChecksum('wpkh(xpub)#abc')).toBeFalse();
  });

  it('rejects a mismatched checksum', () => {
    const body = 'wpkh(0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798)';
    const withGood = withChecksum(body);
    // Flip the final char of the checksum
    const last = withGood.slice(-1);
    const flipped = withGood.slice(0, -1) + (last === 'q' ? 'p' : 'q');
    expect(validateDescriptorChecksum(flipped)).toBeFalse();
  });
});

describe('detectDescriptorNetwork', () => {
  it('extracts network from an addr(<mainnet>) descriptor', () => {
    const desc = withChecksum(`addr(${mainnetP2pkhAddress()})`);
    expect(detectDescriptorNetwork(desc)).toBe('mainnet');
  });

  it('returns mainnet when a mainnet xpub-family key is present', () => {
    expect(detectDescriptorNetwork('wpkh(xpub6CUGR/0/*)#aaaaaaaa')).toBe('mainnet');
    expect(detectDescriptorNetwork('sh(wpkh(ypub6aaaa))')).toBe('mainnet');
  });

  it('returns testnet when a tpub-family key is present', () => {
    expect(detectDescriptorNetwork('wpkh(tpub6CUGR/0/*)')).toBe('testnet');
    expect(detectDescriptorNetwork('wsh(vpub5aaaa)')).toBe('testnet');
  });

  it('returns null when the descriptor carries no network hint', () => {
    // combo() with a raw 33-byte hex pubkey has no network in the string itself
    const pubkeyHex = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    expect(detectDescriptorNetwork(`combo(${pubkeyHex})`)).toBeNull();
  });
});
