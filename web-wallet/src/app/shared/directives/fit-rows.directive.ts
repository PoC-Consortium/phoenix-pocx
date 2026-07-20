import {
  AfterViewInit,
  Directive,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * FitRowsDirective - "how many rows fit this box without scrolling".
 *
 * Attach to a row container whose height is viewport-derived (flex-fill
 * with `flex-basis: 0` / `min-height: 0`, so it never grows with its own
 * content). The directive measures the first row matching `fitRowSelector`
 * (falling back to `fitFallbackRowPx` before anything rendered), computes
 * `floor(containerHeight / rowHeight)` clamped to `fitMinRows..fitMaxRows`,
 * and emits it — once on attach and again whenever a ResizeObserver sees
 * the container resize (rotation, window resize, cards above growing).
 *
 * Used by the mobile wallet home (recent-transactions preview length), the
 * transactions page and the coins/contacts lists (fit-derived mat-paginator
 * pageSize).
 */
@Directive({
  selector: '[appFitRows]',
  standalone: true,
})
export class FitRowsDirective implements AfterViewInit, OnDestroy {
  /** Selector of one row inside the container (its live height is used). */
  readonly fitRowSelector = input('.tx-item');
  /** Readability floor: never report fewer rows than this. */
  readonly fitMinRows = input(1);
  /** Sanity ceiling for very tall screens. */
  readonly fitMaxRows = input(50);
  /** Assumed row height before any row rendered, px. */
  readonly fitFallbackRowPx = input(64);

  /** Rows that fit, emitted on attach and whenever the fit changes. */
  readonly fitRows = output<number>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private observer: ResizeObserver | null = null;
  private lastFit: number | null = null;

  ngAfterViewInit(): void {
    // ResizeObserver isn't zone-patched — re-enter for change detection.
    this.observer = new ResizeObserver(() => this.zone.run(() => this.measure()));
    this.observer.observe(this.el.nativeElement);
    this.measure();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private measure(): void {
    const host = this.el.nativeElement;
    const row = host.querySelector<HTMLElement>(this.fitRowSelector());
    const rowHeight = row?.getBoundingClientRect().height || this.fitFallbackRowPx();
    const fit = Math.min(
      this.fitMaxRows(),
      Math.max(this.fitMinRows(), Math.floor(host.clientHeight / rowHeight))
    );
    if (fit !== this.lastFit) {
      this.lastFit = fit;
      this.fitRows.emit(fit);
    }
  }
}
