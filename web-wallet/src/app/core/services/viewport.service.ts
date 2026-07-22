import { Injectable, Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';

/**
 * App-wide viewport tiers as signals — the TypeScript counterpart of
 * `src/_breakpoints.scss` (the SCSS mixins component styles use). The pixel
 * values MUST stay in lockstep with that file; change them together.
 *
 * Use this wherever LAYOUT LOGIC (not CSS) depends on a tier — e.g. the
 * mat-sidenav mode/opened bindings — so every shell keys on the same lines.
 * It replaces ad-hoc queries like CDK's `Breakpoints.Handset` (Material's
 * 599/959 device classes), which silently disagreed with our CSS tiers.
 */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly observer = inject(BreakpointObserver);

  /** <= 600px — single column / phone (SCSS `bp.phone`). */
  readonly phone = this.matches('(max-width: 600px)');

  /** <= 900px — desktop grid collapses to a stack (SCSS `bp.tablet-down`). */
  readonly tabletDown = this.matches('(max-width: 900px)');

  /** <= 1100px — widest multi-column drops a column (SCSS `bp.desktop-down`). */
  readonly desktopDown = this.matches('(max-width: 1100px)');

  /** <= 700px tall — short viewport, wide-but-short windows (SCSS `bp.short`). */
  readonly short = this.matches('(max-height: 700px)');

  /**
   * Menu (sidenav/drawer) behavior: OVERLAY (hamburger, closed by default)
   * up to the tablet tier; DOCKED-OPEN above it. Phones and tablet-portrait
   * get the overlay; tablet-landscape and desktop get the docked menu. Both
   * shells bind their mat-sidenav mode/opened to this one signal.
   */
  readonly menuOverlay = this.tabletDown;

  private matches(query: string): Signal<boolean> {
    return toSignal(this.observer.observe(query).pipe(map(result => result.matches)), {
      initialValue: this.observer.isMatched(query),
    });
  }
}
