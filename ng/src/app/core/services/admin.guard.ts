import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const sb = inject(SupabaseService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) return router.parseUrl('/auth');
  if (!sb.ready()) return router.parseUrl('/');

  const userId = auth.userId();
  if (!userId) return router.parseUrl('/auth');

  try {
    const { data, error } = await sb.supabase
      .from('profiles')
      .select('is_admin')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if ((data as any)?.is_admin) return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[adminGuard] failed to check is_admin', e);
  }

  return router.parseUrl('/');
};
