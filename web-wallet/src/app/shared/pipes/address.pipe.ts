import { Pipe, PipeTransform } from '@angular/core';

/**
 * Address formatting options
 */
export interface AddressFormatOptions {
  /** Show shortened form (first 4 + ... + last 4 characters) */
  shortForm?: boolean;
  /** Number of characters to show at start (default: 4) */
  startChars?: number;
  /** Number of characters to show at end (default: 4) */
  endChars?: number;
}

/**
 * Shortens a string by showing first and last N characters.
 */
function shortenString(str: string, startChars: number = 4, endChars: number = 4): string {
  const minLength = startChars + endChars + 3; // 3 for "..."
  if (str.length <= minLength) {
    return str;
  }
  return `${str.slice(0, startChars)}...${str.slice(-endChars)}`;
}

/**
 * Formats a Bitcoin address.
 *
 * @param address - The address to format
 * @param options - Formatting options
 * @returns Formatted address string
 */
export function formatBtcAddress(
  address: string | null | undefined,
  options: AddressFormatOptions = {}
): string {
  if (!address) {
    return '';
  }

  const { shortForm = false, startChars = 4, endChars = 4 } = options;

  if (shortForm) {
    return shortenString(address, startChars, endChars);
  }

  return address;
}

/**
 * Validates if a string looks like a Bitcoin address.
 * Basic validation - checks prefix and length.
 */
export function isValidBitcoinAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Mainnet addresses
  // P2PKH: starts with 1, length 25-34
  // P2SH: starts with 3, length 25-34
  // Bech32: starts with bc1, length 42-62

  // Testnet addresses
  // P2PKH: starts with m or n
  // P2SH: starts with 2
  // Bech32: starts with tb1

  const mainnetP2PKH = /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const mainnetP2SH = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const mainnetBech32 = /^bc1[a-z0-9]{39,59}$/;

  const testnetP2PKH = /^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const testnetP2SH = /^2[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const testnetBech32 = /^tb1[a-z0-9]{39,59}$/;

  return (
    mainnetP2PKH.test(address) ||
    mainnetP2SH.test(address) ||
    mainnetBech32.test(address) ||
    testnetP2PKH.test(address) ||
    testnetP2SH.test(address) ||
    testnetBech32.test(address)
  );
}

/**
 * Detects the type of a Bitcoin address.
 */
export function getBitcoinAddressType(
  address: string
): 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2tr' | 'unknown' {
  if (!address) return 'unknown';

  // Bech32m (P2TR/Taproot) - bc1p or tb1p
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
    return 'p2tr';
  }

  // Bech32 (P2WPKH) - bc1q or tb1q
  if (address.startsWith('bc1') || address.startsWith('tb1')) {
    return 'p2wpkh';
  }

  // P2SH - starts with 3 (mainnet) or 2 (testnet)
  if (address.startsWith('3') || address.startsWith('2')) {
    return 'p2sh';
  }

  // P2PKH - starts with 1 (mainnet) or m/n (testnet)
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
    return 'p2pkh';
  }

  return 'unknown';
}

/**
 * AddressPipe formats Bitcoin addresses in templates.
 *
 * Usage:
 * {{ address | address }}              → full address
 * {{ address | address:true }}         → "bc1q...wxyz" (shortened)
 * {{ address | address:true:6:6 }}     → "bc1qab...uvwxyz" (custom length)
 */
@Pipe({
  name: 'address',
  standalone: true,
  pure: true,
})
export class AddressPipe implements PipeTransform {
  transform(
    address: string | null | undefined,
    shortForm: boolean = false,
    startChars: number = 4,
    endChars: number = 4
  ): string {
    return formatBtcAddress(address, { shortForm, startChars, endChars });
  }
}
