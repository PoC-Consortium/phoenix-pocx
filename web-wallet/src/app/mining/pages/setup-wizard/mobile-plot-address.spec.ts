import { resolveMobilePlotAddressSelection, MobilePlotAddressContext } from './mobile-plot-address';

describe('resolveMobilePlotAddressSelection', () => {
  const base: MobilePlotAddressContext = {
    firstRun: true,
    configuredPlottingAddress: '',
    seedState: 'unlocked',
    walletActive: true,
  };

  it('picks the wallet address on a fresh setup with a usable wallet (one-click path)', () => {
    expect(resolveMobilePlotAddressSelection(base)).toBe('wallet');
  });

  it('always keeps a persisted plotting address (existing setups untouched)', () => {
    expect(
      resolveMobilePlotAddressSelection({
        ...base,
        configuredPlottingAddress: 'pocx1qj0hnnyffma7tru28dlj92efhujs6y24llwv8jm',
      })
    ).toBe('custom');
    // Even when everything else points at the wallet
    expect(
      resolveMobilePlotAddressSelection({
        ...base,
        firstRun: false,
        configuredPlottingAddress: 'pocx1qj0hnnyffma7tru28dlj92efhujs6y24llwv8jm',
      })
    ).toBe('custom');
  });

  it('does not auto-switch a non-first-run setup without a persisted address', () => {
    expect(resolveMobilePlotAddressSelection({ ...base, firstRun: false })).toBe('custom');
  });

  it('falls back to custom while the wallet is locked', () => {
    expect(
      resolveMobilePlotAddressSelection({
        ...base,
        seedState: 'locked',
        walletActive: false,
      })
    ).toBe('custom');
  });

  it('falls back to custom when no seed exists yet', () => {
    expect(
      resolveMobilePlotAddressSelection({
        ...base,
        seedState: 'none',
        walletActive: false,
      })
    ).toBe('custom');
  });

  it('requires the runtime to be open, not just an unlocked seed', () => {
    expect(resolveMobilePlotAddressSelection({ ...base, walletActive: false })).toBe('custom');
  });
});
