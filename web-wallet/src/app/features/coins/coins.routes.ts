import { Routes } from '@angular/router';

export const COINS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/coins/coins.component').then(m => m.CoinsComponent),
  },
];
