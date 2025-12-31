import { Routes } from '@angular/router';

export const SEND_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/send/send.component').then(m => m.SendComponent),
  },
];
