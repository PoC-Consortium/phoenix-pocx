import { Pipe, PipeTransform, inject, LOCALE_ID } from '@angular/core';
import { formatNumber } from '@angular/common';

/**
 * Bitcoin unit constants
 */
const SATOSHIS_PER_BTC = 100_000_000;
const CURRENCY_SYMBOL = 'BTC';

/**
 * Amount formatting options
 */
export interface AmountFormatOptions {
  /** Show short form (4 decimal places instead of 8) */
  shortForm?: boolean;
  /** Hide the currency unit */
  noUnit?: boolean;
  /** Hide thousand separators */
  noSeparator?: boolean;
  /** Override locale for number formatting */
  locale?: string;
}

/**
 * Formats a Bitcoin amount value.
 *
 * @param value - The amount to format (in BTC or satoshis)
 * @param locale - The locale for number formatting
 * @param options - Formatting options
 * @returns Formatted amount string
 */
export function formatBtcAmount(
  value: number | string,
  locale: string = 'en',
  options: AmountFormatOptions = {}
): string {
  const { shortForm = false, noUnit = false, noSeparator = false } = options;

  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(numValue)) {
    return noUnit ? '0' : `${CURRENCY_SYMBOL} 0`;
  }

  // Use 4 decimal places for short form, 8 for full precision
  const digitsInfo = shortForm ? '1.0-4' : '1.0-8';
  let formattedNumber = formatNumber(numValue, locale, digitsInfo);

  // Remove thousand separators if requested
  if (noSeparator) {
    // Remove commas, periods used as thousand separators, and spaces
    // Keep the decimal separator (last occurrence of . or ,)
    const parts = formattedNumber.split(/([.,])/);
    if (parts.length > 1) {
      // Find decimal separator (last . or , followed by digits only)
      const lastSepIndex = formattedNumber.search(/[.,]\d+$/);
      if (lastSepIndex > 0) {
        const intPart = formattedNumber.substring(0, lastSepIndex).replace(/[.,\s]/g, '');
        const decPart = formattedNumber.substring(lastSepIndex);
        formattedNumber = intPart + decPart;
      } else {
        formattedNumber = formattedNumber.replace(/[.,\s]/g, '');
      }
    }
  }

  return noUnit ? formattedNumber : `${CURRENCY_SYMBOL} ${formattedNumber}`;
}

/**
 * Converts satoshis to BTC
 */
export function satoshisToBtc(satoshis: number | string): number {
  const numValue = typeof satoshis === 'string' ? parseFloat(satoshis) : satoshis;
  return numValue / SATOSHIS_PER_BTC;
}

/**
 * Converts BTC to satoshis
 */
export function btcToSatoshis(btc: number | string): number {
  const numValue = typeof btc === 'string' ? parseFloat(btc) : btc;
  return Math.round(numValue * SATOSHIS_PER_BTC);
}

/**
 * AmountPipe formats Bitcoin amounts in templates.
 *
 * Usage:
 * {{ balance | amount }}                    → "BTC 1.23456789"
 * {{ balance | amount:'satoshis' }}         → "BTC 0.00000123" (converts from satoshis)
 * {{ balance | amount:'btc':true }}         → "BTC 1.2346" (short form)
 * {{ balance | amount:'btc':false:true }}   → "1.23456789" (no unit)
 *
 * @param value - The amount to format
 * @param inputType - 'satoshis' or 'btc' (default: 'btc')
 * @param shortForm - Show 4 decimal places instead of 8
 * @param noUnit - Hide the BTC symbol
 * @param noSeparator - Hide thousand separators
 */
@Pipe({
  name: 'amount',
  standalone: true,
  pure: false, // Impure to react to locale changes
})
export class AmountPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(
    value: number | string | null | undefined,
    inputType: 'satoshis' | 'btc' = 'btc',
    shortForm: boolean = false,
    noUnit: boolean = false,
    noSeparator: boolean = false
  ): string {
    if (value === null || value === undefined) {
      return noUnit ? '0' : `${CURRENCY_SYMBOL} 0`;
    }

    // Convert from satoshis to BTC if needed
    const btcValue =
      inputType === 'satoshis'
        ? satoshisToBtc(value)
        : typeof value === 'string'
          ? parseFloat(value)
          : value;

    return formatBtcAmount(btcValue, this.locale, { shortForm, noUnit, noSeparator });
  }
}
