import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { ElectronService } from '../services/electron.service';
import { AppModeService } from '../services/app-mode.service';
import type { NodeMode } from '../../node/models/node.models';

/**
 * NodeSetupGuard directs the user to the node-setup wizard when the app is
 * not ready for the wallet selector.
 *
 * Two gates, both driven by filesystem facts exposed via Tauri commands:
 *  1. `node_config.json` missing → user has never completed setup → step 0.
 *  2. Config exists, mode=managed, bitcoind binary missing → jump to the
 *     download step with `?repair=true` (back button still reaches step 0).
 *
 * Reading persisted state instead of NodeService signals avoids the
 * initialization race where default signal values (mode=managed, installed=false)
 * spuriously trigger a redirect.
 *
 * Skipped on mobile (no local node) and mining-only mode (miner is independent).
 */
export const nodeSetupGuard: CanActivateFn = async () => {
  const electronService = inject(ElectronService);
  const router = inject(Router);
  const appModeService = inject(AppModeService);

  if (appModeService.isMobile() || appModeService.isMiningOnly() || !electronService.isDesktop) {
    return true;
  }

  try {
    const configExists = await invoke<boolean>('is_first_launch_complete');
    if (!configExists) {
      return router.createUrlTree(['/node/setup']);
    }

    const mode = await invoke<NodeMode>('get_node_mode');
    if (mode === 'managed') {
      const installed = await invoke<boolean>('is_node_installed');
      if (!installed) {
        return router.createUrlTree(['/node/setup'], { queryParams: { repair: 'true' } });
      }
    }

    return true;
  } catch (error) {
    console.error('[nodeSetupGuard] Failed to check setup state:', error);
    // On IPC failure, let the user through to wallet-select; its connection
    // error state can guide them to recovery.
    return true;
  }
};
