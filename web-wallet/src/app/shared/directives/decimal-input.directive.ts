import { Directive, ElementRef, HostListener, Renderer2, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * DecimalInputDirective — a numeric value accessor over a TEXT input that
 * accepts BOTH `.` and `,` as the decimal separator.
 *
 * `<input type="number">` on Android only accepts the platform's own decimal
 * key (usually `.`); a typed `,` is dropped before Angular ever sees it, so
 * users on comma-locale keyboards can't enter amounts. This directive drives
 * a `type="text" inputmode="decimal"` field instead: it normalises `,`→`.`,
 * strips non-numeric characters, and exposes the parsed `number | null` to
 * `ngModel` — so every existing numeric calculation is untouched while both
 * separators work on desktop AND mobile.
 *
 * Usage: `<input matInput appDecimal inputmode="decimal" [(ngModel)]="amount" />`
 * (omit `type="number"` — the directive wants a text field).
 */
@Directive({
  selector: 'input[appDecimal]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DecimalInputDirective),
      multi: true,
    },
  ],
})
export class DecimalInputDirective implements ControlValueAccessor {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  @HostListener('input', ['$event'])
  handleInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    // Comma -> dot, drop anything that isn't a digit or dot, and collapse any
    // extra dots down to the first one ("1.2.3" -> "1.23").
    let cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot >= 0) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    // Reflect the sanitised text back so the field never shows a rejected
    // character (a typed `,` visibly becomes `.`).
    if (cleaned !== raw) {
      this.renderer.setProperty(this.el.nativeElement, 'value', cleaned);
    }
    const num = cleaned === '' || cleaned === '.' ? null : Number(cleaned);
    this.onChange(Number.isFinite(num as number) ? (num as number) : null);
  }

  @HostListener('blur')
  handleBlur(): void {
    this.onTouched();
  }

  writeValue(value: number | null): void {
    // Plain-decimal formatting (never exponential) so a small programmatic
    // value like 0.00000001 shows as "0.00000001", not "1e-8".
    const str =
      value === null || value === undefined || !Number.isFinite(value)
        ? ''
        : value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
    this.renderer.setProperty(this.el.nativeElement, 'value', str);
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.renderer.setProperty(this.el.nativeElement, 'disabled', isDisabled);
  }
}
