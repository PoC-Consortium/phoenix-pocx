/**
 * Sanitize a `returnTo` query param used to chain wallet onboarding back
 * into the flow that launched it (e.g. the mining setup wizard).
 *
 * Only app-internal absolute paths are accepted: the value must start with
 * a single '/'. Anything else (external URLs, protocol-relative '//',
 * relative paths) is rejected so the param can never redirect outside the
 * app shell.
 */
export function sanitizeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
