import { Routes } from '@angular/router';

import { adminGuard } from './core/services/admin.guard';
import { authGuard } from './core/services/auth.guard';
import { AuthPage } from './pages/auth-page/auth-page';
import { AdminPage } from './pages/admin-page/admin-page';
import { MainPage } from './pages/main-page/main-page';
import { ReportPage } from './pages/report-page/report-page';

export const routes: Routes = [
	{
		path: 'auth',
		component: AuthPage,
	},
	{
		path: '',
		component: MainPage,
		canActivate: [authGuard],
	},
	{
		path: 'report',
		component: ReportPage,
		canActivate: [authGuard],
	},
	{
		path: 'admin',
		component: AdminPage,
		canActivate: [adminGuard],
	},
	{
		path: '**',
		redirectTo: '',
	},
];
