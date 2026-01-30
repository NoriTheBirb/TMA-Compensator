import { Injectable } from '@angular/core';
import type { Region01 } from './citrix-helper.service';

export type BrowserExtractResponse = {
  ok: boolean;
  sgss?: string;
  tipoEmpresa?: string;
  raw?: { sgssText?: string; tipoText?: string; lang?: string };
  error?: string;
};

declare global {
  interface Window {
    Tesseract?: any;
  }
}

function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String((e as any)?.error || (e as any)?.message || e || 'Falha');
}

function clamp01(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalizeRegion(r: any): Region01 {
  const x = clamp01(r?.x);
  const y = clamp01(r?.y);
  const w = clamp01(r?.w);
  const h = clamp01(r?.h);

  const ww = Math.max(0.001, w);
  const hh = Math.max(0.001, h);

  const xx = Math.min(x, 1 - 0.001);
  const yy = Math.min(y, 1 - 0.001);
  const maxW = 1 - xx;
  const maxH = 1 - yy;
  return {
    x: xx,
    y: yy,
    w: Math.min(ww, maxW),
    h: Math.min(hh, maxH),
  };
}

function pickSgss(text: string): string {
  const t = String(text || '');
  const m = t.match(/\bSGSS\s*\d{6,}\b/i);
  if (!m) return '';
  return m[0].replace(/\s+/g, '').toUpperCase();
}

function pickTipoEmpresa(text: string): string {
  const t = String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

async function loadImageFromBase64Png(pngBase64: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/png;base64,${pngBase64}`;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Falha ao carregar imagem.'));
  });

  return img;
}

function preprocessToCanvas(img: HTMLImageElement, region01: Region01): HTMLCanvasElement {
  const imgW = Math.max(1, Math.floor(img.naturalWidth || img.width || 0));
  const imgH = Math.max(1, Math.floor(img.naturalHeight || img.height || 0));
  if (!imgW || !imgH) throw new Error('invalid_image_dimensions');

  const r = normalizeRegion(region01);
  const left = Math.max(0, Math.floor(r.x * imgW));
  const top = Math.max(0, Math.floor(r.y * imgH));
  const width = Math.max(1, Math.floor(r.w * imgW));
  const height = Math.max(1, Math.floor(r.h * imgH));

  const cropW = Math.min(width, imgW - left);
  const cropH = Math.min(height, imgH - top);

  // Similar to helper: upscale the crop to improve OCR.
  const targetW = Math.min(2200, Math.max(300, cropW * 2));
  const scale = targetW / cropW;
  const targetH = Math.max(1, Math.floor(cropH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas_not_supported');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(img, left, top, cropW, cropH, 0, 0, targetW, targetH);

  // Conservative grayscale + contrast normalize.
  const id = ctx.getImageData(0, 0, targetW, targetH);
  const d = id.data;
  const contrast = 1.25;
  for (let i = 0; i < d.length; i += 4) {
    const r0 = d[i] || 0;
    const g0 = d[i + 1] || 0;
    const b0 = d[i + 2] || 0;
    const lum = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
    const v = Math.max(0, Math.min(255, (lum - 128) * contrast + 128));
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);

  return canvas;
}

@Injectable({ providedIn: 'root' })
export class BrowserOcrService {
  private tesseractLoading: Promise<any> | null = null;
  private worker: any | null = null;
  private workerLang: string | null = null;
  private workerStarting: Promise<any> | null = null;

  private async loadTesseractGlobal(): Promise<any> {
    if (window.Tesseract?.createWorker) return window.Tesseract;

    if (!this.tesseractLoading) {
      this.tesseractLoading = new Promise<any>((resolve, reject) => {
        const s = document.createElement('script');
        s.async = true;
        s.defer = true;
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = () => {
          if (window.Tesseract?.createWorker) resolve(window.Tesseract);
          else reject(new Error('Tesseract não carregou.'));
        };
        s.onerror = () => reject(new Error('Falha ao baixar Tesseract (CDN bloqueada?).'));
        document.head.appendChild(s);
      });
    }

    return this.tesseractLoading;
  }

  private async getWorker(lang: string): Promise<any> {
    if (this.worker && this.workerLang === lang) return this.worker;

    if (this.workerStarting) return this.workerStarting;

    this.workerStarting = (async () => {
      const T = await this.loadTesseractGlobal();

      if (this.worker) {
        try {
          await this.worker.terminate();
        } catch {
          // ignore
        }
        this.worker = null;
        this.workerLang = null;
      }

      // Default langPath is used by Tesseract.js; may fail on restricted networks.
      const w = await T.createWorker(lang, 1, {
        logger: undefined,
      });

      this.worker = w;
      this.workerLang = lang;
      return w;
    })();

    try {
      return await this.workerStarting;
    } finally {
      this.workerStarting = null;
    }
  }

  async extractCitrixFields(pngBase64: string, regions: { sgss: Region01; tipoEmpresa: Region01 }): Promise<BrowserExtractResponse> {
    try {
      const img = await loadImageFromBase64Png(String(pngBase64 || '').trim());

      let w: any;
      try {
        w = await this.getWorker('por');
      } catch {
        w = await this.getWorker('eng');
      }

      const sgssCanvas = preprocessToCanvas(img, regions.sgss);
      const tipoCanvas = preprocessToCanvas(img, regions.tipoEmpresa);

      // SGSS: restrict character set to improve accuracy.
      try {
        await w.setParameters({
          tessedit_char_whitelist: 'SGSS0123456789',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
      } catch {
        // ignore
      }

      const sgssRet = await w.recognize(sgssCanvas);
      const sgssText = String(sgssRet?.data?.text || '');

      // Tipo Empresa: reset whitelist.
      try {
        await w.setParameters({
          tessedit_char_whitelist: '',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
      } catch {
        // ignore
      }

      const tipoRet = await w.recognize(tipoCanvas);
      const tipoText = String(tipoRet?.data?.text || '');

      return {
        ok: true,
        sgss: pickSgss(sgssText),
        tipoEmpresa: pickTipoEmpresa(tipoText),
        raw: { sgssText, tipoText, lang: String(this.workerLang || '') },
      };
    } catch (e) {
      return { ok: false, error: formatErr(e) };
    }
  }
}
