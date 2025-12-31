import { Routes } from '@angular/router';

export const FORGING_ASSIGNMENT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/forging-assignment/forging-assignment.component').then(
        m => m.ForgingAssignmentComponent
      ),
  },
];
