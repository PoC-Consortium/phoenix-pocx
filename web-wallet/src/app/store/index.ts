import { ActionReducerMap, MetaReducer } from '@ngrx/store';
import { WalletState, walletReducer, WalletEffects } from './wallet';
import { SettingsState, settingsReducer, SettingsEffects } from './settings';

/**
 * Root state interface
 */
export interface AppState {
  wallet: WalletState;
  settings: SettingsState;
}

/**
 * Root reducers
 */
export const reducers: ActionReducerMap<AppState> = {
  wallet: walletReducer,
  settings: settingsReducer,
};

/**
 * Meta reducers (for logging, etc.)
 */
export const metaReducers: MetaReducer<AppState>[] = [];

/**
 * All effects
 */
export const effects = [WalletEffects, SettingsEffects];

// Re-export everything
export * from './wallet';
export * from './settings';
