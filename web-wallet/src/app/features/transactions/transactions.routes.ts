import { Routes } from '@angular/router';

export const TRANSACTIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/transaction-list/transaction-list.component').then(
        m => m.TransactionListComponent
      ),
  },
  {
    // Must precede :txid so 'psbt' is not swallowed by the detail route
    path: 'psbt',
    loadComponent: () =>
      import('../psbt/pages/psbt/psbt.component').then(m => m.PsbtComponent),
  },
  {
    path: ':txid',
    loadComponent: () =>
      import('./pages/transaction-detail/transaction-detail.component').then(
        m => m.TransactionDetailComponent
      ),
  },
];
