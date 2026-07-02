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
    path: ':txid',
    loadComponent: () =>
      import('./pages/transaction-detail/transaction-detail.component').then(
        m => m.TransactionDetailComponent
      ),
  },
];
