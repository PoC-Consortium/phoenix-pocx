/**
 * Send prepare/commit through the backend seam (issue #222).
 *
 * The Send page confirms the transaction the backend BUILT, not a page-side
 * estimate, and "subtract fee from amount" must mean the same thing on both
 * backends: fee out of the recipient output, typed amount leaves the wallet,
 * change kept — never a wallet sweep. These tests pin the RPC/command
 * parameters each backend sends and the decoded shape it hands back.
 */
import { CoreWalletBackend } from './core-wallet-backend';
import { ElectrumWalletBackend } from './electrum-wallet-backend';

const ADDRESS = 'pocx1qrpfaucy9zgwph7hn5vkz99uyl0nduqmz5hxpf6';
const CHANGE = 'pocx1qmzc4j59m3y6gl5ym9cdnysldjxful34r7gd8fg';

describe('CoreWalletBackend prepareSend / commitSend', () => {
  let walletRpc: jasmine.SpyObj<{
    walletCreateFundedPsbt: (...args: unknown[]) => Promise<unknown>;
    decodePsbt: (psbt: string) => Promise<unknown>;
    analyzePsbt: (psbt: string) => Promise<unknown>;
    walletProcessPsbt: (...args: unknown[]) => Promise<unknown>;
    finalizePsbt: (...args: unknown[]) => Promise<unknown>;
  }>;
  let blockchainRpc: jasmine.SpyObj<{
    getBlockCount: () => Promise<number>;
    sendRawTransaction: (hex: string) => Promise<string>;
  }>;
  let backend: CoreWalletBackend;

  const decoded = {
    tx: {
      txid: 'unsigned',
      vin: [{ txid: 'aa'.repeat(32), vout: 1, sequence: 0xfffffffd }],
      vout: [
        { value: 0.00000059, n: 0, scriptPubKey: { address: ADDRESS } },
        { value: 0.4, n: 1, scriptPubKey: { address: CHANGE } },
      ],
    },
    fee: 0.00000141,
    inputs: [{ witness_utxo: { amount: 0.400002, scriptPubKey: { address: CHANGE } } }],
  };

  beforeEach(() => {
    walletRpc = jasmine.createSpyObj('WalletRpcService', [
      'walletCreateFundedPsbt',
      'decodePsbt',
      'analyzePsbt',
      'walletProcessPsbt',
      'finalizePsbt',
    ]);
    blockchainRpc = jasmine.createSpyObj('BlockchainRpcService', [
      'getBlockCount',
      'sendRawTransaction',
    ]);
    blockchainRpc.getBlockCount.and.resolveTo(135300);
    walletRpc.walletCreateFundedPsbt.and.resolveTo({
      psbt: 'cHNidP8=',
      fee: 0.00000141,
      changepos: 1,
    });
    walletRpc.decodePsbt.and.resolveTo(decoded);
    walletRpc.analyzePsbt.and.resolveTo({
      next: 'signer',
      estimated_vsize: 141,
      estimated_feerate: 0.00001, // BTC/kvB → 1 sat/vB
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    backend = new CoreWalletBackend(walletRpc as any, blockchainRpc as any);
  });

  it('subtract-fee builds with subtractFeeFromOutputs [0], an explicit fee_rate and the tip locktime', async () => {
    await backend.prepareSend('w', ADDRESS, 0.000002, {
      subtractFeeFromAmount: true,
      replaceable: true,
      feeRate: 1,
      confTarget: 6,
    });
    expect(walletRpc.walletCreateFundedPsbt).toHaveBeenCalledWith(
      'w',
      [],
      [{ [ADDRESS]: 0.000002 }],
      135300,
      {
        add_inputs: true,
        replaceable: true,
        subtractFeeFromOutputs: [0],
        fee_rate: 1,
      }
    );
  });

  it('fee on top uses conf_target when no fee_rate is given and never sends both', async () => {
    await backend.prepareSend('w', ADDRESS, 0.000002, { confTarget: 144 });
    const options = walletRpc.walletCreateFundedPsbt.calls.mostRecent().args[4] as Record<
      string,
      unknown
    >;
    expect(options['conf_target']).toBe(144);
    expect(options['fee_rate']).toBeUndefined();
    expect(options['subtractFeeFromOutputs']).toBeUndefined();
  });

  it('reports the DECODED transaction: recipient output, change by changepos, fee and rate', async () => {
    const prepared = await backend.prepareSend('w', ADDRESS, 0.000002, {
      subtractFeeFromAmount: true,
      feeRate: 1,
    });
    expect(prepared.psbt).toBe('cHNidP8=');
    expect(prepared.recipientAddress).toBe(ADDRESS);
    expect(prepared.recipientAmount).toBe(0.00000059);
    expect(prepared.fee).toBe(0.00000141);
    expect(prepared.change).toBe(0.4);
    expect(prepared.outputs.map(o => o.isChange)).toEqual([false, true]);
    expect(prepared.inputs.length).toBe(1);
    expect(prepared.inputs[0].amount).toBe(0.400002);
    expect(prepared.vsize).toBe(141);
    expect(prepared.feeRateSatVb).toBeCloseTo(1, 6);
    expect(prepared.totalDebit).toBeCloseTo(0.000002, 10);
  });

  it('commitSend signs, finalizes and broadcasts exactly the prepared PSBT', async () => {
    walletRpc.walletProcessPsbt.and.resolveTo({ psbt: 'signed', complete: true });
    walletRpc.finalizePsbt.and.resolveTo({ complete: true, hex: '0200...' });
    blockchainRpc.sendRawTransaction.and.resolveTo('txid');
    const prepared = await backend.prepareSend('w', ADDRESS, 0.000002, { feeRate: 1 });
    expect(await backend.commitSend('w', prepared)).toBe('txid');
    expect(walletRpc.walletProcessPsbt).toHaveBeenCalledWith('w', 'cHNidP8=');
    expect(walletRpc.finalizePsbt).toHaveBeenCalledWith('signed');
    expect(blockchainRpc.sendRawTransaction).toHaveBeenCalledWith('0200...');
  });

  it('commitSend refuses to broadcast a partially signed transaction', async () => {
    walletRpc.walletProcessPsbt.and.resolveTo({ psbt: 'half', complete: false });
    const prepared = await backend.prepareSend('w', ADDRESS, 0.000002, { feeRate: 1 });
    await expectAsync(backend.commitSend('w', prepared)).toBeRejected();
    expect(blockchainRpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe('ElectrumWalletBackend prepareSend / commitSend', () => {
  let btcxWallet: jasmine.SpyObj<{
    createFundedPsbt: (...args: unknown[]) => Promise<string>;
    psbtDecode: (psbt: string) => Promise<unknown>;
    psbtAnalyze: (psbt: string) => Promise<unknown>;
    psbtProcess: (psbt: string) => Promise<unknown>;
    psbtFinalize: (psbt: string) => Promise<unknown>;
    commitTx: (hex: string) => Promise<string>;
  }>;
  let backend: ElectrumWalletBackend;

  beforeEach(() => {
    btcxWallet = jasmine.createSpyObj('BtcxWalletService', [
      'createFundedPsbt',
      'psbtDecode',
      'psbtAnalyze',
      'psbtProcess',
      'psbtFinalize',
      'commitTx',
    ]);
    btcxWallet.createFundedPsbt.and.resolveTo('cHNidP8=');
    btcxWallet.psbtDecode.and.resolveTo({
      txid: 'unsigned',
      vin: [{ txid: 'bb'.repeat(32), vout: 0, sequence: 0xfffffffd }],
      vout: [
        { n: 0, valueSat: 59, address: ADDRESS, opReturn: false, isMine: false, isChange: false },
        {
          n: 1,
          valueSat: 40_000_000,
          address: CHANGE,
          opReturn: false,
          isMine: true,
          isChange: true,
        },
      ],
      inputs: [{ index: 0, utxoValueSat: 40_000_200, utxoAddress: CHANGE }],
      feeSat: 141,
      complete: false,
    });
    btcxWallet.psbtAnalyze.and.resolveTo({
      next: 'signer',
      feeSat: 141,
      estimatedVsize: 141,
      estimatedFeeRateSatVb: 1,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    backend = new ElectrumWalletBackend(btcxWallet as any);
  });

  it('subtract-fee composes with subtractFeeOutput 0 and the typed amount — never a sweep', async () => {
    await backend.prepareSend('ignored', ADDRESS, 0.000002, {
      subtractFeeFromAmount: true,
      feeRate: 1,
    });
    expect(btcxWallet.createFundedPsbt).toHaveBeenCalledWith(
      [{ address: ADDRESS, amountSat: 200 }],
      1,
      { subtractFeeOutput: 0 }
    );
  });

  it('fee on top composes without a subtract option', async () => {
    await backend.prepareSend('ignored', ADDRESS, 0.000002, { feeRate: 1 });
    expect(btcxWallet.createFundedPsbt).toHaveBeenCalledWith(
      [{ address: ADDRESS, amountSat: 200 }],
      1,
      undefined
    );
  });

  it('reports the DECODED transaction with change stamped by the wallet', async () => {
    const prepared = await backend.prepareSend('ignored', ADDRESS, 0.000002, {
      subtractFeeFromAmount: true,
      feeRate: 1,
    });
    expect(prepared.recipientAmount).toBeCloseTo(0.00000059, 10);
    expect(prepared.fee).toBeCloseTo(0.00000141, 10);
    expect(prepared.change).toBeCloseTo(0.4, 10);
    expect(prepared.outputs.map(o => o.isChange)).toEqual([false, true]);
    expect(prepared.inputs[0].amount).toBeCloseTo(0.400002, 10);
    expect(prepared.vsize).toBe(141);
    expect(prepared.feeRateSatVb).toBe(1);
    expect(prepared.totalDebit).toBeCloseTo(0.000002, 10);
  });

  it('commitSend signs then commits through the open wallet', async () => {
    btcxWallet.psbtProcess.and.resolveTo({ psbt: 'signed', hex: '0200...', complete: true });
    btcxWallet.commitTx.and.resolveTo('txid');
    const prepared = await backend.prepareSend('ignored', ADDRESS, 0.000002, { feeRate: 1 });
    expect(await backend.commitSend('ignored', prepared)).toBe('txid');
    expect(btcxWallet.psbtProcess).toHaveBeenCalledWith('cHNidP8=');
    expect(btcxWallet.psbtFinalize).not.toHaveBeenCalled();
    expect(btcxWallet.commitTx).toHaveBeenCalledWith('0200...');
  });

  it('commitSend finalizes when signing alone did not complete, and refuses if still open', async () => {
    btcxWallet.psbtProcess.and.resolveTo({ psbt: 'signed', complete: false });
    btcxWallet.psbtFinalize.and.resolveTo({ psbt: 'signed', complete: false });
    const prepared = await backend.prepareSend('ignored', ADDRESS, 0.000002, { feeRate: 1 });
    await expectAsync(backend.commitSend('ignored', prepared)).toBeRejected();
    expect(btcxWallet.psbtFinalize).toHaveBeenCalledWith('signed');
    expect(btcxWallet.commitTx).not.toHaveBeenCalled();
  });
});
