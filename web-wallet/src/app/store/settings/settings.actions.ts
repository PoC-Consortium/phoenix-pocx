import { createActionGroup, emptyProps, props } from '@ngrx/store';
import {
  Network,
  LanguageCode,
  SettingsState,
  NodeConfig,
  NotificationSettings,
} from './settings.state';

/**
 * Settings actions
 */
export const SettingsActions = createActionGroup({
  source: 'Settings',
  events: {
    // Load/Save
    'Load Settings': emptyProps(),
    'Load Settings Success': props<{ settings: Partial<SettingsState> }>(),
    'Save Settings': emptyProps(),
    'Save Settings Success': emptyProps(),

    // Node Configuration
    'Update Node Config': props<{ config: Partial<NodeConfig> }>(),
    'Set Node Config': props<{ config: NodeConfig }>(),
    'Set Network': props<{ network: Network }>(),

    // Notification Settings
    'Update Notifications': props<{ notifications: Partial<NotificationSettings> }>(),
    'Set Notifications': props<{ notifications: NotificationSettings }>(),
    'Toggle Notifications Enabled': emptyProps(),

    // Display
    'Set Language': props<{ language: LanguageCode }>(),

    // Preferences
    'Set Default Address Type': props<{
      addressType: 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m';
    }>(),
    'Set Confirmations Required': props<{ confirmations: number }>(),
    'Set Auto Refresh Interval': props<{ interval: number }>(),

    // Privacy
    'Toggle Hide Balances': emptyProps(),
    'Set Hide Balances': props<{ hide: boolean }>(),

    // Advanced
    'Toggle Debug Mode': emptyProps(),
    'Set Custom Fee Rate': props<{ feeRate: number | null }>(),

    // Reset
    'Reset Settings': emptyProps(),
    'Reset All Data': emptyProps(),
  },
});
