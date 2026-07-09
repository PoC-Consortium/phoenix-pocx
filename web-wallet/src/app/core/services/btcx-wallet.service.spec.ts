import { mapWalletTx, BtcxWalletTxDto, BTCX_COIN_TYPE } from './btcx-wallet.service';

describe('mapWalletTx', () => {
  it('maps the snake_case wire DTO to camelCase', () => {
    const dto: BtcxWalletTxDto = {
      txid: 'ab'.repeat(32),
      direction: 'sent',
      amount_sat: 10_000_000,
      fee_sat: 281,
      vsize: 141,
      confirmations: 3,
      timestamp: 1_752_000_000,
    };

    const tx = mapWalletTx(dto);
    expect(tx).toEqual({
      txid: 'ab'.repeat(32),
      direction: 'sent',
      amountSat: 10_000_000,
      feeSat: 281,
      vsize: 141,
      confirmations: 3,
      timestamp: 1_752_000_000,
    });
  });

  it('keeps null fee (receives) and null timestamp (unbroadcast)', () => {
    const dto: BtcxWalletTxDto = {
      txid: 'cd'.repeat(32),
      direction: 'received',
      amount_sat: 50_000_000,
      fee_sat: null,
      vsize: 222,
      confirmations: 0,
      timestamp: null,
    };

    const tx = mapWalletTx(dto);
    expect(tx.direction).toBe('received');
    expect(tx.feeSat).toBeNull();
    expect(tx.timestamp).toBeNull();
    expect(tx.confirmations).toBe(0);
  });

  it('normalizes unknown directions to received (net-in default)', () => {
    const dto: BtcxWalletTxDto = {
      txid: 'ef'.repeat(32),
      direction: 'other',
      amount_sat: 1,
      fee_sat: null,
      vsize: 110,
      confirmations: 1,
      timestamp: 1,
    };
    expect(mapWalletTx(dto).direction).toBe('received');
  });
});

describe('BTCX_COIN_TYPE', () => {
  it('is the "POCX" BIP32 coin type used by fresh wallets', () => {
    // 0x504F4358 spells "POCX" in ASCII
    expect(BTCX_COIN_TYPE).toBe(0x504f4358);
    const ascii = [0x50, 0x4f, 0x43, 0x58].map(c => String.fromCharCode(c)).join('');
    expect(ascii).toBe('POCX');
  });
});
