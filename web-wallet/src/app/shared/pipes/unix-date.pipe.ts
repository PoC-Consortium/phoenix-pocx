import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a Unix timestamp (seconds since epoch) as a locale date+time string.
 *
 * Usage: {{ block.time | unixDate }} → e.g. "11/14/2026, 10:32:14 AM"
 */
@Pipe({ name: 'unixDate', standalone: true })
export class UnixDatePipe implements PipeTransform {
  transform(timestampSeconds: number | null | undefined): string {
    if (timestampSeconds === null || timestampSeconds === undefined) return '';
    return new Date(timestampSeconds * 1000).toLocaleString();
  }
}
