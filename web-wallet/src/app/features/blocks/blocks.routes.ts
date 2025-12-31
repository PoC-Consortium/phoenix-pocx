import { Routes } from '@angular/router';

export const BLOCKS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/block-list/block-list.component').then(m => m.BlockListComponent),
  },
  {
    path: 'tx/:txid',
    loadComponent: () =>
      import('./pages/transaction-details/transaction-details.component').then(
        m => m.TransactionDetailsComponent
      ),
  },
  {
    path: ':hashOrHeight',
    loadComponent: () =>
      import('./pages/block-details/block-details.component').then(m => m.BlockDetailsComponent),
  },
];
