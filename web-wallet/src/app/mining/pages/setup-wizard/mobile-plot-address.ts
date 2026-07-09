import { BtcxSeedState } from '../../../core/services/btcx-wallet.service';

/**
 * Which plot-address radio the mining setup wizard should pre-select in
 * MOBILE mode, where the address can come from the nodeless BTCX wallet.
 *
 * Pure decision logic, factored out of the wizard so it is unit-testable.
 */

export type PlotAddressSelection = 'wallet' | 'custom';

export interface MobilePlotAddressContext {
  /** True when no mining config exists yet (fresh setup). */
  firstRun: boolean;
  /** The plotting address persisted in the mining config ('' if none). */
  configuredPlottingAddress: string;
  /** Seed lifecycle of the nodeless wallet. */
  seedState: BtcxSeedState;
  /** Whether the nodeless wallet runtime is open (can hand out addresses). */
  walletActive: boolean;
}

/**
 * Resolve the default plot-address selection for mobile mode.
 *
 * - A persisted plotting address ALWAYS wins ('custom', showing that exact
 *   address) — existing setups keep their flow untouched, and plots stay
 *   bound to the account id they were created for.
 * - Otherwise, on a fresh setup with a usable wallet, the wallet's own
 *   address is the suggested one-click path.
 * - Locked or missing wallets fall back to 'custom' until they become
 *   usable (the wizard offers inline unlock / create-wallet affordances).
 */
export function resolveMobilePlotAddressSelection(
  ctx: MobilePlotAddressContext
): PlotAddressSelection {
  if (ctx.configuredPlottingAddress) return 'custom';
  if (!ctx.firstRun) return 'custom';
  if (ctx.walletActive && ctx.seedState === 'unlocked') return 'wallet';
  return 'custom';
}
