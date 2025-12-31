import { Routes } from '@angular/router';

export const CONTACTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/contact-list/contact-list.component').then(m => m.ContactListComponent),
  },
];
