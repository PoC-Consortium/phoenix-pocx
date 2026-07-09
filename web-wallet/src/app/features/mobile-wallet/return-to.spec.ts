import { sanitizeReturnTo } from './return-to';

describe('sanitizeReturnTo', () => {
  it('accepts app-internal absolute paths', () => {
    expect(sanitizeReturnTo('/miner/setup')).toBe('/miner/setup');
    expect(sanitizeReturnTo('/miner/setup?step=1&fromWallet=1')).toBe(
      '/miner/setup?step=1&fromWallet=1'
    );
  });

  it('rejects empty and missing values', () => {
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo('')).toBeNull();
  });

  it('rejects anything that is not an internal absolute path', () => {
    expect(sanitizeReturnTo('https://evil.example')).toBeNull();
    expect(sanitizeReturnTo('//evil.example')).toBeNull();
    expect(sanitizeReturnTo('miner/setup')).toBeNull();
    expect(sanitizeReturnTo('javascript:alert(1)')).toBeNull();
  });
});
