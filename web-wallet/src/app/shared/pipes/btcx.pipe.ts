import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a BTCX amount as a raw 8-decimal number.
 *
 * Templates typically render the "BTCX" unit separately so this pipe
 * deliberately emits only the number.
 *
 * Usage: {{ amount | btcx }} → "1.23456789"
 */
@Pipe({ name: 'btcx', standalone: true })
export class BtcxPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '0.00000000';
    return value.toFixed(8);
  }
}
