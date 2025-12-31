/**
 * Network type
 */
export type Network = 'mainnet' | 'testnet' | 'regtest';

/**
 * Theme
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * Language code
 */
export type LanguageCode = 'en' | 'de' | 'es' | 'fr' | 'zh' | 'ja' | 'ko';

/**
 * Coin type for node configuration
 */
export type CoinType = 'bitcoin-pocx' | 'bitcoin-og' | 'custom';

/**
 * Authentication method for RPC
 */
export type AuthMethod = 'cookie' | 'credentials';

/**
 * Node configuration settings
 */
export interface NodeConfig {
  coinType: CoinType;
  network: Network;
  currencySymbol: string;
  rpcHost: string;
  rpcPort: number;
  dataDirectory: string;
  testnetSubdir: string;
  authMethod: AuthMethod;
  username: string;
  password: string;
}

/**
 * Notification settings
 */
export interface NotificationSettings {
  enabled: boolean;
  // Transaction notifications
  incomingPayment: boolean;
  paymentConfirmed: boolean;
  blockMined: boolean;
  blockRewardMatured: boolean;
  // Wallet status notifications
  nodeConnected: boolean;
  nodeDisconnected: boolean;
  syncComplete: boolean;
}

/**
 * Settings state
 */
export interface SettingsState {
  // Node configuration
  nodeConfig: NodeConfig;

  // Notification settings
  notifications: NotificationSettings;

  // Display
  language: LanguageCode;

  // Preferences
  defaultAddressType: 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m';
  confirmationsRequired: number;
  autoRefreshInterval: number; // in milliseconds, 0 = disabled

  // Privacy
  hideBalances: boolean;

  // Advanced
  debugMode: boolean;
  customFeeRate: number | null;
}

/**
 * Default node configuration
 */
export const defaultNodeConfig: NodeConfig = {
  coinType: 'bitcoin-pocx',
  network: 'testnet',
  currencySymbol: 'BTCX',
  rpcHost: '127.0.0.1',
  rpcPort: 18332,
  dataDirectory: '',
  testnetSubdir: 'testnet',
  authMethod: 'cookie',
  username: '',
  password: '',
};

/**
 * Default notification settings
 */
export const defaultNotificationSettings: NotificationSettings = {
  enabled: true,
  incomingPayment: true,
  paymentConfirmed: true,
  blockMined: true,
  blockRewardMatured: true,
  nodeConnected: false,
  nodeDisconnected: true,
  syncComplete: true,
};

/**
 * Initial settings state
 */
export const initialSettingsState: SettingsState = {
  nodeConfig: { ...defaultNodeConfig },
  notifications: { ...defaultNotificationSettings },

  language: 'en',

  defaultAddressType: 'bech32',
  confirmationsRequired: 6,
  autoRefreshInterval: 30000,

  hideBalances: false,

  debugMode: false,
  customFeeRate: null,
};

/**
 * Get default RPC port for network
 */
export function getDefaultRpcPort(network: Network): number {
  switch (network) {
    case 'mainnet':
      return 8332;
    case 'testnet':
      return 18332;
    case 'regtest':
      return 18443;
    default:
      return 18332;
  }
}

/**
 * Get default currency symbol for coin type
 */
export function getDefaultCurrencySymbol(coinType: CoinType): string {
  switch (coinType) {
    case 'bitcoin-pocx':
      return 'BTCX';
    case 'bitcoin-og':
      return 'BTC';
    case 'custom':
      return 'BTC';
    default:
      return 'BTCX';
  }
}

/**
 * Get default testnet subdirectory for coin type
 */
export function getDefaultTestnetSubdir(coinType: CoinType): string {
  switch (coinType) {
    case 'bitcoin-pocx':
      return 'testnet';
    case 'bitcoin-og':
      return 'testnet3';
    case 'custom':
      return 'testnet';
    default:
      return 'testnet';
  }
}

/**
 * Get default data directory based on platform and coin type
 */
export function getDefaultDataDirectory(coinType: CoinType, platform: string): string {
  const coinFolder = coinType === 'bitcoin-og' ? 'Bitcoin' : 'Bitcoin-PoCX';

  switch (platform) {
    case 'win32':
      return `%LOCALAPPDATA%\\${coinFolder}`;
    case 'darwin':
      return `~/Library/Application Support/${coinFolder}`;
    case 'linux':
    default:
      return `~/.${coinFolder.toLowerCase()}`;
  }
}
