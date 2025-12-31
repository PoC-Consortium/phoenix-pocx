import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { WalletManagerService } from '../../bitcoin/services/wallet/wallet-manager.service';

/**
 * AuthGuard protects routes that require an active wallet.
 * Redirects to /auth if no wallet is loaded.
 */
export const authGuard: CanActivateFn = () => {
  const walletManager = inject(WalletManagerService);
  const router = inject(Router);

  if (walletManager.activeWallet) {
    return true;
  }

  // No active wallet, redirect to auth
  return router.createUrlTree(['/auth']);
};

/**
 * NoAuthGuard protects auth routes when user is already authenticated.
 * Redirects to /dashboard if a wallet is already active.
 */
export const noAuthGuard: CanActivateFn = () => {
  const walletManager = inject(WalletManagerService);
  const router = inject(Router);

  if (!walletManager.activeWallet) {
    return true;
  }

  // Already has active wallet, redirect to dashboard
  return router.createUrlTree(['/dashboard']);
};
