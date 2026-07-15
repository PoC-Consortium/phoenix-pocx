import { TestBed } from '@angular/core/testing';
import { DescriptorService } from './descriptor.service';
import { BTCX_COIN_TYPE } from '../../../core/services/btcx-wallet.service';
import { parseBranchFromDescriptor } from './wallet-manager.service';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('DescriptorService', () => {
  let service: DescriptorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DescriptorService);
  });

  describe('descriptorChecksum (BIP-380)', () => {
    it('computes the checksum for a plain descriptor with no special chars', () => {
      expect(service.calculateChecksum('raw(deadbeef)')).toBe('89f8spxm');
    });

    it("computes the checksum for a descriptor using ' hardening", () => {
      const desc =
        "pkh([d34db33f/44'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)";
      expect(service.calculateChecksum(desc)).toBe('ml40v0wf');
    });

    it('pins the checksum produced for the canonical test mnemonic (BIP84 receive, testnet coin 1)', () => {
      // Regression guard: the service emits descriptors using `h` hardening and
      // no commas, so this checksum must stay stable across refactors. If this
      // value changes, existing users would fail to re-import their wallets.
      // The coin type is passed explicitly: this pins the LEGACY testnet
      // branch (1') that pre-BTCX-coin-type wallets derived at.
      const { descriptors } = service.generateDescriptors(TEST_MNEMONIC, {
        isTestnet: true,
        coinType: 1,
        enableLegacy: false,
        enableNestedSegwit: false,
        enableNativeSegwit: true,
        enableTaproot: false,
      });

      const receive = descriptors.find(d => d.type === 'wpkh' && !d.internal);
      expect(receive).toBeTruthy();

      const checksum = receive!.descriptor.split('#')[1];
      expect(checksum).toBe('zpvtp3mt');
    });

    it('is deterministic and round-trips through addChecksum', () => {
      const raw =
        "pkh([d34db33f/44'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)";

      const withChecksum = service.addChecksum(raw);
      expect(withChecksum).toBe(`${raw}#${service.calculateChecksum(raw)}`);

      const stripped = withChecksum.split('#')[0];
      expect(service.calculateChecksum(stripped)).toBe(service.calculateChecksum(raw));

      // addChecksum is idempotent — passing an already-stamped descriptor returns it unchanged.
      expect(service.addChecksum(withChecksum)).toBe(withChecksum);
    });
  });

  describe('published derivation vectors (explicit coin type 0)', () => {
    it('reproduces the BIP-86 test vector account key and origin', () => {
      // BIP-86 test vector for the canonical mnemonic: master fingerprint
      // 73c5da0a, account xprv at m/86'/0'/0'. The published vectors only
      // exist for coin type 0 — hence the explicit coinType.
      const { fingerprint, descriptors } = service.generateDescriptors(TEST_MNEMONIC, {
        isTestnet: false,
        coinType: 0,
        enableLegacy: false,
        enableNestedSegwit: false,
        enableNativeSegwit: false,
        enableTaproot: true,
      });

      expect(fingerprint).toBe('73c5da0a');
      const receive = descriptors.find(d => d.type === 'tr' && !d.internal)!;
      expect(
        receive.descriptor.startsWith(
          'tr([73c5da0a/86h/0h/0h]xprv9xgqHN7yz9MwCkxsBPN5qetuNdQSUttZNKw1dcYTV4mkaAFiBVGQziHs3NRSWMkCzvgjEe3n9xV8oYywvM8at9yRqyaZVz6TYYhX98VjsUk/0/*)'
        )
      ).toBeTrue();
    });
  });

  describe('new wallet descriptor set (network coin type)', () => {
    it('generates only 84h and 86h branches at the network coin type', () => {
      // Coin type is network-aware (matches the Rust BDK backend's
      // WalletNetwork::asset_coin_type): the registered BTCX coin type on
      // mainnet, the shared SLIP-44 testnet coin type 1' on testnet/regtest.
      for (const isTestnet of [false, true]) {
        const expectedCoin = isTestnet ? 1 : BTCX_COIN_TYPE;
        const { descriptors } = service.generateNewWalletDescriptors(TEST_MNEMONIC, { isTestnet });
        expect(descriptors.length).toBe(4);
        expect(descriptors.map(d => d.type).sort()).toEqual(['tr', 'tr', 'wpkh', 'wpkh']);
        for (const d of descriptors) {
          expect(d.path).toMatch(new RegExp(`^m/8[46]'/${expectedCoin}'/0'/[01]/\\*$`));
          expect(d.descriptor).toContain(`/${expectedCoin}h/`);
        }
        // Exactly one receive + one change per purpose.
        expect(descriptors.filter(d => d.internal).length).toBe(2);
      }
    });

    it('uses the registered BTCX coin type 0x504F4358', () => {
      expect(BTCX_COIN_TYPE).toBe(1347371864);
    });
  });

  describe('legacy restore descriptor set (pre-BTCX-coin-type branches)', () => {
    it('mainnet: the full legacy purpose set at 0h only', () => {
      const { descriptors } = service.generateLegacyRestoreDescriptors(TEST_MNEMONIC, {
        isTestnet: false,
      });
      // 4 purposes × 2 keychains at 0h.
      expect(descriptors.length).toBe(8);
      const paths = descriptors.map(d => d.path);
      for (const purpose of [44, 49, 84, 86]) {
        expect(paths).toContain(`m/${purpose}'/0'/0'/0/*`);
        expect(paths).toContain(`m/${purpose}'/0'/0'/1/*`);
      }
      // No BTCX-coin-type branch sneaks into the legacy set.
      expect(paths.some(p => p.includes(`'/${BTCX_COIN_TYPE}'/`))).toBeFalse();
    });

    it('testnet: additionally the full legacy set at 1h', () => {
      const { descriptors } = service.generateLegacyRestoreDescriptors(TEST_MNEMONIC, {
        isTestnet: true,
      });
      expect(descriptors.length).toBe(16);
      const paths = descriptors.map(d => d.path);
      for (const purpose of [44, 49, 84, 86]) {
        expect(paths).toContain(`m/${purpose}'/0'/0'/0/*`);
        expect(paths).toContain(`m/${purpose}'/1'/0'/0/*`);
      }
    });

    it('mainnet legacy + BTCX sets together are unique and checksum-valid', () => {
      // On mainnet the legacy branches (coin 0') and the new-wallet branches
      // (BTCX coin type) are disjoint, so the combined set is fully unique.
      // (On testnet both sit at coin 1', so the new set is intentionally a
      // subset of the legacy set — see the network-coin-type test above.)
      const descriptors = [
        ...service.generateLegacyRestoreDescriptors(TEST_MNEMONIC, { isTestnet: false })
          .descriptors,
        ...service.generateNewWalletDescriptors(TEST_MNEMONIC, { isTestnet: false }).descriptors,
      ];
      const descs = descriptors.map(d => d.descriptor);
      expect(new Set(descs).size).toBe(descs.length);
      for (const desc of descs) {
        expect(service.validateChecksum(desc)).toBeTrue();
      }
    });
  });

  describe('multisig key derivation (BIP-48)', () => {
    it('derives new multisig keys at 48h/BTCXh/0h/2h by default', () => {
      const key = service.deriveMultisigKey(TEST_MNEMONIC, { isTestnet: false });
      expect(key.path).toBe(`m/48'/${BTCX_COIN_TYPE}'/0'/2'`);
      expect(
        key.keyExpression.startsWith(`[73c5da0a/48h/${BTCX_COIN_TYPE}h/0h/2h]xpub`)
      ).toBeTrue();
    });

    it('still derives legacy paths with an explicit coin type', () => {
      const key = service.deriveMultisigKey(TEST_MNEMONIC, { isTestnet: false, coinType: 0 });
      expect(key.path).toBe("m/48'/0'/0'/2'");
      expect(key.keyExpression.startsWith('[73c5da0a/48h/0h/0h/2h]xpub')).toBeTrue();
    });
  });
});

describe('parseBranchFromDescriptor', () => {
  it('folds descriptor key-origins into purpose/coin branches with compact labels', () => {
    // The h-hardened form the service emits...
    expect(parseBranchFromDescriptor('wpkh([73c5da0a/84h/0h/0h]xpub.../0/5)')).toEqual({
      purpose: 84,
      coinType: 0,
      label: "84'/0'",
    });
    // ...and the apostrophe form scantxoutset echoes back.
    expect(
      parseBranchFromDescriptor(`tr([73c5da0a/86'/${BTCX_COIN_TYPE}'/0']xpub.../1/0)#abcd1234`)
    ).toEqual({
      purpose: 86,
      coinType: BTCX_COIN_TYPE,
      label: "86'/BTCX",
    });
  });

  it('returns null for descriptors without a key origin', () => {
    expect(parseBranchFromDescriptor(undefined)).toBeNull();
    expect(parseBranchFromDescriptor('wpkh(xpub...)')).toBeNull();
    expect(parseBranchFromDescriptor('addr(bc1qxyz)')).toBeNull();
  });
});
