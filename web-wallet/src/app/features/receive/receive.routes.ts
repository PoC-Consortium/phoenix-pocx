import { Routes } from '@angular/router';

export const RECEIVE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/receive/receive.component').then(m => m.ReceiveComponent),
  },
];
