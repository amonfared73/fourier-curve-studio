import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import { StudioStore } from './core/state/studio-store';
import { FourierCanvasComponent } from './features/fourier-canvas/fourier-canvas.component';
import { FourierControlsComponent } from './features/fourier-controls/fourier-controls.component';
import { CoefficientInspectorComponent } from './features/coefficient-inspector/coefficient-inspector.component';
import { ReconstructionMetricsComponent } from './features/reconstruction-metrics/reconstruction-metrics.component';
import { CurveInputComponent } from './features/curve-input/curve-input.component';
import { HelpPanelComponent } from './shared/components/help-panel/help-panel.component';

@Component({
  selector: 'app-root',
  imports: [
    FourierCanvasComponent,
    FourierControlsComponent,
    CoefficientInspectorComponent,
    ReconstructionMetricsComponent,
    CurveInputComponent,
    HelpPanelComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly store = inject(StudioStore);
  protected readonly help = viewChild.required(HelpPanelComponent);
}
