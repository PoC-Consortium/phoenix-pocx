import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Network } from '../../store/settings/settings.state';

// PoCX chain parameters (see chainparams.cpp in PoC-Consortium/bitcoin).
export const POCX_NETWORKS: Record<Network, { hrp: string; p2pkh: number; p2sh: number }> = {
  mainnet: { hrp: 'pocx', p2pkh: 0x55, p2sh: 0x5a },
  testnet: { hrp: 'tpocx', p2pkh: 0x7f, p2sh: 0x84 },
  regtest: { hrp: 'rpocx', p2pkh: 0x6f, p2sh: 0xc4 },
};

export type AddressValidation =
  | { kind: 'empty' }
  | { kind: 'valid'; network: Network; type: string }
  | { kind: 'invalid_format' }
  | { kind: 'invalid_checksum' };

/**
 * Validate a PoCX address and identify which network + script type it belongs to.
 * Does not compare against the app's current network — callers do that after.
 */
export function validatePocxAddress(raw: string): AddressValidation {
  const addr = raw.trim();
  if (!addr) return { kind: 'empty' };
  const lower = addr.toLowerCase();

  // Bech32 / Bech32m path — HRP prefix uniquely identifies the network
  for (const [net, consts] of Object.entries(POCX_NETWORKS) as [
    Network,
    (typeof POCX_NETWORKS)[Network],
  ][]) {
    if (!lower.startsWith(consts.hrp + '1')) continue;
    // Witness version encoded as second char after the separator: 'q' = v0 (segwit), 'p' = v1 (taproot).
    const versionChar = lower[consts.hrp.length + 1];
    const isTaproot = versionChar === 'p';
    const isSegwit = versionChar === 'q';
    if (!isTaproot && !isSegwit) return { kind: 'invalid_format' };
    try {
      const decoder = isTaproot ? bech32m : bech32;
      const decoded = decoder.decode(lower as `${string}1${string}`);
      const witnessVersion = decoded.words[0];
      if (isTaproot && witnessVersion !== 1) return { kind: 'invalid_format' };
      if (isSegwit && witnessVersion !== 0) return { kind: 'invalid_format' };
      const type = isTaproot ? 'Bech32m (Taproot)' : 'Bech32 (SegWit)';
      return { kind: 'valid', network: net, type };
    } catch {
      return { kind: 'invalid_checksum' };
    }
  }

  // Base58Check path — version byte identifies network + script type
  let bytes: Uint8Array;
  try {
    bytes = base58check(sha256).decode(addr);
  } catch {
    return { kind: 'invalid_checksum' };
  }
  if (bytes.length !== 21) return { kind: 'invalid_format' };
  const version = bytes[0];
  for (const [net, consts] of Object.entries(POCX_NETWORKS) as [
    Network,
    (typeof POCX_NETWORKS)[Network],
  ][]) {
    if (version === consts.p2pkh) return { kind: 'valid', network: net, type: 'P2PKH' };
    if (version === consts.p2sh) return { kind: 'valid', network: net, type: 'P2SH' };
  }
  return { kind: 'invalid_format' };
}
