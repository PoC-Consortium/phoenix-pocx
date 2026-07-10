/**
 * Wallet-name helpers for the mobile create/restore flows.
 *
 * Mirrors the Rust-side rules (`btcx_wallet::config::validate_wallet_name`)
 * on the name that actually gets sent — the desktop create/import pages do
 * the same inline. Names become directory names, so they are restricted to
 * `[A-Za-z0-9_-]{1,32}`; case is preserved (Core parity: saved as stated)
 * while uniqueness is CASE-INSENSITIVE, because the wallet directories live
 * on case-insensitive filesystems on Windows/macOS.
 */

/** The local wallet store's naming rule (same regex as the desktop pages). */
export const WALLET_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Rust-side maximum name length (directory name cap). */
const MAX_NAME_LENGTH = 32;

/** Whether `name` violates the local store's naming rules (empty = valid: the caller substitutes a suggestion). */
export function isInvalidWalletName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !WALLET_NAME_PATTERN.test(trimmed);
}

/** Case-insensitive membership test against the existing wallet names. */
export function isWalletNameTaken(name: string, existing: string[]): boolean {
  const lower = name.trim().toLowerCase();
  return lower.length > 0 && existing.some(n => n.toLowerCase() === lower);
}

/**
 * Make `base` unique against `existing` (case-insensitive) by appending
 * `-2`, `-3`, … — truncating the base so the result stays within the
 * 32-char limit.
 */
export function dedupeWalletName(base: string, existing: string[]): string {
  const fit = (name: string) => name.slice(0, MAX_NAME_LENGTH);
  if (!isWalletNameTaken(fit(base), existing)) {
    return fit(base);
  }
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
    if (!isWalletNameTaken(candidate, existing)) {
      return candidate;
    }
  }
}

/**
 * Suggested name for a NEW wallet: 'default' — the name the backend's
 * name-less flow uses, so the first-run create stays byte-identical —
 * deduped once wallets exist ('default-2', …).
 */
export function suggestWalletName(existing: string[]): string {
  return dedupeWalletName('default', existing);
}

/**
 * Suggested name for the SECOND wallet of the dual-restore flow: the first
 * wallet's name qualified by the other branch's address family (e.g.
 * "Savings" → "Savings-taproot"), deduped against the registry.
 */
export function suggestSiblingWalletName(
  base: string,
  kind: 'bip84' | 'bip86',
  existing: string[]
): string {
  const suffix = kind === 'bip86' ? '-taproot' : '-segwit';
  const trimmedBase = base.slice(0, MAX_NAME_LENGTH - suffix.length);
  return dedupeWalletName(`${trimmedBase}${suffix}`, existing);
}
