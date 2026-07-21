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
        path: '',
        loadComponent: () =>
          import('./pages/home/wallet-home.component').then(m => m.WalletHomeComponent),
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
        path: 'receive',
        loadComponent: () =>
          import('./pages/receive/wallet-receive.component').then(m => m.WalletReceiveComponent),
      },
      {
        path: 'send',
        loadComponent: () =>
          import('./pages/send/wallet-send.component').then(m => m.WalletSendComponent),
      },
      {
        path: 'history',
        loadComponent: () =>
          import('./pages/history/wallet-history.component').then(m => m.WalletHistoryComponent),
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
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/wallet-settings.component').then(m => m.WalletSettingsComponent),
      },
    ],
  },
];
