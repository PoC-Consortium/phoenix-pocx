import { Routes } from '@angular/router';

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
        path: 'assignment',
        loadComponent: () =>
          import('./pages/assignment/wallet-assignment.component').then(
            m => m.WalletAssignmentComponent
          ),
      },
      {
        path: 'contacts',
        loadComponent: () =>
          import('./pages/contacts/wallet-contacts.component').then(m => m.WalletContactsComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/wallet-settings.component').then(m => m.WalletSettingsComponent),
      },
    ],
  },
];
