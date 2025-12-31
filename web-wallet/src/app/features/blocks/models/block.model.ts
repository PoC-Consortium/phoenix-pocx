/**
 * PoCX Proof data structure returned by Bitcoin-PoCX RPC
 */
export interface PocxProof {
  account_id: string;
  seed: string;
  nonce: number;
  quality: number;
  compression: number;
}

/**
 * Bitcoin-PoCX block structure as returned by getblock RPC with verbosity=2
 */
export interface PocxBlock {
  hash: string;
  confirmations: number;
  height: number;
  version: number;
  versionHex: string;
  merkleroot: string;
  time: number;
  mediantime: number;
  time_since_last_block: number;
  poc_time: number;
  base_target: number;
  generation_signature: string;
  pocx_proof: PocxProof;
  pubkey: string;
  signer_address: string;
  signature: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash?: string;
  nextblockhash?: string;
  strippedsize: number;
  size: number;
  weight: number;
  tx: PocxTransaction[] | string[];
}

/**
 * Bitcoin-PoCX transaction structure
 */
export interface PocxTransaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: TransactionInput[];
  vout: TransactionOutput[];
  fee?: number;
  hex?: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

export interface TransactionInput {
  txid?: string;
  vout?: number;
  coinbase?: string;
  txinwitness?: string[];
  scriptSig?: {
    asm: string;
    hex: string;
  };
  sequence: number;
  prevout?: {
    value: number;
    scriptPubKey: {
      address?: string;
      type: string;
    };
  };
}

export interface TransactionOutput {
  value: number;
  n: number;
  scriptPubKey: {
    asm: string;
    desc?: string;
    hex: string;
    address?: string;
    type: string;
  };
}

/**
 * Block count options for PoCX (~2 minute block time)
 */
export const BLOCK_COUNT_OPTIONS = [
  { label: '6h', value: 180 }, // 6 hours * 30 blocks/hour
  { label: '12h', value: 360 }, // 12 hours
  { label: '18h', value: 540 }, // 18 hours
  { label: '1d', value: 720 }, // 24 hours
];

/**
 * Display row for structured UI rendering
 */
export interface BlockDetailRow {
  key: string;
  label: string;
  value: string | number | null;
  type: 'text' | 'hash' | 'address' | 'date' | 'number' | 'link' | 'transactions';
  copyable?: boolean;
  link?: string;
}
