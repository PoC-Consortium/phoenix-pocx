import { Routes } from '@angular/router';

export const AGGREGATOR_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/aggregator-dashboard/aggregator-dashboard.component').then(
        m => m.AggregatorDashboardComponent
      ),
  },
];
