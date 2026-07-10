import {
  dedupeWalletName,
  isInvalidWalletName,
  isWalletNameTaken,
  suggestSiblingWalletName,
  suggestWalletName,
} from './wallet-name';

describe('wallet-name helpers', () => {
  describe('isInvalidWalletName', () => {
    it('accepts the Rust-side charset and preserves case', () => {
      expect(isInvalidWalletName('MyWallet')).toBeFalse();
      expect(isInvalidWalletName('wallet_2-b')).toBeFalse();
    });

    it('treats an empty name as valid (the caller substitutes the suggestion)', () => {
      expect(isInvalidWalletName('')).toBeFalse();
      expect(isInvalidWalletName('   ')).toBeFalse();
    });

    it('rejects spaces, dots and over-long names (mirrors validate_wallet_name)', () => {
      expect(isInvalidWalletName('my wallet')).toBeTrue();
      expect(isInvalidWalletName('wallet.bak')).toBeTrue();
      expect(isInvalidWalletName('a'.repeat(33))).toBeTrue();
    });
  });

  describe('isWalletNameTaken', () => {
    it('matches case-insensitively (Windows/macOS directory semantics)', () => {
      expect(isWalletNameTaken('SAVINGS', ['savings'])).toBeTrue();
      expect(isWalletNameTaken('other', ['savings'])).toBeFalse();
    });
  });

  describe('suggestWalletName', () => {
    it("suggests 'default' for the first wallet (the backend's name-less flow)", () => {
      expect(suggestWalletName([])).toBe('default');
    });

    it('dedupes once wallets exist, case-insensitively', () => {
      expect(suggestWalletName(['Default'])).toBe('default-2');
      expect(suggestWalletName(['default', 'default-2'])).toBe('default-3');
    });
  });

  describe('dedupeWalletName', () => {
    it('keeps the 32-char cap while appending the counter', () => {
      const base = 'w'.repeat(32);
      expect(dedupeWalletName(base, [])).toHaveSize(32);
      const deduped = dedupeWalletName(base, [base]);
      expect(deduped).toHaveSize(32);
      expect(deduped.endsWith('-2')).toBeTrue();
    });
  });

  describe('suggestSiblingWalletName', () => {
    it('qualifies the base name by the other address family', () => {
      expect(suggestSiblingWalletName('Savings', 'bip86', ['Savings'])).toBe('Savings-taproot');
      expect(suggestSiblingWalletName('Savings', 'bip84', ['Savings'])).toBe('Savings-segwit');
    });

    it('dedupes against the registry and respects the 32-char cap', () => {
      expect(suggestSiblingWalletName('Savings', 'bip86', ['Savings', 'savings-taproot'])).toBe(
        'Savings-taproot-2'
      );
      const long = 'w'.repeat(32);
      const sibling = suggestSiblingWalletName(long, 'bip86', [long]);
      expect(sibling.length).toBeLessThanOrEqual(32);
      expect(sibling.endsWith('-taproot')).toBeTrue();
    });
  });
});
