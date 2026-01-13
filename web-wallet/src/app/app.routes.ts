import { Routes } from '@angular/router';
import { authGuard, noAuthGuard, nodeSetupGuard } from './core/guards';

/**
 * Application routes with lazy-loaded feature modules.
 *
 * Route structure:
 * - /settings - App settings (public - accessible from anywhere)
 * - /auth/* - Authentication & wallet selection (public)
 * - /dashboard - Main dashboard (protected)
 * - /send - Send Bitcoin (protected)
 * - /receive - Receive Bitcoin (protected)
 * - /transactions - Transaction history (protected)
 * - /contacts - Address book (protected)
 */
export const routes: Routes = [
  // Node setup route (accessible before auth - uses auth layout for toolbar)
  {
    path: 'node',
    loadComponent: () =>
      import('./layout/auth-layout/auth-layout.component').then(m => m.AuthLayoutComponent),
    children: [
      {
        path: '',
        loadChildren: () => import('./node/node.routes').then(m => m.NODE_ROUTES),
      },
    ],
  },

  // Settings route (accessible from anywhere - uses auth layout for toolbar)
  {
    path: 'settings',
    loadComponent: () =>
      import('./layout/auth-layout/auth-layout.component').then(m => m.AuthLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/settings/pages/settings/settings.component').then(
            m => m.SettingsComponent
          ),
      },
    ],
  },

  // Auth routes (public - redirect if already logged in)
  // Uses AuthLayoutComponent which shows toolbar without sidenav
  // nodeSetupGuard runs first to redirect to /node/setup if node not installed
  {
    path: 'auth',
    canActivate: [nodeSetupGuard, noAuthGuard],
    loadComponent: () =>
      import('./layout/auth-layout/auth-layout.component').then(m => m.AuthLayoutComponent),
    children: [
      {
        path: '',
        loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES),
      },
    ],
  },

  // Protected routes (require active wallet)
  // nodeSetupGuard runs first to redirect to /node/setup if node not installed (desktop only)
  {
    path: '',
    canActivate: [nodeSetupGuard, authGuard],
    loadComponent: () =>
      import('./layout/main-layout/main-layout.component').then(m => m.MainLayoutComponent),
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES),
      },
      {
        path: 'send',
        loadChildren: () => import('./features/send/send.routes').then(m => m.SEND_ROUTES),
      },
      {
        path: 'receive',
        loadChildren: () => import('./features/receive/receive.routes').then(m => m.RECEIVE_ROUTES),
      },
      {
        path: 'transactions',
        loadChildren: () =>
          import('./features/transactions/transactions.routes').then(m => m.TRANSACTIONS_ROUTES),
      },
      {
        path: 'contacts',
        loadChildren: () =>
          import('./features/contacts/contacts.routes').then(m => m.CONTACTS_ROUTES),
      },
      {
        path: 'forging-assignment',
        loadChildren: () =>
          import('./features/forging-assignment/forging-assignment.routes').then(
            m => m.FORGING_ASSIGNMENT_ROUTES
          ),
      },
      {
        path: 'peers',
        loadChildren: () => import('./features/peers/peers.routes').then(m => m.PEERS_ROUTES),
      },
      {
        path: 'blocks',
        loadChildren: () => import('./features/blocks/blocks.routes').then(m => m.BLOCKS_ROUTES),
      },
      {
        path: 'mining',
        loadChildren: () => import('./mining/mining.routes').then(m => m.MINING_ROUTES),
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
    ],
  },

  // Default redirect
  {
    path: '**',
    redirectTo: 'auth',
  },
];
