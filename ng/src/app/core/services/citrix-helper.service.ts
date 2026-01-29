import { Injectable } from '@angular/core';

export type Region01 = { x: number; y: number; w: number; h: number };

export type CitrixDisplayInfo = {
  index?: number;
  id?: string | number;
  name?: string;
  width?: number;
  height?: number;
};

type HealthResponse = { ok: boolean; name?: string; port?: number };

type CaptureResponse = {
  ok: boolean;
  mime?: string;
  pngBase64?: string;
  error?: string;
};

type DisplaysResponse = {
  ok: boolean;
  displays?: CitrixDisplayInfo[];
  error?: string;
};

type ExtractResponse = {
  ok: boolean;
  sgss?: string;
  tipoEmpresa?: string;
  raw?: { sgssText?: string; tipoText?: string; lang?: string };
  error?: string;
};

function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String((e as any)?.error || (e as any)?.message || e || 'Falha');
}

@Injectable({ providedIn: 'root' })
export class CitrixHelperService {
  readonly baseUrl = 'http://127.0.0.1:3177';

  async health(): Promise<{ ok: boolean; error?: string } & HealthResponse> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      const j = (await r.json()) as any;
      return { ok: Boolean(j?.ok), name: j?.name, port: j?.port };
    } catch (e) {
      return { ok: false, error: formatErr(e) };
    }
  }

  async displays(): Promise<DisplaysResponse> {
    try {
      const r = await fetch(`${this.baseUrl}/displays`, { method: 'GET' });
      const j = (await r.json()) as any;
      if (!j?.ok) return { ok: false, error: String(j?.error || 'Falha ao listar monitores') };
      const displays = Array.isArray(j?.displays) ? (j.displays as any[]).map(d => ({
        index: Number((d as any)?.index) >= 0 ? Number((d as any)?.index) : undefined,
        id: (d as any)?.id,
        name: (d as any)?.name,
        width: Number((d as any)?.width) || undefined,
        height: Number((d as any)?.height) || undefined,
      })) : [];
      return { ok: true, displays };
    } catch (e) {
      return { ok: false, error: formatErr(e) };
    }
  }

  async capture(screen?: number | null): Promise<CaptureResponse> {
    try {
      const r = await fetch(`${this.baseUrl}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Number.isFinite(Number(screen)) ? { screen: Number(screen) } : {}),
      });
      const j = (await r.json()) as any;
      if (!j?.ok) return { ok: false, error: String(j?.error || 'Falha ao capturar') };
      return { ok: true, mime: String(j?.mime || 'image/png'), pngBase64: String(j?.pngBase64 || '') };
    } catch (e) {
      return { ok: false, error: formatErr(e) };
    }
  }

  async extract(pngBase64: string, regions: { sgss: Region01; tipoEmpresa: Region01 }): Promise<ExtractResponse> {
    try {
      const r = await fetch(`${this.baseUrl}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pngBase64, regions }),
      });
      const j = (await r.json()) as any;
      if (!j?.ok) return { ok: false, error: String(j?.error || 'Falha ao extrair') };
      return {
        ok: true,
        sgss: String(j?.sgss || ''),
        tipoEmpresa: String(j?.tipoEmpresa || ''),
        raw: j?.raw,
      };
    } catch (e) {
      return { ok: false, error: formatErr(e) };
    }
  }
}
