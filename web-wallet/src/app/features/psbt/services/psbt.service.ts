import { Injectable, inject } from '@angular/core';
import { WalletRpcService } from '../../../bitcoin/services/rpc/wallet-rpc.service';
import type { DecodedPsbt, PsbtAnalysis } from '../../../bitcoin/services/rpc/wallet-rpc.service';
import { WalletManagerService } from '../../../bitcoin/services/wallet/wallet-manager.service';
import { NodeService } from '../../../node/services/node.service';
import { BtcxWalletService } from '../../../core/services/btcx-wallet.service';
import { downloadTextFile, downloadBinaryFile } from '../../../shared/utils/download';
import type {
  FeeWarning,
  PsbtDocument,
  PsbtDraft,
  PsbtInputView,
  PsbtOutputView,
  PsbtStatus,
} from '../psbt.models';

const DRAFTS_STORAGE_KEY = 'psbt_drafts_v1';

/** Binary .psbt files start with the magic bytes "psbt\xff" */
const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

/**
 * PsbtService digests raw PSBTs into view models and persists drafts.
 *
 * All heavy lifting is delegated to Bitcoin Core via decodepsbt/analyzepsbt —
 * this service only orchestrates the calls and classifies outputs
 * (external / mine / change) against the active wallet.
 */
