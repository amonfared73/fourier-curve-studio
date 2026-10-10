import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { StudioStore } from '../../core/state/studio-store';
import { DrawingSession } from '../../core/state/drawing-session';
import { EXAMPLE_CURVES } from '../../core/examples/example-curves';
import { importSvg, MAX_SVG_BYTES, SvgShapeCandidate } from '../../core/svg/svg-import';

type InputTab = 'draw' | 'examples' | 'svg';

/** Curve sources: freehand drawing, built-in examples and SVG import. */
@Component({
  selector: 'app-curve-input',
  templateUrl: './curve-input.component.html',
  styleUrl: './curve-input.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel' },
})
export class CurveInputComponent {
  protected readonly store = inject(StudioStore);
  protected readonly drawing = inject(DrawingSession);
  protected readonly examples = EXAMPLE_CURVES;

  protected readonly tab = signal<InputTab>('examples');
  protected readonly tabs: readonly { id: InputTab; label: string }[] = [
    { id: 'draw', label: 'Draw' },
    { id: 'examples', label: 'Examples' },
    { id: 'svg', label: 'SVG import' },
  ];

  protected readonly svgFileName = signal<string | null>(null);
  protected readonly svgError = signal<string | null>(null);
  protected readonly svgWarnings = signal<string[]>([]);
  protected readonly svgCandidates = signal<SvgShapeCandidate[]>([]);
  protected readonly selectedCandidateId = signal<string | null>(null);

  protected readonly preprocessError = computed(() => {
    const r = this.store.preprocessResult();
    return r && !r.ok ? r.error : null;
  });
  protected readonly preprocessWarnings = computed(() => {
    const r = this.store.preprocessResult();
    return r?.ok ? r.warnings : [];
  });

  protected selectTab(tab: InputTab): void {
    this.tab.set(tab);
    if (tab !== 'draw' && this.drawing.active()) this.drawing.cancel();
  }

  protected onTabKeydown(ev: KeyboardEvent, index: number): void {
    const delta = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    ev.preventDefault();
    const next = this.tabs[(index + delta + this.tabs.length) % this.tabs.length];
    this.selectTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  protected startDrawing(): void {
    this.drawing.clear();
    this.drawing.start();
  }

  protected async onFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    this.svgError.set(null);
    this.svgWarnings.set([]);
    this.svgCandidates.set([]);
    this.selectedCandidateId.set(null);
    if (!file) return;
    this.svgFileName.set(file.name);

    if (file.size > MAX_SVG_BYTES) {
      this.svgError.set('The file is larger than 5 MB.');
      return;
    }
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      this.svgError.set('Please choose an .svg file.');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.svgError.set('The file could not be read.');
      return;
    }
    const result = importSvg(text);
    if (!result.ok) {
      this.svgError.set(result.error);
      return;
    }
    this.svgCandidates.set(result.candidates);
    this.svgWarnings.set(result.warnings);
    this.selectedCandidateId.set(result.candidates[0].id);
  }

  protected useSelectedCandidate(): void {
    const candidate = this.svgCandidates().find((c) => c.id === this.selectedCandidateId());
    if (!candidate) return;
    this.store.setCurve({
      points: candidate.points,
      source: 'svg',
      label: `${this.svgFileName() ?? 'SVG'} · ${candidate.label.split(' — ')[0]}`,
    });
  }
}
