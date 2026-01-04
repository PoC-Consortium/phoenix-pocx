import { Routes } from '@angular/router';

export const MINING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/mining-dashboard/mining-dashboard.component').then(
        m => m.MiningDashboardComponent
      ),
  },
  {
    path: 'setup',
    loadComponent: () =>
      import('./pages/setup-wizard/setup-wizard.component').then(m => m.SetupWizardComponent),
  },
];
