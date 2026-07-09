// Core Services
export { ElectronService } from './electron.service';
export { PlatformService } from './platform.service';
export type { Platform } from './platform.service';
export { AppModeService } from './app-mode.service';
export { BtcxWalletService, mapWalletTx, BTCX_COIN_TYPE } from './btcx-wallet.service';
export type {
  BtcxSeedState,
  BtcxNetwork,
  BtcxWalletStatus,
  BtcxBalance,
  BtcxWalletTx,
  BtcxWalletTxDto,
  BtcxFeeEstimates,
  BtcxDescriptorPolicy,
  BtcxWalletConfig,
  BtcxSendRequest,
  BtcxSyncEvent,
} from './btcx-wallet.service';
export { AppUpdateService } from './app-update.service';
export type { WalletUpdateInfo } from './app-update.service';
export {
  ClockDriftService,
  CLOCK_DRIFT_WARNING_MS,
  CLOCK_DRIFT_CRITICAL_MS,
} from './clock-drift.service';
export type { ClockDriftReport, ClockDriftStatus, NtpSample } from './clock-drift.service';
