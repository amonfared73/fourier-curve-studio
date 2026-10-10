import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { StudioStore } from '../../core/state/studio-store';
import { formatMetric } from '../../shared/format';

/** RMSE / MSE / max error, energy captured and an error-vs-t plot. */
@Component({
  selector: 'app-reconstruction-metrics',
  templateUrl: './reconstruction-metrics.component.html',
  styleUrl: './reconstruction-metrics.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel' },
})
export class ReconstructionMetricsComponent {
  protected readonly store = inject(StudioStore);
  protected readonly fmt = formatMetric;
  private readonly plotRef = viewChild<ElementRef<HTMLCanvasElement>>('plot');
  private readonly resizeObserver = new ResizeObserver(() => this.drawPlot());
  private observed: HTMLCanvasElement | null = null;

  constructor() {
    effect(() => {
      this.store.metrics();
      const canvas = this.plotRef()?.nativeElement ?? null;
      if (canvas !== this.observed) {
        if (this.observed) this.resizeObserver.unobserve(this.observed);
        if (canvas) this.resizeObserver.observe(canvas);
        this.observed = canvas;
      }
      this.drawPlot();
    });
    inject(DestroyRef).onDestroy(() => this.resizeObserver.disconnect());
  }

  /** Converts a normalised length to input units (canvas px for drawings, SVG units for SVG). */
  protected toInputUnits(v: number): number {
    const scale = this.store.samples()?.transform.scale ?? 1;
    return v / scale;
  }

  private drawPlot(): void {
    const canvas = this.plotRef()?.nativeElement;
    const metrics = this.store.metrics();
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!metrics) return;

    const e = metrics.pointwiseError;
    const m = e.length;
    const max = metrics.maxError > 0 ? metrics.maxError : 1;
    const pad = 4;
    const x = (j: number) => pad + ((w - 2 * pad) * j) / Math.max(m - 1, 1);
    const y = (v: number) => h - pad - ((h - 2 * pad) * v) / max;

    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    for (let j = 0; j < m; j++) ctx.lineTo(x(j), y(e[j]));
    ctx.lineTo(x(m - 1), y(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fill();
    ctx.beginPath();
    for (let j = 0; j < m; j++) (j === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, x(j), y(e[j]));
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // RMSE reference line
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
    ctx.beginPath();
    ctx.moveTo(pad, y(metrics.rmse));
    ctx.lineTo(w - pad, y(metrics.rmse));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
