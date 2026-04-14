import { TestBed } from '@angular/core/testing';
import { DescriptorService } from './descriptor.service';

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

    it('pins the checksum produced for the canonical test mnemonic (BIP84 receive, testnet)', () => {
      // Regression guard: the service emits descriptors using `h` hardening and
      // no commas, so this checksum must stay stable across refactors. If this
      // value changes, existing users would fail to re-import their wallets.
      const { descriptors } = service.generateDescriptors(TEST_MNEMONIC, {
        isTestnet: true,
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
});
