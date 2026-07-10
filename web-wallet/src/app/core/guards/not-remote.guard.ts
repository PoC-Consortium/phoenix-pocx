import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { NodeService } from '../../node/services/node.service';

/**
 * notRemoteGuard protects routes that need full-node RPC with no Electrum
 * equivalent (blocks explorer: getblock walks; peers page: getpeerinfo).
 * Remote (Electrum) mode redirects to the dashboard.
 */
export const notRemoteGuard: CanActivateFn = () => {
  const nodeService = inject(NodeService);
  const router = inject(Router);

  if (nodeService.isRemote()) {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};
