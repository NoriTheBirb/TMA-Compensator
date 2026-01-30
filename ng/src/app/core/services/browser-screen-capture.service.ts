import { Injectable } from '@angular/core';

export type BrowserCaptureResponse = {
  ok: boolean;
  mime?: string;
  pngBase64?: string;
  error?: string;
};

function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String((e as any)?.error || (e as any)?.message || e || 'Falha');
}

@Injectable({ providedIn: 'root' })
export class BrowserScreenCaptureService {
  async capturePngBase64(): Promise<BrowserCaptureResponse> {
    const mediaDevices = (navigator as any)?.mediaDevices as MediaDevices | undefined;
    const hasGetDisplayMedia = !!(mediaDevices && typeof (mediaDevices as any).getDisplayMedia === 'function');

    if (!hasGetDisplayMedia) {
      return {
        ok: false,
        error: 'Seu navegador não suporta captura de tela (getDisplayMedia). Use Chrome/Edge.'
      };
    }

    let stream: MediaStream | null = null;
    try {
      // Important: call as a method on mediaDevices to keep correct binding (avoids "Illegal invocation").
      stream = await (mediaDevices as any).getDisplayMedia({
        video: {
          // Not supported everywhere; harmless when ignored.
          displaySurface: 'monitor',
        },
        audio: false,
      });

      const s = stream as MediaStream;
      const track = s.getVideoTracks()?.[0];
      if (!track) return { ok: false, error: 'Nenhuma faixa de vídeo foi capturada.' };

      const video = document.createElement('video');
      video.playsInline = true;
      (video as any).muted = true;
      (video as any).srcObject = s;

      // Some browsers need the play() call; others are fine with metadata only.
      try {
        await video.play();
      } catch {
        // ignore
      }

      await new Promise<void>((resolve, reject) => {
        const done = () => resolve();
        const fail = () => reject(new Error('Falha ao carregar stream de captura.'));
        video.onloadedmetadata = done;
        video.onerror = fail;

        // If metadata is already available.
        if (video.readyState >= 1) resolve();
      });

      const w = Math.max(1, Math.floor(video.videoWidth || 0));
      const h = Math.max(1, Math.floor(video.videoHeight || 0));
      if (!w || !h) return { ok: false, error: 'Dimensões inválidas da captura.' };

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { ok: false, error: 'Canvas não suportado.' };

      ctx.drawImage(video, 0, 0, w, h);

      const dataUrl = canvas.toDataURL('image/png');
      const pngBase64 = String(dataUrl.split(',')[1] || '').trim();
      if (!pngBase64) return { ok: false, error: 'Falha ao gerar PNG.' };

      return { ok: true, mime: 'image/png', pngBase64 };
    } catch (e) {
      return { ok: false, error: formatErr(e) };
    } finally {
      try {
        stream?.getTracks()?.forEach(t => t.stop());
      } catch {
        // ignore
      }
    }
  }
}
