import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppModeService } from '../services/app-mode.service';

/**
 * MiningOnlyGuard allows access only when the app is in mining-only mode
 * or in mobile mode (which includes mining).
 * Used to protect the /miner routes. Wallet-only mode has no mining and
 * goes to the wallet instead.
 */
export const miningOnlyGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (appMode.isMiningOnly() || appMode.isMobileMode()) {
    return true;
  }

  if (appMode.isWalletOnly()) {
    return router.createUrlTree(['/wallet']);
  }

  // Redirect to normal auth flow if not in mining-only/mobile mode
  return router.createUrlTree(['/auth']);
};

/**
 * NotMiningOnlyGuard allows access only when the app is NOT in mining-only,
 * mobile, or wallet-only mode. Used to protect the Core-RPC-backed desktop
 * wallet routes from being accessed in those modes.
 */
export const notMiningOnlyGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (!appMode.isMiningOnly() && !appMode.isMobileMode() && !appMode.isWalletOnly()) {
    return true;
  }

  // Wallet-only mode has no miner; everything lands on the wallet
  if (appMode.isWalletOnly()) {
    return router.createUrlTree(['/wallet']);
  }

  // Redirect to miner route in mining-only/mobile mode
  return router.createUrlTree(['/miner']);
};

/**
 * NotWalletOnlyGuard blocks routes that do not exist in the wallet-only
 * flavor (e.g. node setup) — wallet-only launches land on the wallet.
 * Every other mode passes.
 */
export const notWalletOnlyGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (appMode.isWalletOnly()) {
    return router.createUrlTree(['/wallet']);
  }
  return true;
};
