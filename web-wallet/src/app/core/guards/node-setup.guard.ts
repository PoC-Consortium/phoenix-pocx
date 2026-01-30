import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { ElectronService } from '../services/electron.service';
import { NodeService } from '../../node';
import { AppModeService } from '../services/app-mode.service';

/**
 * NodeSetupGuard checks if node setup is required before allowing access to auth routes.
 * In desktop mode with managed node config but no node installed, redirects to /node/setup.
 * This guard should run BEFORE authGuard to ensure proper first-launch flow.
 * Skipped on mobile (Android) and mining-only mode (miner operates independently).
 */
export const nodeSetupGuard: CanActivateFn = async () => {
  const electronService = inject(ElectronService);
  const nodeService = inject(NodeService);
  const router = inject(Router);
  const appModeService = inject(AppModeService);

  // Skip on mobile - no local node support
  if (appModeService.isMobile()) {
    return true;
  }

  // Skip in mining-only mode - miner operates independently of node
  if (appModeService.isMiningOnly()) {
    return true;
  }

  // Only check in desktop mode
  if (!electronService.isDesktop) {
    return true;
  }

  try {
    // Initialize node service if not already done
    await nodeService.initialize();

    // If managed mode but node not installed, redirect to setup
    if (nodeService.isManaged() && !nodeService.isInstalled()) {
      console.log('[nodeSetupGuard] Node not installed in managed mode, redirecting to setup');
      return router.createUrlTree(['/node/setup']);
    }

    return true;
  } catch (error) {
    console.error('[nodeSetupGuard] Failed to check node status:', error);
    // On error, allow navigation to continue
    return true;
  }
};
