import { PublicKey, RelinquishCertificateArgs, Utils, WERR_INVALID_PARAMETER } from '@bsv/sdk'
import { validateBase64String } from '@bsv/sdk/wallet/validationHelpers'

/**
 * A BRC-52 certificate type decodes to exactly 32 bytes and encodes to 44
 * base64 characters. Storage created before @bsv/sdk 2.8.0 may hold records
 * whose type does not; BRC-100 listings leave those out and the recovery API
 * finds them.
 */
export const CANONICAL_CERTIFICATE_TYPE_BASE64_LENGTH = 44

/** Largest legacy type the recovery API accepts, matching `@bsv/simple`'s legacy tolerance. */
export const MAX_LEGACY_CERTIFICATE_TYPE_BYTES = 128

/** True when `type` is canonical base64 that decodes to exactly 32 bytes. */
export function isCanonicalCertificateType(type: string): boolean {
  if (typeof type !== 'string' || type.length !== CANONICAL_CERTIFICATE_TYPE_BASE64_LENGTH) return false
  try {
    const decoded = Utils.toArray(type, 'base64')
    return decoded.length === 32 && Utils.toBase64(decoded) === type
  } catch {
    return false
  }
}

/**
 * Validates a reference to a stored certificate for the recovery API: the
 * type may be any canonical base64 of 1–128 bytes (a legacy record), while
 * the serial number and certifier keep their canonical forms.
 */
export function validateLegacyCertificateReference(args: RelinquishCertificateArgs): RelinquishCertificateArgs {
  if (args == null || typeof args !== 'object') throw new WERR_INVALID_PARAMETER('args', 'an object')
  const type = validateBase64String(args.type, 'type', 1, MAX_LEGACY_CERTIFICATE_TYPE_BYTES)
  const serialNumber = validateBase64String(args.serialNumber, 'serialNumber', 32, 32)
  if (typeof args.certifier !== 'string' || !/^0[23][0-9a-fA-F]{64}$/.test(args.certifier)) {
    throw new WERR_INVALID_PARAMETER('certifier', 'a compressed public key hex string')
  }
  try {
    PublicKey.fromString(args.certifier)
  } catch {
    throw new WERR_INVALID_PARAMETER('certifier', 'a valid compressed public key')
  }
  return { type, serialNumber, certifier: args.certifier }
}
