import { ChangeDetectionStrategy, Component, ElementRef, viewChild } from '@angular/core';

/** Modal help panel explaining the notation (native <dialog>: focus trap and Esc built in). */
@Component({
  selector: 'app-help-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="help" aria-labelledby="help-title" (click)="onBackdrop($event)">
      <div class="help-body">
        <header>
          <h2 id="help-title">How Fourier Curve Studio works</h2>
          <button type="button" class="btn icon" aria-label="Close help" (click)="close()">✕</button>
        </header>

        <p>
          A closed curve is treated as a complex-valued periodic function
          <span class="math">z(t) = x(t) + i·y(t)</span>, <span class="math">t ∈ [0, 2π)</span>, and written as a sum
          of rotating vectors <span class="math">z(t) = Σ c<sub>k</sub> e<sup>ikt</sup></span>.
        </p>

        <dl>
          <dt><span class="math">M</span> — input samples</dt>
          <dd>
            The curve is resampled to M points equally spaced by arc length; sample j sits at
            <span class="math">t<sub>j</sub> = 2πj/M</span>. The DFT of M samples yields exactly M coefficients.
          </dd>
          <dt><span class="math">N</span> — retained components</dt>
          <dd>How many of the M coefficients (rotating vectors / epicycles) are used in the reconstruction <span class="math">z<sub>N</sub>(t)</span>. N ≤ M.</dd>
          <dt><span class="math">k</span> — frequency</dt>
          <dd>
            Signed integer: the vector turns k times per period. Positive k turns counter-clockwise, negative k clockwise,
            k = 0 is the fixed centre (≈ 0 because curves are centred on their centroid). For even M the Nyquist bin is
            reported as k = −M/2.
          </dd>
          <dt><span class="math">c<sub>k</sub></span> — coefficient</dt>
          <dd><span class="math">c<sub>k</sub> = (1/M) Σ<sub>j</sub> z<sub>j</sub> e<sup>−i2πkj/M</sup></span>, computed with a radix-2 FFT when M is a power of two, otherwise with a direct DFT.</dd>
          <dt>Magnitude <span class="math">|c<sub>k</sub>|</span></dt>
          <dd>Length of the vector and radius of its epicycle.</dd>
          <dt>Phase <span class="math">arg(c<sub>k</sub>)</span></dt>
          <dd>Angle of the vector at t = 0, in radians (or degrees if selected), in (−π, π].</dd>
          <dt>RMSE</dt>
          <dd>
            Root-mean-square distance between each original sample and the reconstruction at the same t, in normalised
            units (the curve's farthest point is at distance 1 from its centroid). It is a parameter-space error, not the
            minimum distance between the shapes.
          </dd>
          <dt>Selection modes</dt>
          <dd>
            <strong>Largest |c<sub>k</sub>|</strong> keeps the N most energetic terms (ties: smaller |k| first, then +k
            before −k). <strong>Contiguous</strong> keeps k = 0, +1, −1, +2, −2, … — a low-pass reconstruction.
          </dd>
        </dl>

        <h3>Keyboard</h3>
        <p>
          Focus the workspace and press <kbd>Space</kbd> to play/pause and <kbd>R</kbd> to restart. All controls are
          reachable with <kbd>Tab</kbd>; the input tabs also respond to <kbd>←</kbd>/<kbd>→</kbd>.
        </p>
      </div>
    </dialog>
  `,
  styles: `
    .help {
      width: min(680px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      padding: 0;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    }
    .help::backdrop { background: rgba(2, 6, 23, 0.7); backdrop-filter: blur(2px); }
    .help-body { padding: 20px 24px; overflow: auto; font-size: 0.88rem; line-height: 1.55; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    h2 { margin: 0; font-size: 1.1rem; }
    h3 { font-size: 0.9rem; margin: 18px 0 4px; }
    dt { font-weight: 600; margin-top: 10px; }
    dd { margin: 2px 0 0; color: var(--text-dim); }
    .math { font-family: var(--font-math); font-style: italic; color: var(--text); white-space: nowrap; }
    kbd { font-family: var(--font-mono); font-size: 0.78rem; padding: 1px 5px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--surface-2); }
  `,
})
export class HelpPanelComponent {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected onBackdrop(ev: MouseEvent): void {
    if (ev.target === this.dialog().nativeElement) this.close();
  }
}
