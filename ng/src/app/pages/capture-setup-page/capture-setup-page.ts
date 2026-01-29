import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CitrixHelperService, type CitrixDisplayInfo, type Region01 } from '../../core/services/citrix-helper.service';
import { StorageService } from '../../core/storage/storage.service';

type Step = 'intro' | 'pick-sgss' | 'pick-tipo' | 'test';

type CitrixRegions = {
  sgss: Region01;
  tipoEmpresa: Region01;
};

@Component({
  selector: 'app-capture-setup-page',
  imports: [CommonModule, RouterLink],
  templateUrl: './capture-setup-page.html',
  styleUrl: './capture-setup-page.css',
})
export class CaptureSetupPage {
  @ViewChild('imgEl') private readonly imgEl?: ElementRef<HTMLImageElement>;
  @ViewChild('stageEl') private readonly stageEl?: ElementRef<HTMLDivElement>;

  protected readonly step = signal<Step>('intro');

  protected readonly helperOk = signal<boolean>(false);
  protected readonly helperChecking = signal<boolean>(false);
  protected readonly helperError = signal<string>('');

  protected readonly screenshotBase64 = signal<string>('');

  protected readonly displays = signal<CitrixDisplayInfo[]>([]);
  protected readonly selectedScreenIndex = signal<number>(0);

  protected readonly regions = signal<CitrixRegions | null>(null);

  protected readonly extracting = signal<boolean>(false);
  protected readonly extractedSgss = signal<string>('');
  protected readonly extractedTipo = signal<string>('');
  protected readonly extractedError = signal<string>('');

  // Drag state
  protected readonly dragging = signal<boolean>(false);
  private dragStart: { x: number; y: number } | null = null;
  protected readonly draftRegion = signal<Region01 | null>(null);
  private pickTarget: 'sgss' | 'tipoEmpresa' | null = null;

  protected readonly screenshotSrc = computed(() => {
    const b = String(this.screenshotBase64() || '');
    return b ? `data:image/png;base64,${b}` : '';
  });

  protected readonly currentTargetLabel = computed(() => {
    const s = this.step();
    if (s === 'pick-sgss') return 'SGSS (código)';
    if (s === 'pick-tipo') return 'Tipo Empresa (valor)';
    return '';
  });

  constructor(
    private readonly helper: CitrixHelperService,
    private readonly storage: StorageService,
  ) {
    const prev = this.storage.getCitrixCaptureRegionsOrNull();
    if (prev) this.regions.set(prev);

    const prevScreen = this.storage.getCitrixCaptureScreenIndexOrNull();
    if (prevScreen !== null) this.selectedScreenIndex.set(prevScreen);

    // Best-effort initial populate.
    void this.checkHelper();
  }

  protected async checkHelper(): Promise<void> {
    this.helperChecking.set(true);
    this.helperError.set('');
    try {
      const r = await this.helper.health();
      this.helperOk.set(Boolean(r.ok));
      if (!r.ok) this.helperError.set(r.error || 'Helper não encontrado.');

      if (r.ok) {
        const d = await this.helper.displays();
        if (d.ok) {
          this.displays.set(d.displays || []);
        }
      }
    } finally {
      this.helperChecking.set(false);
    }
  }

  protected setScreenIndex(v: any): void {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    this.selectedScreenIndex.set(n);
    this.storage.setCitrixCaptureScreenIndex(n);
  }

  protected async captureNow(): Promise<void> {
    this.extractedSgss.set('');
    this.extractedTipo.set('');
    this.extractedError.set('');

    const h = await this.helper.health();
    this.helperOk.set(Boolean(h.ok));
    if (!h.ok) {
      this.helperError.set(h.error || 'Helper não encontrado.');
      return;
    }

    const r = await this.helper.capture(this.selectedScreenIndex());
    if (!r.ok || !r.pngBase64) {
      this.helperError.set(String(r.error || 'Falha ao capturar.'));
      return;
    }

    this.screenshotBase64.set(r.pngBase64);

    // Start pick flow.
    this.step.set('pick-sgss');
    this.draftRegion.set(null);
    this.dragStart = null;
    this.dragging.set(false);
    this.pickTarget = null;
  }

  protected clearRegions(): void {
    this.regions.set(null);
    this.storage.setCitrixCaptureRegions(null);
  }

  protected startPickSgss(): void {
    if (!this.screenshotBase64()) return;
    this.cancelDrag();
    this.step.set('pick-sgss');
  }

  protected startPickTipo(): void {
    if (!this.screenshotBase64()) return;
    this.cancelDrag();
    this.step.set('pick-tipo');
  }

