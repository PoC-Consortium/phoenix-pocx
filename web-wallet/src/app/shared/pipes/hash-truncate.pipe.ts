import { Pipe, PipeTransform } from '@angular/core';

/**
 * Truncates a long hex string (hash, txid, address) with a middle ellipsis,
 * preserving the leading and trailing characters so the value is still
 * visually recognisable.
 *
 * Returns the input unchanged when it's already short enough that
 * truncating would produce a longer string.
 */
export function truncateHash(
  hash: string | null | undefined,
  startChars: number = 16,
  endChars: number = 12
): string {
  if (!hash) return '';
  if (hash.length <= startChars + endChars + 3) return hash;
  return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
}

/**
 * Usage: {{ txid | hashTruncate }}        → "abcdef0123456789...fedcba987654"
 *        {{ txid | hashTruncate:8:8 }}    → "abcdef01...87654321"
 */
@Pipe({ name: 'hashTruncate', standalone: true })
export class HashTruncatePipe implements PipeTransform {
  transform(hash: string | null | undefined, startChars: number = 16, endChars: number = 12): string {
    return truncateHash(hash, startChars, endChars);
  }
}
