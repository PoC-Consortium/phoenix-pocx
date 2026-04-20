import type { Network } from '../../store/settings/settings.state';
import { validatePocxAddress } from './address-validation';
import { descriptorChecksum } from './descriptor-checksum';

/**
 * What the user typed into the entry field.
 */
export type EntryKind = 'descriptor' | 'address' | 'bare_xpub' | 'unknown';

// Function names recognized as the outermost descriptor wrapper.
const DESCRIPTOR_FUNCTION_PREFIXES = [
  'wpkh',
  'wsh',
  'tr',
  'sh',
  'pkh',
  'addr',
  'combo',
  'multi',
  'sortedmulti',
  'raw',
  'rawtr',
];
const DESCRIPTOR_PREFIX_REGEX = new RegExp(`^(?:${DESCRIPTOR_FUNCTION_PREFIXES.join('|')})\\(`);

// BIP32 extended public key prefixes. Mainnet group uses x/y/z, testnet-family
// (testnet/signet/regtest share these) uses t/u/v. Case-sensitive: uppercase
// Y/Z/U/V are multisig variants.
const BARE_XPUB_REGEX =
  /^(?:xpub|ypub|zpub|Ypub|Zpub|tpub|upub|vpub|Upub|Vpub)[1-9A-HJ-NP-Za-km-z]+$/;

const MAINNET_XPUB_SCAN = /(?:xpub|ypub|zpub|Ypub|Zpub)[1-9A-HJ-NP-Za-km-z]+/;
const TESTNET_XPUB_SCAN = /(?:tpub|upub|vpub|Upub|Vpub)[1-9A-HJ-NP-Za-km-z]+/;
const ADDR_INNER_REGEX = /^addr\(([^)]+)\)/;

/**
 * Classify the user's input. Callers decide whether to treat each kind as
 * acceptable.
 */
export function detectEntryKind(raw: string): EntryKind {
  const trimmed = raw.trim();
  if (!trimmed) return 'unknown';

  // Strip descriptor checksum suffix before testing the body shape
  const body = trimmed.includes('#') ? trimmed.slice(0, trimmed.lastIndexOf('#')) : trimmed;

  if (DESCRIPTOR_PREFIX_REGEX.test(body)) return 'descriptor';
  if (BARE_XPUB_REGEX.test(body)) return 'bare_xpub';
  if (validatePocxAddress(body).kind === 'valid') return 'address';
  return 'unknown';
}

/**
 * Returns true if the descriptor's trailing `#checksum` matches a freshly
 * computed checksum of its body. Returns false for missing/malformed
 * checksums or when the body contains characters outside the BIP-380 input
 * charset.
 */
export function validateDescriptorChecksum(descWithChecksum: string): boolean {
  const hashIdx = descWithChecksum.lastIndexOf('#');
  if (hashIdx === -1) return false;
  const body = descWithChecksum.slice(0, hashIdx);
  const given = descWithChecksum.slice(hashIdx + 1);
  if (given.length !== 8) return false;
  try {
    return descriptorChecksum(body) === given;
  } catch {
    return false;
  }
}

/**
 * Best-effort network detection for a descriptor. Looks for:
 *   - an `addr(<a>)` wrapper and validates the inner address
 *   - xpub-family prefixes in the body (mainnet)
 *   - tpub-family prefixes in the body (testnet/signet/regtest)
 *
 * Returns null when the descriptor contains only raw public keys or anything
 * else the function can't attribute to a specific chain — callers should
 * then defer to the commit-time RPC rather than rejecting up front.
 */
export function detectDescriptorNetwork(desc: string): Network | null {
  const body = desc.includes('#') ? desc.slice(0, desc.lastIndexOf('#')) : desc;

  const addrMatch = body.match(ADDR_INNER_REGEX);
  if (addrMatch) {
    const inner = validatePocxAddress(addrMatch[1]);
    return inner.kind === 'valid' ? inner.network : null;
  }

  if (MAINNET_XPUB_SCAN.test(body)) return 'mainnet';
  if (TESTNET_XPUB_SCAN.test(body)) {
    // Bitcoin Core collapses testnet/signet/regtest into a single set of xpub
    // prefixes, so we cannot tell them apart from the string alone. Return
    // 'testnet' as the closest match; commit-time RPC will reject a regtest
    // wallet receiving a signet-only descriptor, which is acceptable since
    // the three share the same prefixes anyway.
    return 'testnet';
  }

  return null;
}
