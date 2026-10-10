import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { StudioStore } from '../../core/state/studio-store';
import { FourierCoefficient } from '../../core/models/fourier-coefficient.model';
import { coefficientsToCsv, coefficientsToJson, ExportContext } from '../../core/export/coefficient-export';
import { formatFixed } from '../../shared/format';

type SortKey = 'k' | 'magnitude' | 'rank';
type ViewFilter = 'retained' | 'all';

interface Row {
  readonly c: FourierCoefficient;
  readonly retained: boolean;
  /** 1-based selection rank, or null for excluded coefficients. */
  readonly rank: number | null;
}

const PAGE_SIZE = 200;

/** Table of the actual computed coefficients c_k, with sorting and export. */
@Component({
  selector: 'app-coefficient-inspector',
  templateUrl: './coefficient-inspector.component.html',
  styleUrl: './coefficient-inspector.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel' },
})
export class CoefficientInspectorComponent {
  protected readonly store = inject(StudioStore);

  protected readonly sortKey = signal<SortKey>('magnitude');
  protected readonly sortAsc = signal(false);
  protected readonly filter = signal<ViewFilter>('retained');
  protected readonly limit = signal(PAGE_SIZE);
  protected readonly status = signal<string | null>(null);
  protected readonly precisionOptions = [2, 3, 4, 6, 8, 10, 12, 15];

  private readonly allRows = computed<Row[]>(() => {
    const spectrum = this.store.spectrum();
    const sel = this.store.selection();
    if (!spectrum || !sel) return [];
    return spectrum.coefficients.map((c) => {
      const r = sel.rankByBin[c.bin];
      return { c, retained: r >= 0, rank: r >= 0 ? r + 1 : null };
    });
  });

  protected readonly rows = computed<Row[]>(() => {
    const filtered = this.filter() === 'retained' ? this.allRows().filter((r) => r.retained) : [...this.allRows()];
    const key = this.sortKey();
    const dir = this.sortAsc() ? 1 : -1;
    filtered.sort((a, b) => {
      let d = 0;
      if (key === 'k') d = a.c.k - b.c.k;
      else if (key === 'magnitude') d = a.c.magnitude - b.c.magnitude || Math.abs(b.c.k) - Math.abs(a.c.k);
      else d = (a.rank ?? Infinity) - (b.rank ?? Infinity);
      return d * dir || a.c.k - b.c.k;
    });
    return filtered;
  });

  protected readonly maxMagnitude = computed(() => {
    let max = 0;
    for (const c of this.store.spectrum()?.coefficients ?? []) max = Math.max(max, c.magnitude);
    return max > 0 ? max : 1;
  });

  protected readonly visibleRows = computed(() => this.rows().slice(0, this.limit()));

  protected setSort(key: SortKey): void {
    if (this.sortKey() === key) this.sortAsc.update((v) => !v);
    else {
      this.sortKey.set(key);
      this.sortAsc.set(key !== 'magnitude');
    }
  }

  protected ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() === key ? (this.sortAsc() ? 'ascending' : 'descending') : 'none';
  }

  protected setFilter(f: ViewFilter): void {
    this.filter.set(f);
    this.limit.set(PAGE_SIZE);
  }

  protected showMore(): void {
    this.limit.update((l) => l + PAGE_SIZE);
  }

  protected onPrecision(ev: Event): void {
    this.store.precision.set(Number((ev.target as HTMLSelectElement).value));
  }

  protected fmt(v: number): string {
    return formatFixed(v, this.store.precision());
  }

  protected phase(v: number): string {
    return this.store.phaseUnit() === 'deg' ? formatFixed((v * 180) / Math.PI, Math.max(2, this.store.precision() - 2)) : this.fmt(v);
  }

  private exportContext(): ExportContext | null {
    const spectrum = this.store.spectrum();
    const selection = this.store.selection();
    const samples = this.store.samples();
    if (!spectrum || !selection || !samples) return null;
    return { spectrum, selection, transform: samples.transform, curveLabel: this.store.rawCurve()?.label ?? '' };
  }

  /** Copies the current view (all rows, not just the visible page) as tab-separated values at full precision. */
  protected async copyTable(): Promise<void> {
    const header = ['k', 'Re(c_k)', 'Im(c_k)', '|c_k|', 'arg(c_k) [rad]', 'retained', 'rank'].join('\t');
    const lines = this.rows().map((r) =>
      [r.c.k, r.c.re, r.c.im, r.c.magnitude, r.c.phase, r.retained, r.rank ?? ''].join('\t'),
    );
    const text = [header, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.flash(`Copied ${lines.length} rows to the clipboard.`);
    } catch {
      // Fallback for browsers/contexts without the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      this.flash(ok ? `Copied ${lines.length} rows to the clipboard.` : 'Copy failed — your browser blocked clipboard access.');
    }
  }

  protected exportJson(): void {
    const ctx = this.exportContext();
    if (ctx) this.download(coefficientsToJson(ctx), 'fourier-coefficients.json', 'application/json');
  }

  protected exportCsv(): void {
    const ctx = this.exportContext();
    if (ctx) this.download(coefficientsToCsv(ctx), 'fourier-coefficients.csv', 'text/csv');
  }

  private download(content: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.flash(`Exported ${filename}.`);
  }

  private flash(message: string): void {
    this.status.set(message);
    setTimeout(() => {
      if (this.status() === message) this.status.set(null);
    }, 3000);
  }
}
