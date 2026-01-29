import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { CompanionService } from './core/services/companion.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('tma-compensator-ng');

  private dragPointerId: number | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor(protected readonly companion: CompanionService) {}

  protected onCompanionPointerDown(ev: PointerEvent): void {
    try {
      if (this.companion.hidden()) return;
      if (ev.button !== 0) return;

      // Prevent native image dragging/selecting from stealing the gesture.
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch {
        // ignore
      }

      const target = ev.currentTarget as HTMLElement | null;
      const root = target?.closest?.('.companion') as HTMLElement | null;
      if (!root) return;

      const rect = root.getBoundingClientRect();
      this.dragPointerId = ev.pointerId;
      this.dragOffsetX = ev.clientX - rect.left;
      this.dragOffsetY = ev.clientY - rect.top;
      this.dragMoved = false;
      this.dragStartX = ev.clientX;
      this.dragStartY = ev.clientY;

      try {
        (ev.currentTarget as any)?.setPointerCapture?.(ev.pointerId);
      } catch {
        // ignore
      }

      window.addEventListener('pointermove', this.onWindowPointerMove, { passive: true });
      window.addEventListener('pointerup', this.onWindowPointerUp, { passive: true });
      window.addEventListener('pointercancel', this.onWindowPointerUp, { passive: true });
    } catch {
      // ignore
    }
  }

  protected onCompanionClick(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.dragMoved) return;
    this.companion.toggleOpen();
  }

  private onWindowPointerMove = (ev: PointerEvent): void => {
    if (this.dragPointerId == null) return;
    if (ev.pointerId !== this.dragPointerId) return;

    const dx = Math.abs(ev.clientX - this.dragStartX);
    const dy = Math.abs(ev.clientY - this.dragStartY);
    if (!this.dragMoved && (dx > 4 || dy > 4)) this.dragMoved = true;

    const x = ev.clientX - this.dragOffsetX;
    const y = ev.clientY - this.dragOffsetY;
    this.companion.setPosition({ x, y });
  };

  private onWindowPointerUp = (ev: PointerEvent): void => {
    if (this.dragPointerId == null) return;
    if (ev.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    window.removeEventListener('pointercancel', this.onWindowPointerUp);
    // Keep dragMoved true until after click; reset shortly.
    window.setTimeout(() => {
      this.dragMoved = false;
    }, 0);
  };
}
