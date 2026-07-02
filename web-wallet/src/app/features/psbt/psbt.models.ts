/**
 * PSBT Feature Models
 *
 * View-model types for the PSBT page. Raw RPC shapes live in
 * wallet-rpc.service.ts (DecodedPsbt, PsbtAnalysis); these types are the
 * digested form the UI renders.
 */

/**
 * Lifecycle status of a PSBT document.
 * - unsigned: no signatures yet
 * - partial: some but not all required signatures
 * - ready: all signatures present, inputs not yet finalized
 * - finalized: all inputs final — raw hex can be extracted and broadcast
 */
export type PsbtStatus = 'unsigned' | 'partial' | 'ready' | 'finalized';

/** One transaction input, digested for display */
export interface PsbtInputView {
  index: number;
  txid: string;
  vout: number;
  address?: string;
  /** BTCX; undefined when the input UTXO is not embedded in the PSBT */
  amount?: number;
  scriptType?: string;
  /** Number of partial signatures collected */
  sigCount: number;
  /** Number of signatures still missing (from analyzepsbt) */
  missingSigs: number;
  isFinal: boolean;
  /** Input UTXO is known (witness_utxo or non_witness_utxo present) */
  hasUtxo: boolean;
}

export type PsbtOutputKind = 'external' | 'mine' | 'change' | 'data';

/** One transaction output, digested for display */
export interface PsbtOutputView {
  index: number;
  address?: string;
  amount: number;
  kind: PsbtOutputKind;
  /** OP_RETURN payload (data outputs only) — kept so compose can prefill it */
  dataHex?: string;
}

/**
 * Fully digested PSBT — everything the review screen renders.
 * Built by PsbtService.buildDocument() from decodepsbt + analyzepsbt.
 */
export interface PsbtDocument {
  base64: string;
  sizeBytes: number;
  /** txid of the unsigned transaction (changes when signatures are added only for legacy inputs) */
  unsignedTxid: string;
  status: PsbtStatus;
  /** Next role from analyzepsbt: updater | signer | finalizer | extractor */
  nextRole: string;
  inputs: PsbtInputView[];
  outputs: PsbtOutputView[];
  /** Count of inputs that are final or have at least one signature */
  signedInputs: number;
  /** BTCX; undefined when input UTXOs are unknown */
  fee?: number;
  /** sat/vB */
  feeRate?: number;
  vsize?: number;
  /** Sum of external (non-change) outputs in BTCX */
  sendingTotal: number;
  /** Sum of change outputs in BTCX */
  changeTotal: number;
  totalInput?: number;
  locktime: number;
}

/**
 * A PSBT draft persisted on this machine (localStorage) so multisig
 * coordination can span sessions.
 */
export interface PsbtDraft {
  id: string;
  name: string;
  network: string;
  psbt: string;
  /** Extracted raw hex once finalized */
  finalHex?: string;
  status: PsbtStatus;
  /** Short human summary for the draft list, e.g. "1.2500 BTCX" */
  amountLabel?: string;
  createdAt: number;
  updatedAt: number;
}

/** One recipient row in the compose form */
export interface ComposeOutput {
  address: string;
  amount: number | null;
}

/** Result of a fee sanity check before broadcast */
export interface FeeWarning {
  /** fee as percentage of sent value, e.g. 3.5 */
  feePercent: number;
  feeRate?: number;
}
