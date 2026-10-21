import { PrivateKey, Utils } from '@bsv/sdk'
import {
  CANONICAL_CERTIFICATE_TYPE_BASE64_LENGTH,
  MAX_LEGACY_CERTIFICATE_TYPE_BYTES,
  isCanonicalCertificateType,
  validateLegacyCertificateReference
} from '../methods/legacyCertificates'

const bytes = (length: number, fill = 7): string =>
  Utils.toBase64(Array.from({ length }, (_, index) => (index * fill + 1) & 0xff))
const canonicalType = bytes(32)
const legacyType = bytes(16)
const serialNumber = bytes(32, 3)
const certifier = PrivateKey.fromRandom().toPublicKey().toString()

/** Same bytes as `canonical`, spelled with a non-zero padding bit in the last character. */
function nonCanonicalSpelling(canonical: string): string {
  const body = canonical.replace(/=+$/, '')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const last = alphabet.indexOf(body[body.length - 1])
  // 32 bytes leave four data bits in the final sextet; set a padding bit below them.
  const altered = alphabet[last | 0b000001]
  return `${body.slice(0, -1)}${altered}${canonical.slice(body.length)}`
}

describe('isCanonicalCertificateType', () => {
  test('accepts canonical base64 of exactly 32 bytes', () => {
    expect(canonicalType).toHaveLength(CANONICAL_CERTIFICATE_TYPE_BASE64_LENGTH)
    expect(isCanonicalCertificateType(canonicalType)).toBe(true)
  })

  test.each([
    ['a 16-byte legacy type', legacyType],
    ['a 39-byte legacy type', bytes(39)],
    ['a non-canonical spelling of 32 bytes', nonCanonicalSpelling(canonicalType)],
    ['44 characters that are not base64', '*'.repeat(CANONICAL_CERTIFICATE_TYPE_BASE64_LENGTH)],
    ['a non-string', undefined as unknown as string]
  ])('rejects %s', (_name, type) => {
    expect(isCanonicalCertificateType(type)).toBe(false)
  })
})

describe('validateLegacyCertificateReference', () => {
  test('accepts a legacy type with a canonical serial number and certifier', () => {
    expect(validateLegacyCertificateReference({ type: legacyType, serialNumber, certifier })).toEqual({
      type: legacyType,
      serialNumber,
      certifier
    })
  })

  test('accepts the largest legacy type and a canonical type', () => {
    for (const type of [bytes(MAX_LEGACY_CERTIFICATE_TYPE_BYTES), canonicalType]) {
      expect(validateLegacyCertificateReference({ type, serialNumber, certifier }).type).toBe(type)
    }
  })

  test.each([
    ['missing args', undefined as unknown as { type: string; serialNumber: string; certifier: string }, 'args'],
    ['a type beyond the legacy bound', { type: bytes(129), serialNumber, certifier }, 'type'],
    ['an empty type', { type: '', serialNumber, certifier }, 'type'],
    ['a short serial number', { type: legacyType, serialNumber: legacyType, certifier }, 'serialNumber'],
    [
      'a certifier that is not compressed key hex',
      { type: legacyType, serialNumber, certifier: '00'.repeat(33) },
      'certifier'
    ],
    [
      'a certifier that is not on the curve',
      { type: legacyType, serialNumber, certifier: `02${'00'.repeat(32)}` },
      'certifier'
    ]
  ])('rejects %s', (_name, args, parameter) => {
    expect(() => validateLegacyCertificateReference(args)).toThrow(parameter)
  })
})
