import { Routes } from '@angular/router';
import { NodeSetupComponent } from './pages';

export const NODE_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'setup',
    pathMatch: 'full',
  },
  {
    path: 'setup',
    component: NodeSetupComponent,
  },
];
