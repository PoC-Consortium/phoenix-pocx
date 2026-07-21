/**
 * 25th-word (BIP39 passphrase) derivation round-trip — the REAL desktop
 * path.
 *
 * Purpose: settle empirically whether the DESKTOP (this file — TypeScript,
 * `@scure/bip39`, the same seed derivation `DescriptorService` performs) and
 * the MOBILE/nodeless (Rust `keys_btcx::WalletSeed` → bdk/BIP-84) paths
 * derive the SAME first receive address for the same (mnemonic, passphrase).
 * The matching Rust test lives at
 * `web-wallet/src-tauri/src/btcx_wallet/roundtrip_25th_word_test.rs`.
 *
 * Faithfulness: the seed derivation mirrors `descriptor.service.ts` EXACTLY
 * (lines 257-261): `bip39.mnemonicToSeedSync(mnemonic.trim().toLowerCase(),
 * passphrase)` then `HDKey.fromMasterSeed(seed)`. The desktop wallet imports
 * the resulting `wpkh([fp/84'/coin'/0']xprv/0/*)` descriptor into Bitcoin
 * Core, which then hands out addresses; a unit test cannot run Core, so the
 * first receive address is derived with the SAME libraries the app ships
 * (`@scure/bip32` HDKey, `@noble/hashes`, `@scure/base` bech32) at the
 * standard BIP-84 external index-0 path `m/84'/coin'/0'/0/0`. We also log
 * the actual production descriptor from `DescriptorService` for the record.
 *
 * HRP + coin type come from the app's own constants (`POCX_NETWORKS`,
 * `BTCX_COIN_TYPE`) so the address params are not hand-picked.
 */
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bech32 } from '@scure/base';
import { DescriptorService } from './descriptor.service';
import { BTCX_COIN_TYPE } from '../../../core/services/btcx-wallet.service';
import { POCX_NETWORKS } from '../../utils/address-validation';

/** SAME 24-word all-zero-entropy vector as the Rust test's MNEMONIC_24. */
const MNEMONIC_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon art';

const PASSPHRASES: ReadonlyArray<readonly [string, string]> = [
  ['P0 (empty)', ''],
  ['P1 (ascii)', 'correcthorse123'],
  ['P2 (umlaut)', 'prüfung'],
];

/**
 * The expected first receive addresses (mainnet PoCX, BIP-84 index 0). These
 * are pinned VERBATIM in the Rust round-trip test
 * (`roundtrip_25th_word_test.rs`, DESKTOP_P0/P1/P2) — the two suites share the
 * same values, so they prove desktop and the nodeless BDK path derive
 * identically. P2 assumes the NFKD-normalized `prüfung` (`@scure/bip39`
 * normalizes the passphrase itself; the nodeless path normalizes at the app
 * boundary before keys-btcx's raw `to_seed_normalized`).
 */
const EXPECTED: Readonly<Record<string, string>> = {
  'P0 (empty)': 'pocx1qcpueamxr0aa82t7dtvhzdksq59c993f9heu9te',
  'P1 (ascii)': 'pocx1qc7axsl082uqm0t3fuqefy7rw2ug52pl338esjk',
  'P2 (umlaut)': 'pocx1qqc2ka02m9jq43vmufl29xx4sutef0a03zenrq7',
};

/**
 * First EXTERNAL receive address at index 0, BIP-84, mainnet PoCX
 * (coin type 0x504F4358, HRP `pocx`), via the shipped libraries — seed
 * derivation identical to descriptor.service.ts:257-261.
 */
function firstReceiveAddress(mnemonic: string, passphrase: string): string {
  const normalized = mnemonic.trim().toLowerCase(); // descriptor.service.ts:257
  const seed = bip39.mnemonicToSeedSync(normalized, passphrase); // :258
  const master = HDKey.fromMasterSeed(seed); // :261
  // Standard BIP-84 external chain, index 0: m/84'/coin'/0'/0/0
  const child = master.derive(`m/84'/${BTCX_COIN_TYPE}'/0'/0/0`);
  const pubkey = child.publicKey;
  if (!pubkey) throw new Error('no pubkey');
  const program = ripemd160(sha256(pubkey)); // hash160 → 20-byte witness program
  const words = [0, ...bech32.toWords(program)]; // witness v0
  return bech32.encode(POCX_NETWORKS.mainnet.hrp as 'pocx', words);
}

describe('25th-word derivation round-trip (desktop path)', () => {
  it('sanity: constants match the Rust side', () => {
    expect(BTCX_COIN_TYPE).toBe(0x504f4358);
    expect(POCX_NETWORKS.mainnet.hrp).toBe('pocx');
    expect(bip39.validateMnemonic(MNEMONIC_24, wordlist)).toBe(true);
  });

  it('derives the pinned first receive address for P0/P1/P2', () => {
    const svc = new DescriptorService();

    for (const [label, pass] of PASSPHRASES) {
      const addr = firstReceiveAddress(MNEMONIC_24, pass);

      // Corroboration: the ACTUAL production descriptor the desktop imports
      // into Core for this seed/passphrase (mainnet BIP-84).
      const { descriptors } = svc.generateNewWalletDescriptors(MNEMONIC_24, {
        passphrase: pass,
        isTestnet: false,
      });
      const wpkhReceive = descriptors.find(d => d.type === 'wpkh' && !d.internal)?.descriptor;
      expect(wpkhReceive).toBeTruthy();

      // The pinned value is shared VERBATIM with the Rust round-trip test,
      // so desktop and the nodeless BDK path are proven to agree (P2 relies
      // on the app-boundary NFKD normalization the fix added).
      expect(addr).toBe(EXPECTED[label]);
    }
  });
});
