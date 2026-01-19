export interface SupabaseRuntimeConfig {
  url: string;
  anonKey: string;
}

function readMetaContent(name: string): string {
  try {
    const el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
    return String(el?.content || '').trim();
  } catch {
    return '';
  }
}

export function readSupabaseRuntimeConfig(): SupabaseRuntimeConfig {
  const url = readMetaContent('supabase-url');
  const anonKey = readMetaContent('supabase-anon-key');
  return { url, anonKey };
}

export function assertSupabaseRuntimeConfig(cfg: SupabaseRuntimeConfig): void {
  const urlOk = /^https:\/\//.test(cfg.url) && cfg.url.includes('.supabase.co');
  const keyOk = String(cfg.anonKey || '').trim().length >= 20;
  if (!urlOk || !keyOk) {
    throw new Error(
      'Supabase config missing. Set <meta name="supabase-url"> and <meta name="supabase-anon-key"> in ng/src/index.html (or your deployed index.html).',
    );
  }
}
