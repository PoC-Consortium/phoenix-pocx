import { Routes } from '@angular/router';

export const AUTH_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/wallet-select/wallet-select.component').then(m => m.WalletSelectComponent),
  },
  {
    path: 'create',
    loadComponent: () =>
      import('./pages/create-wallet/create-wallet.component').then(m => m.CreateWalletComponent),
  },
  {
    path: 'import',
    loadComponent: () =>
      import('./pages/import-wallet/import-wallet.component').then(m => m.ImportWalletComponent),
  },
  {
    path: 'watch-only',
    loadComponent: () =>
      import('./pages/watch-only/watch-only.component').then(m => m.WatchOnlyComponent),
  },
];