  private cancelDrag(): void {
    this.dragging.set(false);
    this.dragStart = null;
    this.draftRegion.set(null);
    this.pickTarget = null;
  }

  private getImageRect(): DOMRect | null {
    const el = this.imgEl?.nativeElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return r;
  }

  private pointTo01(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.getImageRect();
    if (!r) return null;
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    const cx = Math.max(0, Math.min(1, x));
    const cy = Math.max(0, Math.min(1, y));
    return { x: cx, y: cy };
  }

  protected onPointerDown(ev: PointerEvent): void {
    if (this.step() !== 'pick-sgss' && this.step() !== 'pick-tipo') return;
    const p = this.pointTo01(ev.clientX, ev.clientY);
    if (!p) return;

    try {
      this.stageEl?.nativeElement?.setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }

    this.dragging.set(true);
    this.dragStart = { x: p.x, y: p.y };
    this.draftRegion.set({ x: p.x, y: p.y, w: 0.001, h: 0.001 });

    // Lock the intended target at pointer-down so switching steps mid-drag
    // (e.g. clicking another button) cannot save into the wrong field.
    this.pickTarget = this.step() === 'pick-sgss' ? 'sgss' : 'tipoEmpresa';
  }

  protected onPointerMove(ev: PointerEvent): void {
    if (!this.dragging() || !this.dragStart) return;
    const p = this.pointTo01(ev.clientX, ev.clientY);
    if (!p) return;

    const x1 = this.dragStart.x;
    const y1 = this.dragStart.y;
    const x2 = p.x;
    const y2 = p.y;

    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.max(0.001, Math.abs(x2 - x1));
    const h = Math.max(0.001, Math.abs(y2 - y1));

    this.draftRegion.set({ x, y, w, h });
  }

  protected onPointerUp(_ev: PointerEvent): void {
    if (!this.dragging()) return;
    this.dragging.set(false);
    this.dragStart = null;

    const r = this.draftRegion();
    if (!r) return;

    const existing = this.regions();
    const target = this.pickTarget ?? (this.step() === 'pick-sgss' ? 'sgss' : this.step() === 'pick-tipo' ? 'tipoEmpresa' : null);
    this.pickTarget = null;

    if (target === 'sgss') {
      const next: CitrixRegions = {
        sgss: r,
        tipoEmpresa: existing?.tipoEmpresa ?? { x: 0, y: 0, w: 0.001, h: 0.001 },
      };
      this.regions.set(next);
      this.storage.setCitrixCaptureRegions(next);
      this.step.set('pick-tipo');
      this.draftRegion.set(null);
      return;
    }

    if (target === 'tipoEmpresa') {
      const next: CitrixRegions = {
        sgss: existing?.sgss ?? { x: 0, y: 0, w: 0.001, h: 0.001 },
        tipoEmpresa: r,
      };
      this.regions.set(next);
      this.storage.setCitrixCaptureRegions(next);
      this.step.set('test');
      this.draftRegion.set(null);
    }
  }

  protected regionStyle(region: Region01 | null, variant: 'primary' | 'secondary' = 'primary'): any {
    if (!region) return { display: 'none' };
    const border = variant === 'primary' ? '2px solid #22c55e' : '2px solid rgba(148,163,184,0.9)';
    const bg = variant === 'primary' ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.10)';
    return {
      left: `${region.x * 100}%`,
      top: `${region.y * 100}%`,
      width: `${region.w * 100}%`,
      height: `${region.h * 100}%`,
      border,
      background: bg,
    };
  }

  protected async testExtract(): Promise<void> {
    this.extractedError.set('');
    this.extractedSgss.set('');
    this.extractedTipo.set('');

    const regions = this.regions();
    const png = this.screenshotBase64();
    if (!regions || !png) {
      this.extractedError.set('Faltou captura ou regiões.');
      return;
    }

    this.extracting.set(true);
    try {
      const r = await this.helper.extract(png, regions);
      if (!r.ok) {
        this.extractedError.set(r.error || 'Falha ao extrair.');
        return;
      }

      this.extractedSgss.set(String(r.sgss || ''));
      this.extractedTipo.set(String(r.tipoEmpresa || ''));

      if (!r.sgss && !r.tipoEmpresa) {
        this.extractedError.set('Não consegui ler nada. Tente capturar de novo e marque as caixas mais justas.');
      }
    } finally {
      this.extracting.set(false);
    }
  }

  protected async copyResults(): Promise<void> {
    const sgss = String(this.extractedSgss() || '').trim();
    const tipo = String(this.extractedTipo() || '').trim();
    const text = [sgss, tipo].filter(Boolean).join('\n');
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }
}
