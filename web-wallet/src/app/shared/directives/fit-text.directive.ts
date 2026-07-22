import {
  AfterViewInit,
  Directive,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  input,
} from '@angular/core';

/**
 * FitTextDirective — shrink the host's font-size until its content fits.
 *
 * Attach to a block/flex container whose text can overflow horizontally
 * (e.g. a large balance readout). Children that should scale must INHERIT
 * the font-size (don't give them their own px size); fixed-size children
 * (units, icons) are unaffected. Each measurement resets to the natural
 * CSS size, then steps down (px by px, floored at `fitTextMinPx`) until
 * `scrollWidth <= clientWidth` — so the text re-grows automatically when
 * space returns. Re-measures on container resize (ResizeObserver) and on
 * text changes (MutationObserver), coalesced to one pass per frame.
 */
@Directive({
  selector: '[appFitText]',
  standalone: true,
})
export class FitTextDirective implements AfterViewInit, OnDestroy {
  /** Smallest font-size the text may shrink to, px. */
  readonly fitTextMinPx = input(14);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private rafId: number | null = null;

  ngAfterViewInit(): void {
    // Both observers fire outside Angular's zone on purpose — fitting is a
    // pure style tweak, no change detection needed.
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
      this.resizeObserver.observe(this.el.nativeElement);
      this.mutationObserver = new MutationObserver(() => this.scheduleFit());
      this.mutationObserver.observe(this.el.nativeElement, {
        characterData: true,
        childList: true,
        subtree: true,
      });
      this.fit();
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private scheduleFit(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.fit();
    });
  }

  private fit(): void {
    const host = this.el.nativeElement;
    // Natural size first (also the re-grow path when space returned).
    host.style.fontSize = '';
    let size = parseFloat(getComputedStyle(host).fontSize);
    const min = this.fitTextMinPx();
    while (this.contentWidth(host) > host.clientWidth + 0.5 && size > min) {
      size -= 1;
      host.style.fontSize = `${size}px`;
    }
  }

  /**
   * True content width: the sum of the ELEMENT children's rendered widths
   * plus flex column-gaps. Deliberately NOT scrollWidth — a flex container
   * with `justify-content: flex-end` overflows at the START edge, which
   * scrollWidth does not report in LTR (it equals clientWidth), so
   * overflow would go undetected. Children must be elements (spans), not
   * bare text nodes.
   */
  private contentWidth(host: HTMLElement): number {
    let width = 0;
    for (const child of Array.from(host.children)) {
      width += (child as HTMLElement).getBoundingClientRect().width;
    }
    if (host.children.length > 1) {
      const gap = parseFloat(getComputedStyle(host).columnGap) || 0;
      width += gap * (host.children.length - 1);
    }
    return width;
  }
}
