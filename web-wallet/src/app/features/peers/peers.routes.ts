import { Routes } from '@angular/router';

export const PEERS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/peers/peers.component').then(m => m.PeersComponent),
  },
];
