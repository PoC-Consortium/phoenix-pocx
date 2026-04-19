import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a Unix timestamp (seconds since epoch) as a short relative time.
 *
 * Impure so repeated evaluations reflect the advancing clock.
 *
 * Usage: {{ block.time | timeAgo }} → "42s ago", "5m ago", "3h ago", "2d ago"
 */
@Pipe({ name: 'timeAgo', standalone: true, pure: false })
export class TimeAgoPipe implements PipeTransform {
  transform(timestampSeconds: number | null | undefined): string {
    if (timestampSeconds === null || timestampSeconds === undefined) return '';
    const diff = Math.floor(Date.now() / 1000) - timestampSeconds;
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
}