@Injectable({ providedIn: 'root' })
export class PsbtService {
  private readonly walletRpc = inject(WalletRpcService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly nodeService = inject(NodeService);
  private readonly btcxWallet = inject(BtcxWalletService);

  // ============================================================
  // Document building
  // ============================================================

  /**
   * Decode and analyze a PSBT into the digested form the UI renders.
   * Output ownership is classified against the active wallet when one is
   * loaded; classification failures degrade to 'external'.
   *
   * Remote (Electrum) mode uses the client-side decode/analyze commands
   * instead of the node's decodepsbt/analyzepsbt.
   */
  async buildDocument(base64: string): Promise<PsbtDocument> {
    if (this.nodeService.isRemote()) {
      return this.buildDocumentRemote(base64.trim());
    }
    const psbt = base64.trim();
    const [decoded, analysis] = await Promise.all([
      this.walletRpc.decodePsbt(psbt),
      this.walletRpc.analyzePsbt(psbt),
    ]);

    const inputs = this.buildInputs(decoded, analysis);
    const outputs = await this.buildOutputs(decoded);

    const sendingTotal = outputs
      .filter(o => o.kind === 'external' || o.kind === 'mine')
      .reduce((sum, o) => sum + o.amount, 0);
    const changeTotal = outputs
      .filter(o => o.kind === 'change')
      .reduce((sum, o) => sum + o.amount, 0);

    const allUtxosKnown = inputs.every(i => i.hasUtxo);
    const totalInput = allUtxosKnown
      ? inputs.reduce((sum, i) => sum + (i.amount ?? 0), 0)
      : undefined;

    const fee = decoded.fee ?? analysis.fee;
    const vsize = analysis.estimated_vsize ?? decoded.tx.vsize;
    // No change output, yet the fee could have paid for one: the fee exceeds
    // a P2WSH dust change (330 sat, the highest dust bar among our output
    // types) plus min relay (0.1 sat/vB) for this size, so the leftover was
    // folded into the fee by the node's dust rule
    const changeAbsorbed =
      fee !== undefined &&
      vsize !== undefined &&
      outputs.length > 0 &&
      changeTotal === 0 &&
      fee * 1e8 > 330 + vsize * 0.1;
    // estimated_feerate is BTC/kvB → sat/vB
    let feeRate = analysis.estimated_feerate
      ? (analysis.estimated_feerate * 1e8) / 1000
      : undefined;
    if (feeRate === undefined && fee !== undefined && vsize) {
      feeRate = (fee * 1e8) / vsize;
    }

    return {
      base64: psbt,
      sizeBytes: this.base64ByteLength(psbt),
      unsignedTxid: decoded.tx.txid,
      status: this.deriveStatus(inputs, analysis),
      nextRole: analysis.next,
      inputs,
      outputs,
      satisfiedInputs: inputs.filter(i => i.satisfied).length,
      sigsCollected: inputs.filter(i => !i.isFinal).reduce((sum, i) => sum + i.sigCount, 0),
      sigsRequired: inputs.every(i => i.requiredSigs !== undefined)
        ? inputs.reduce((sum, i) => sum + (i.requiredSigs ?? 0), 0)
        : undefined,
      fee,
      feeRate,
      vsize,
      sendingTotal,
      changeTotal,
      changeAbsorbed,
      totalInput,
      locktime: decoded.tx.locktime,
    };
  }

  /**
   * Remote-mode document build over the client-side PSBT commands. Output
   * ownership is classified against the local wallet's known UTXO/receive
   * addresses where possible; unknown addresses degrade to 'external'
   * (change detection has no getaddressinfo analog here).
   */
  private async buildDocumentRemote(psbt: string): Promise<PsbtDocument> {
    const [decoded, analysis] = await Promise.all([
      this.btcxWallet.psbtDecode(psbt),
      this.btcxWallet.psbtAnalyze(psbt),
    ]);

    const analysisByIndex = new Map(analysis.inputs.map(i => [i.index, i]));
    const inputs: PsbtInputView[] = decoded.vin.map((vin, index) => {
      const psbtIn = decoded.inputs[index];
      const inAnalysis = analysisByIndex.get(index);
      const isFinal = inAnalysis?.isFinal ?? psbtIn?.isFinal ?? false;
      const hasUtxo =
        inAnalysis?.hasUtxo ?? (psbtIn?.hasWitnessUtxo || psbtIn?.hasNonWitnessUtxo) ?? false;
      const sigCount = psbtIn?.partialSigs ?? 0;
      return {
        index,
        txid: vin.txid,
        vout: vin.vout,
        address: psbtIn?.utxoAddress,
        amount: psbtIn?.utxoValueSat !== undefined ? psbtIn.utxoValueSat / 1e8 : undefined,
        scriptType: undefined,
        sigCount,
        missingSigs: isFinal || sigCount > 0 ? 0 : 1,
        // The local wallet is single-sig BIP-84; foreign inputs are unknown.
        requiredSigs: undefined,
        satisfied: isFinal || sigCount > 0,
        isFinal,
        hasUtxo,
      };
    });

    // Classify outputs against the wallet's own known addresses (UTXO set
    // — cheap cache read). Change stays 'external' when unknown.
    let ownAddresses = new Set<string>();
    try {
      const utxos = await this.btcxWallet.utxos();
      ownAddresses = new Set(utxos.map(u => u.address).filter((a): a is string => !!a));
    } catch {
      // Wallet closed — every non-data output classifies as external.
    }
    const outputs: PsbtOutputView[] = decoded.vout.map(vout => {
      if (vout.opReturn) {
        // script hex = 6a <pushlen> <data...>
        return {
          index: vout.n,
          amount: vout.valueSat / 1e8,
          kind: 'data',
          dataHex: vout.scriptHex.length > 4 ? vout.scriptHex.slice(4) : undefined,
        };
      }
      const kind: PsbtOutputView['kind'] =
        vout.address && ownAddresses.has(vout.address) ? 'mine' : 'external';
      return { index: vout.n, address: vout.address, amount: vout.valueSat / 1e8, kind };
    });

    const sendingTotal = outputs
      .filter(o => o.kind === 'external' || o.kind === 'mine')
      .reduce((sum, o) => sum + o.amount, 0);
    const changeTotal = outputs
      .filter(o => o.kind === 'change')
      .reduce((sum, o) => sum + o.amount, 0);
    const allUtxosKnown = inputs.every(i => i.hasUtxo);
    const totalInput = allUtxosKnown
      ? inputs.reduce((sum, i) => sum + (i.amount ?? 0), 0)
      : undefined;

    const fee = decoded.feeSat !== undefined ? decoded.feeSat / 1e8 : undefined;
    const vsize = analysis.estimatedVsize;
    let feeRate = analysis.estimatedFeeRateSatVb;
    if (feeRate === undefined && fee !== undefined && vsize) {
      feeRate = (fee * 1e8) / vsize;
    }

    const status: PsbtStatus =
      inputs.length > 0 && inputs.every(i => i.isFinal)
        ? 'finalized'
        : analysis.next === 'finalizer' || analysis.next === 'extractor'
          ? 'ready'
          : inputs.some(i => i.sigCount > 0 || i.isFinal)
            ? 'partial'
            : 'unsigned';

    return {
      base64: psbt,
      sizeBytes: this.base64ByteLength(psbt),
      unsignedTxid: decoded.txid,
      status,
      nextRole: analysis.next,
      inputs,
      outputs,
      satisfiedInputs: inputs.filter(i => i.satisfied).length,
      sigsCollected: inputs.filter(i => !i.isFinal).reduce((sum, i) => sum + i.sigCount, 0),
      sigsRequired: undefined,
      fee,
      feeRate,
      vsize,
      sendingTotal,
      changeTotal,
      changeAbsorbed: false,
      totalInput,
      locktime: decoded.locktime,
    };
  }

  private buildInputs(decoded: DecodedPsbt, analysis: PsbtAnalysis): PsbtInputView[] {
    return decoded.tx.vin.map((vin, index) => {
      const psbtIn = decoded.inputs[index] ?? {};
      const inAnalysis = analysis.inputs?.[index];
      const isFinal =
        inAnalysis?.is_final ??
        (psbtIn.final_scriptwitness !== undefined || psbtIn.final_scriptSig !== undefined);
      const hasUtxo =
        inAnalysis?.has_utxo ??
        (psbtIn.witness_utxo !== undefined || psbtIn.non_witness_utxo !== undefined);
      const sigCount = Object.keys(psbtIn.partial_signatures ?? {}).length;
      const missingSigs = inAnalysis?.missing?.signatures?.length ?? 0;
      // analyzepsbt can only enumerate missing signatures once it has the
      // UTXO and the full script; without them the requirement is unknown
      // (never assume "nothing missing" for a foreign or incomplete input).
      const missing = inAnalysis?.missing;
      const requirementKnown =
        !isFinal &&
        hasUtxo &&
        inAnalysis !== undefined &&
        missing?.witnessscript === undefined &&
        missing?.redeemscript === undefined &&
        (missing?.pubkeys?.length ?? 0) === 0;
      const requiredSigs = requirementKnown ? sigCount + missingSigs : undefined;
      return {
        index,
        txid: vin.txid,
        vout: vin.vout,
        address: psbtIn.witness_utxo?.scriptPubKey?.address,
        amount: psbtIn.witness_utxo?.amount,
        scriptType: psbtIn.witness_utxo?.scriptPubKey?.type,
        sigCount,
        missingSigs,
        requiredSigs,
        satisfied: isFinal || (requiredSigs !== undefined && missingSigs === 0 && sigCount > 0),
        isFinal,
        hasUtxo,
      };
    });
  }

  private async buildOutputs(decoded: DecodedPsbt): Promise<PsbtOutputView[]> {
    const walletName = this.walletManager.activeWallet;
    return Promise.all(
      decoded.tx.vout.map(async (vout, index): Promise<PsbtOutputView> => {
        const address = vout.scriptPubKey.address;
        if (vout.scriptPubKey.type === 'nulldata') {
          // asm reads "OP_RETURN <payload-hex>"
          const dataHex = vout.scriptPubKey.asm?.split(' ').slice(1).join('') || undefined;
          return { index, amount: vout.value, kind: 'data', dataHex };
        }
        let kind: PsbtOutputView['kind'] = 'external';
        if (address && walletName) {
          try {
            const info = await this.walletRpc.getAddressInfo(walletName, address);
            if (info.ismine) kind = info.ischange ? 'change' : 'mine';
          } catch {
            // Not classifiable (e.g. foreign network address) — treat as external
          }
        }
        return { index, address, amount: vout.value, kind };
      })
    );
  }

  private deriveStatus(inputs: PsbtInputView[], analysis: PsbtAnalysis): PsbtStatus {
    if (inputs.length > 0 && inputs.every(i => i.isFinal)) return 'finalized';
    if (analysis.next === 'finalizer' || analysis.next === 'extractor') return 'ready';
    if (inputs.some(i => i.sigCount > 0 || i.isFinal)) return 'partial';
    return 'unsigned';
  }

  /**
   * Fee sanity check before broadcast (issue #70 security notes).
   * Warns when the fee exceeds 1% of the sent value or 500 sat/vB.
   */
  checkFee(doc: PsbtDocument): FeeWarning | null {
    if (doc.fee === undefined || doc.sendingTotal <= 0) return null;
    const feePercent = (doc.fee / doc.sendingTotal) * 100;
    if (feePercent >= 1 || (doc.feeRate !== undefined && doc.feeRate >= 500)) {
      return { feePercent, feeRate: doc.feeRate };
    }
    return null;
  }

  // ============================================================
  // Draft persistence (localStorage, per network)
  // ============================================================

  listDrafts(network: string): PsbtDraft[] {
    return this.readDrafts()
      .filter(d => d.network === network)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getDraft(id: string): PsbtDraft | undefined {
    return this.readDrafts().find(d => d.id === id);
  }

  saveDraft(draft: PsbtDraft): void {
    const drafts = this.readDrafts().filter(d => d.id !== draft.id);
    drafts.push(draft);
    this.writeDrafts(drafts);
  }

  deleteDraft(id: string): void {
    this.writeDrafts(this.readDrafts().filter(d => d.id !== id));
  }

  createDraft(network: string, psbt: string, doc: PsbtDocument, name?: string): PsbtDraft {
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      name: name || `PSBT ${new Date(now).toLocaleDateString()}`,
      network,
      psbt,
      status: doc.status,
      amountLabel: `${doc.sendingTotal.toFixed(8)} BTCX`,
      walletName: this.walletManager.activeWallet ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
  }

  private readDrafts(): PsbtDraft[] {
    try {
      const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PsbtDraft[]) : [];
    } catch {
      return [];
    }
  }

  private writeDrafts(drafts: PsbtDraft[]): void {
    try {
      localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
    } catch {
      // Storage full/unavailable — drafts are a convenience, not critical
    }
  }

  // ============================================================
  // Encoding & file helpers
  // ============================================================

  /** Rough base64 → byte length (ignores padding subtleties by design) */
  base64ByteLength(base64: string): number {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
  }

  /** Quick shape check so we can fail fast before hitting the node */
  looksLikeBase64Psbt(text: string): boolean {
    const trimmed = text.trim();
    // "psbt\xff" base64-encodes to "cHNidP"
    return trimmed.startsWith('cHNidP') && /^[A-Za-z0-9+/=\s]+$/.test(trimmed);
  }

  /**
   * Read a user-supplied file into PSBT Base64.
   * Accepts binary .psbt files (magic "psbt\xff") and text files that
   * already contain Base64.
   */
  async readPsbtFile(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isBinary =
      bytes.length >= PSBT_MAGIC.length && PSBT_MAGIC.every((b, i) => bytes[i] === b);
    if (isBinary) {
      return this.bytesToBase64(bytes);
    }
    const text = new TextDecoder().decode(bytes).trim();
    if (this.looksLikeBase64Psbt(text)) {
      return text.replace(/\s+/g, '');
    }
    throw new Error('not_a_psbt_file');
  }

  /** Save the PSBT as a standard binary .psbt file (native dialog in Tauri). */
  async savePsbtFile(name: string, base64: string): Promise<void> {
    await downloadBinaryFile(`${name}.psbt`, this.base64ToBytes(base64));
  }

  /** Save the final raw transaction hex as a text file. */
  async saveHexFile(name: string, hex: string): Promise<void> {
    await downloadTextFile(`${name}.txn`, hex, 'text/plain');
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  private base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

}
