// RPC Services - Split architecture for Bitcoin Core communication
export { RpcClientService } from './rpc-client.service';
export type { RpcRequest, RpcResponse, RpcError, ConnectionStatus } from './rpc-client.service';

export { BlockchainRpcService } from './blockchain-rpc.service';
export type {
  BlockchainInfo,
  BlockHeader,
  Block,
  Transaction,
  TransactionInput,
  TransactionOutput,
  NetworkInfo,
  MempoolInfo,
} from './blockchain-rpc.service';

export { WalletRpcService } from './wallet-rpc.service';
export type {
  WalletInfo,
  WalletBalance,
  AddressInfo,
  WalletTransaction,
  UTXO,
  ImportDescriptor,
  ImportResult,
} from './wallet-rpc.service';

export { MiningRpcService } from './mining-rpc.service';
export type {
  MiningInfo,
  BlockTemplate,
  PocxAssignment,
  PocxMiningStatus,
  PlotInfo,
} from './mining-rpc.service';
