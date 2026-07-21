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
  /**
   * A container within this fraction of a row boundary keeps the current fit.
   * Wide enough to absorb sub-pixel resize jitter and a toggling scrollbar,
   * narrow enough not to bleed into the neighbouring boundary (2×0.34 < 1).
   */
  private static readonly DEADBAND = 0.34;

  private readonly zone = inject(NgZone);
  private observer: ResizeObserver | null = null;
  private lastFit: number | null = null;
  private rafId: number | null = null;

  ngAfterViewInit(): void {
    // Coalesce ResizeObserver bursts (a resize drag, or our own re-render
    // changing the paginator height) to one measurement per frame so they
    // can't feed back on themselves within a frame.
    this.observer = new ResizeObserver(() => this.scheduleMeasure());
    this.observer.observe(this.el.nativeElement);
    this.measure();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private scheduleMeasure(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      // ResizeObserver/rAF aren't zone-patched — re-enter for change detection.
      this.zone.run(() => this.measure());
    });
  }

  private measure(): void {
    const host = this.el.nativeElement;
    const rows = host.querySelectorAll<HTMLElement>(this.fitRowSelector());
    const rowHeight = this.rowStride(rows);
    const raw = host.clientHeight / rowHeight;
    const min = this.fitMinRows();
    const max = this.fitMaxRows();
    let fit = Math.min(max, Math.max(min, Math.floor(raw)));

    // Hysteresis: when the new fit is one row off the last and the container
    // sits right on the boundary (within DEADBAND of an integer), hold the
    // previous fit. That stops a knife-edge width — floor() flipping on
    // sub-pixel resize jitter or the paginator/scrollbar toggling the height —
    // from ping-ponging the page size (the "flicker"). Genuine multi-row jumps
    // and the first measurement bypass it.
    if (this.lastFit !== null && Math.abs(fit - this.lastFit) === 1) {
      const frac = raw - Math.floor(raw);
      const barelyGrew = fit > this.lastFit && frac < FitRowsDirective.DEADBAND;
      const barelyShrank = fit < this.lastFit && 1 - frac < FitRowsDirective.DEADBAND;
      if (barelyGrew || barelyShrank) fit = this.lastFit;
    }

    if (fit !== this.lastFit) {
      this.lastFit = fit;
      this.fitRows.emit(fit);
    }
  }

  /**
   * The row PITCH in px — the vertical stride from one row to the next,
   * INCLUDING the inter-row spacing (margin or flex/grid gap). A single row's
   * `getBoundingClientRect().height` is the border box and OMITS the margin,
   * so `floor(container / height)` packs one row too many and grows a
   * scrollbar (worse on short rows, where the per-row error accumulates past a
   * row boundary). The top-to-top distance of two consecutive rows is the true
   * stride. Falls back to one row's border box plus its own vertical margins,
   * then to `fitFallbackRowPx` before any row has rendered.
   */
  private rowStride(rows: NodeListOf<HTMLElement>): number {
    if (rows.length >= 2) {
      const stride = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
      if (stride > 0) return stride;
    }
    if (rows.length >= 1) {
      const style = getComputedStyle(rows[0]);
      const margins = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      const height = rows[0].getBoundingClientRect().height + (margins || 0);
      if (height > 0) return height;
    }
    return this.fitFallbackRowPx();
  }
}
