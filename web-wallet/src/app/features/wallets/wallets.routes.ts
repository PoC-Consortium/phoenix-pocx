import { Routes } from '@angular/router';

export const WALLETS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/wallet-list/wallet-list.component').then(m => m.WalletListComponent),
  },
];
