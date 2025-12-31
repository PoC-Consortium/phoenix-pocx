// Wallet Services
export { DescriptorService } from './descriptor.service';
export type {
  DescriptorType,
  DescriptorInfo,
  WalletDescriptors,
  DescriptorOptions,
} from './descriptor.service';

export { WalletManagerService } from './wallet-manager.service';
export type {
  CreateWalletOptions,
  ImportWalletOptions,
  WalletSummary,
} from './wallet-manager.service';

export { WalletService } from './wallet.service';
export type { WalletState, SendOptions } from './wallet.service';
