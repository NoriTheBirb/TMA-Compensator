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
  private activeStream: MediaStream | null = null;
  private activeVideo: HTMLVideoElement | null = null;

  stopSharing(): void {
    try {
      this.activeStream?.getTracks()?.forEach((t: MediaStreamTrack) => t.stop());
    } catch {
      // ignore
    }
    this.activeStream = null;
    this.activeVideo = null;
  }

  private async ensureStream(): Promise<MediaStream> {
    if (this.activeStream) {
      const track = this.activeStream.getVideoTracks()?.[0];
      if (track && track.readyState === 'live') {
        return this.activeStream;
      }
      this.stopSharing();
    }

    const mediaDevices = (navigator as any)?.mediaDevices as MediaDevices | undefined;
    const hasGetDisplayMedia = !!(mediaDevices && typeof (mediaDevices as any).getDisplayMedia === 'function');
    if (!hasGetDisplayMedia) {
      throw new Error('Seu navegador não suporta captura de tela (getDisplayMedia). Use Chrome/Edge.');
    }

    // Important: call as a method on mediaDevices to keep correct binding (avoids "Illegal invocation").
    const stream = await (mediaDevices as any).getDisplayMedia({
      video: {
        // Not supported everywhere; harmless when ignored.
        displaySurface: 'monitor',
      },
      audio: false,
    });

    const track = stream.getVideoTracks()?.[0];
    if (!track) {
      try {
        stream.getTracks()?.forEach((t: MediaStreamTrack) => t.stop());
      } catch {
        // ignore
      }
      throw new Error('Nenhuma faixa de vídeo foi capturada.');
    }

    // If the user clicks "Stop sharing" in the browser UI, clean up.
    try {
      track.addEventListener('ended', () => {
        if (this.activeStream === stream) {
          this.stopSharing();
        }
      });
    } catch {
      // ignore
    }

    this.activeStream = stream;
    this.activeVideo = null;
    return stream;
  }

  private async ensureVideo(stream: MediaStream): Promise<HTMLVideoElement> {
    if (this.activeVideo && (this.activeVideo as any).srcObject === stream) {
      const v = this.activeVideo;
      if ((v.videoWidth || 0) > 0 && (v.videoHeight || 0) > 0) return v;
    }

    const video = document.createElement('video');
    video.playsInline = true;
    (video as any).muted = true;
    (video as any).srcObject = stream;

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

    this.activeVideo = video;
    return video;
  }

  async capturePngBase64(): Promise<BrowserCaptureResponse> {
    try {
      const stream = await this.ensureStream();
      const video = await this.ensureVideo(stream);

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
      // If capture failed, discard any cached stream and let the next attempt re-request permissions.
      this.stopSharing();
      return { ok: false, error: formatErr(e) };
    }
  }
}
