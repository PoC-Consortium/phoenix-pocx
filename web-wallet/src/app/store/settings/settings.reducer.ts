import { createReducer, on } from '@ngrx/store';
import { SettingsActions } from './settings.actions';
import {
  SettingsState,
  initialSettingsState,
  getDefaultRpcPort,
  defaultNodeConfig,
  defaultNotificationSettings,
} from './settings.state';

/**
 * Settings reducer
 */
export const settingsReducer = createReducer(
  initialSettingsState,

  // Load settings
  on(SettingsActions.loadSettingsSuccess, (state, { settings }): SettingsState => {
    // Deep merge for nested objects
    return {
      ...state,
      ...settings,
      nodeConfig: {
        ...state.nodeConfig,
        ...(settings.nodeConfig || {}),
      },
      notifications: {
        ...state.notifications,
        ...(settings.notifications || {}),
      },
    };
  }),

  // Node Configuration
  on(
    SettingsActions.updateNodeConfig,
    (state, { config }): SettingsState => ({
      ...state,
      nodeConfig: {
        ...state.nodeConfig,
        ...config,
      },
    })
  ),

  on(
    SettingsActions.setNodeConfig,
    (state, { config }): SettingsState => ({
      ...state,
      nodeConfig: config,
    })
  ),

  on(
    SettingsActions.setNetwork,
    (state, { network }): SettingsState => ({
      ...state,
      nodeConfig: {
        ...state.nodeConfig,
        network,
        rpcPort: getDefaultRpcPort(network),
      },
    })
  ),

  // Notification Settings
  on(
    SettingsActions.updateNotifications,
    (state, { notifications }): SettingsState => ({
      ...state,
      notifications: {
        ...state.notifications,
        ...notifications,
      },
    })
  ),

  on(
    SettingsActions.setNotifications,
    (state, { notifications }): SettingsState => ({
      ...state,
      notifications,
    })
  ),

  on(
    SettingsActions.toggleNotificationsEnabled,
    (state): SettingsState => ({
      ...state,
      notifications: {
        ...state.notifications,
        enabled: !state.notifications.enabled,
      },
    })
  ),

  // Display
  on(
    SettingsActions.setLanguage,
    (state, { language }): SettingsState => ({
      ...state,
      language,
    })
  ),

  // Preferences
  on(
    SettingsActions.setDefaultAddressType,
    (state, { addressType }): SettingsState => ({
      ...state,
      defaultAddressType: addressType,
    })
  ),

  on(
    SettingsActions.setConfirmationsRequired,
    (state, { confirmations }): SettingsState => ({
      ...state,
      confirmationsRequired: confirmations,
    })
  ),

  on(
    SettingsActions.setAutoRefreshInterval,
    (state, { interval }): SettingsState => ({
      ...state,
      autoRefreshInterval: interval,
    })
  ),

  // Privacy
  on(
    SettingsActions.toggleHideBalances,
    (state): SettingsState => ({
      ...state,
      hideBalances: !state.hideBalances,
    })
  ),

  on(
    SettingsActions.setHideBalances,
    (state, { hide }): SettingsState => ({
      ...state,
      hideBalances: hide,
    })
  ),

  // Advanced
  on(
    SettingsActions.toggleDebugMode,
    (state): SettingsState => ({
      ...state,
      debugMode: !state.debugMode,
    })
  ),

  on(
    SettingsActions.setCustomFeeRate,
    (state, { feeRate }): SettingsState => ({
      ...state,
      customFeeRate: feeRate,
    })
  ),

  // Reset
  on(
    SettingsActions.resetSettings,
    (): SettingsState => ({
      ...initialSettingsState,
      nodeConfig: { ...defaultNodeConfig },
      notifications: { ...defaultNotificationSettings },
    })
  )
);
