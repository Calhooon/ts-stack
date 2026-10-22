/**
 * Orders strings by UTF-16 code unit, exactly as `Array.prototype.sort()` does without a compare
 * function. Txids, outpoints and keys are lowercase hex, so this is their canonical byte order;
 * unlike `localeCompare`, it never depends on the host locale.
 */
export function ordinal(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
