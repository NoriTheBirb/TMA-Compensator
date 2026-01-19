import { CommonModule } from '@angular/common';
import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { CompanionService } from '../../core/services/companion.service';

@Component({
  selector: 'app-auth-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.css',
})
export class AuthPage {
  protected readonly mode = signal<'signin' | 'signup'>('signin');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly loading = signal(false);
  protected readonly errorText = signal('');
  protected readonly successText = signal('');

  protected get supabaseInitError() {
    return this.auth.supabaseInitError;
  }

  protected get supabaseReady() {
    return this.auth.supabaseReady;
  }

  protected readonly title = computed(() => (this.mode() === 'signin' ? 'Entrar' : 'Criar conta'));
  protected readonly subtitle = computed(() =>
    this.mode() === 'signin'
      ? 'Entre para sincronizar seus dados entre dispositivos.'
      : 'Crie uma conta para sincronizar seus dados entre dispositivos.',
  );

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly companion: CompanionService,
  ) {
    effect(() => {
      if (this.auth.isAuthenticated()) void this.router.navigateByUrl('/');
    });

    // Friendly welcome on the login screen.
    this.companion.welcomeAuth(this.mode());

    effect(() => {
      // When user switches signin/signup, refresh the companion prompt.
      this.mode();
      this.companion.welcomeAuth(this.mode());
    });
  }

  protected toggleMode(): void {
    this.errorText.set('');
    this.successText.set('');
    this.mode.set(this.mode() === 'signin' ? 'signup' : 'signin');
  }

  protected async submit(): Promise<void> {
    if (!this.supabaseReady()) {
      this.errorText.set(this.supabaseInitError() || 'Supabase não configurado.');
      return;
    }

    const username = this.username().trim();
    const password = this.password();

    this.errorText.set('');
    this.successText.set('');
    const u = username.toLowerCase().replace(/\s+/g, '');
    if (!u || u.length < 3 || u.length > 24 || !/^[a-z0-9._-]+$/.test(u)) {
      this.errorText.set('Usuário inválido. Use 3–24 caracteres: letras/números e . _ -');
      return;
    }
    if (!password || String(password).length < 6) {
      this.errorText.set('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    this.loading.set(true);
    try {
      if (this.mode() === 'signin') {
        await this.auth.signInWithUsernamePassword(u, password);
      } else {
        const res = await this.auth.signUpWithUsernamePassword(u, password);
        if (!res.signedIn) {
          this.successText.set(
            `Conta criada, mas o projeto está exigindo confirmação de email.\n\n` +
              `Para usar login por usuário+senha (sem email), desative isso em Supabase: Authentication → Settings → Email confirmations (OFF).\n\n` +
              `Se precisar, apague o usuário não confirmado em Authentication → Users e tente criar de novo.\n\n` +
              `Identificador gerado: ${res.email}`,
          );
          this.mode.set('signin');
          this.password.set('');
        } else {
          this.successText.set('Conta criada e conectada.');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha de autenticação.';
      console.error('Auth error:', msg);
      if (/email signups are disabled|signups?.*disabled|signup.*disabled/i.test(msg)) {
        this.errorText.set(
          'O Supabase está com cadastro desativado. Ative em Supabase → Authentication → Providers (Email) e/ou Auth settings → Enable signups.',
        );
      } else if (/email address.*invalid|invalid email/i.test(msg)) {
        this.errorText.set(msg);
      } else if (/confirm|confirmed/i.test(msg)) {
        this.errorText.set(
          'O projeto está exigindo confirmação de email. Para login por usuário+senha, desative isso no Supabase (Auth settings → Email confirmations OFF).',
        );
      } else {
        this.errorText.set(msg);
      }
    } finally {
      this.loading.set(false);
    }
  }
}
