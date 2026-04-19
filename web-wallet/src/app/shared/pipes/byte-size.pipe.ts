import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a byte count as a human-readable size.
 *
 * Usage: {{ block.size | byteSize }} → "1023 B", "1.23 KB", "4.56 MB", "7.89 GB"
 */
@Pipe({ name: 'byteSize', standalone: true })
export class ByteSizePipe implements PipeTransform {
  transform(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
}
