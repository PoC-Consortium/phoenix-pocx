import { createFeatureSelector, createSelector } from '@ngrx/store';
import { SettingsState } from './settings.state';

/**
 * Feature selector
 */
export const selectSettingsState = createFeatureSelector<SettingsState>('settings');

// ============================================================
// Node Configuration
// ============================================================

export const selectNodeConfig = createSelector(selectSettingsState, state => state.nodeConfig);

export const selectNetwork = createSelector(selectNodeConfig, config => config.network);

export const selectCoinType = createSelector(selectNodeConfig, config => config.coinType);

export const selectRpcHost = createSelector(selectNodeConfig, config => config.rpcHost);

export const selectRpcPort = createSelector(selectNodeConfig, config => config.rpcPort);

export const selectDataDirectory = createSelector(selectNodeConfig, config => config.dataDirectory);

export const selectAuthMethod = createSelector(selectNodeConfig, config => config.authMethod);

export const selectIsTestnet = createSelector(selectNetwork, network => network === 'testnet');

export const selectIsMainnet = createSelector(selectNetwork, network => network === 'mainnet');

// ============================================================
// Notification Settings
// ============================================================

export const selectNotifications = createSelector(
  selectSettingsState,
  state => state.notifications
);

export const selectNotificationsEnabled = createSelector(
  selectNotifications,
  notifications => notifications.enabled
);

// ============================================================
// Display
// ============================================================

export const selectLanguage = createSelector(selectSettingsState, state => state.language);

// ============================================================
// Preferences
// ============================================================

export const selectDefaultAddressType = createSelector(
  selectSettingsState,
  state => state.defaultAddressType
);

export const selectConfirmationsRequired = createSelector(
  selectSettingsState,
  state => state.confirmationsRequired
);

export const selectAutoRefreshInterval = createSelector(
  selectSettingsState,
  state => state.autoRefreshInterval
);

// ============================================================
// Privacy
// ============================================================

export const selectHideBalances = createSelector(selectSettingsState, state => state.hideBalances);

// ============================================================
// Advanced
// ============================================================

export const selectDebugMode = createSelector(selectSettingsState, state => state.debugMode);

export const selectCustomFeeRate = createSelector(
  selectSettingsState,
  state => state.customFeeRate
);

export const selectHasCustomFeeRate = createSelector(
  selectCustomFeeRate,
  feeRate => feeRate !== null
);
