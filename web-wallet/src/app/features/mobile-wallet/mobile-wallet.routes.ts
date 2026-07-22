import { Routes } from '@angular/router';
import { notWalletOnlyGuard } from '../../core/guards';

/**
 * Mobile wallet routes (mobile mode only, guarded by mobileWalletGuard).
 *
 * Backed by the nodeless BTCX wallet (btcx_wallet_* Tauri commands), not
 * by a Bitcoin Core node.
 */
export const MOBILE_WALLET_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./layout/mobile-wallet-layout.component').then(m => m.MobileWalletLayoutComponent),
    children: [
      {
        // Unified responsive dashboard — the SAME component the desktop
        // /dashboard route uses. Its data flows through the seam
        // (WalletService / BlockchainStateService), fed in this shell by the
        // wallet-manager's nodeless bridge; the nodeless states (onboarding /
        // unlock / no-server / mining nudge) are folded in mode-gated.
        // WalletHomeComponent is retired.
        path: '',
        loadComponent: () =>
          import('../../features/dashboard/pages/dashboard/dashboard.component').then(
            m => m.DashboardComponent
          ),
      },
      {
        path: 'create',
        loadComponent: () =>
          import('./pages/create/wallet-create.component').then(m => m.WalletCreateComponent),
      },
      {
        path: 'restore',
        loadComponent: () =>
          import('./pages/restore/wallet-restore.component').then(m => m.WalletRestoreComponent),
      },
      {
        path: 'import',
        loadComponent: () =>
          import('./pages/import-descriptor/wallet-import-descriptor.component').then(
            m => m.WalletImportDescriptorComponent
          ),
      },
      {
        // Unified responsive receive page — the same component the desktop
        // /receive route uses. WalletReceiveComponent is retired.
        path: 'receive',
        loadComponent: () =>
          import('../../features/receive/pages/receive/receive.component').then(
            m => m.ReceiveComponent
          ),
      },
      {
        // Unified responsive send page — the same component the desktop
        // /send route uses (seam send, remote fee/unlock branches).
        // WalletSendComponent is retired.
        path: 'send',
        loadComponent: () =>
          import('../../features/send/pages/send/send.component').then(m => m.SendComponent),
      },
      {
        // Unified responsive transactions page — the same components the
        // desktop /transactions route uses (list + per-txid detail). The old
        // WalletHistoryComponent is retired.
        path: 'history',
        loadComponent: () =>
          import('../../features/transactions/pages/transaction-list/transaction-list.component').then(
            m => m.TransactionListComponent
          ),
      },
      {
        // Unified responsive coins/balance-details page — the same component
        // the desktop /coins route uses (features/coins).
        path: 'coins',
        loadComponent: () =>
          import('../../features/coins/pages/coins/coins.component').then(m => m.CoinsComponent),
      },
      // Wallet-only mode is "transactions only" — forging assignments are
      // hidden and the route is blocked (deep-link defense in depth).
      {
        path: 'assignment',
        canActivate: [notWalletOnlyGuard],
        loadComponent: () =>
          import('./pages/assignment/wallet-assignment.component').then(
            m => m.WalletAssignmentComponent
          ),
      },
      {
        // Unified responsive contacts page — the same component the desktop
        // /contacts route uses (features/contacts).
        path: 'contacts',
        loadComponent: () =>
          import('../../features/contacts/pages/contact-list/contact-list.component').then(
            m => m.ContactListComponent
          ),
      },
      {
        // PSBT builder — the same desktop component; client-side PSBT ops
        // (btcx_psbt_*) make it fully functional in the nodeless shell
        // (Core-only Join stays hidden via its existing isRemote gate).
        path: 'psbt',
        loadComponent: () =>
          import('../../features/psbt/pages/psbt/psbt.component').then(m => m.PsbtComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/wallet-settings.component').then(m => m.WalletSettingsComponent),
      },
    ],
  },
];
