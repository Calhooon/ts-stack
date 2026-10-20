/**
 * Certificates issued before @bsv/sdk 2.8.0 may carry a `type` that is not
 * the BRC-52 32 bytes: nothing bounded it, and @bsv/simple before 0.6 derived
 * the type from a schema identifier. Their signatures cover the historical
 * serialization, which wrote the decoded type bytes without padding or a
 * length prefix. `verify()` stays canonical; `verifyHistoricalSignature()` is
 * the explicit recovery-only check for such a record
 * (bsv-blockchain/ts-stack#1085).
 */
import { Certificate } from '../../../auth/index'
import { CompletedProtoWallet } from './CompletedProtoWallet'
import { historicalPreimage, signHistorically } from './historicalCertificateSigning'
import { Utils, PrivateKey } from '../../../primitives/index'

const typeOf = (length: number): string =>
  Utils.toBase64(Array.from({ length }, (_, index) => (index % 251) + 1))
const legacyType = typeOf(16)
const canonicalType = typeOf(32)
const serialNumber = Utils.toBase64(Array.from({ length: 32 }).fill(2) as number[])
const subjectPublicKey = PrivateKey.fromRandom().toPublicKey().toString()
const certifierPrivateKey = PrivateKey.fromRandom()
const certifierPublicKey = certifierPrivateKey.toPublicKey().toString()
const certifierWallet = new CompletedProtoWallet(certifierPrivateKey)
const revocationOutpoint = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef.1'
const fields = { email: 'ZW5jcnlwdGVk', name: 'QWxpY2U=' }

function certificateWithType(type: string): Certificate {
  return new Certificate(
    type,
    serialNumber,
    subjectPublicKey,
    certifierPublicKey,
    revocationOutpoint,
    { ...fields }
  )
}

/** A lenient decoder's view of the type string, for signing invalid spellings. */
function leniently(type: string): number[] {
  try {
    return Utils.toArray(type, 'base64')
  } catch {
    return []
  }
}

/** Same bytes as `canonical`, spelled with a non-zero padding bit in the last character. */
function nonCanonicalSpelling(canonical: string): string {
  const body = canonical.replace(/=+$/, '')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const last = alphabet.indexOf(body[body.length - 1])
  // 16 bytes leave two data bits in the final sextet; set a padding bit below them.
  const altered = alphabet[last | 0b000001]
  return `${body.slice(0, -1)}${altered}${canonical.slice(body.length)}`
}

describe('Certificate.verifyHistoricalSignature', () => {
  it.each([
    ['1-byte', typeOf(1)],
    ['16-byte', legacyType],
    ['39-byte (schema identifier)', typeOf(39)],
    ['128-byte', typeOf(128)]
  ])(
    'accepts a %s type signed over the historical serialization that verify() rejects',
    async (_name, type) => {
      const certificate = certificateWithType(type)
      await signHistorically(certificate, Utils.toArray(type, 'base64'), certifierWallet)

      await expect(certificate.verify()).resolves.toBe(false)
      await expect(certificate.verifyHistoricalSignature()).resolves.toBe(true)
    }
  )

  it('agrees with verify() for a canonical 32-byte type', async () => {
    const certificate = certificateWithType(canonicalType)
    await certificate.sign(certifierWallet)

    await expect(certificate.verify()).resolves.toBe(true)
    await expect(certificate.verifyHistoricalSignature()).resolves.toBe(true)
  })

  it('rejects a tampered field', async () => {
    const certificate = certificateWithType(legacyType)
    await signHistorically(certificate, Utils.toArray(legacyType, 'base64'), certifierWallet)
    certificate.fields.name = 'TWFsbG9yeQ=='

    await expect(certificate.verifyHistoricalSignature()).resolves.toBe(false)
  })

  it('does not accept a signature made over a zero-padded type', async () => {
    const certificate = certificateWithType(legacyType)
    const padded = [...Utils.toArray(legacyType, 'base64'), ...Array.from({ length: 16 }, () => 0)]
    await signHistorically(certificate, padded, certifierWallet)

    await expect(certificate.verifyHistoricalSignature()).resolves.toBe(false)
  })

  it.each([
    ['129-byte', typeOf(129)],
    ['empty', ''],
    ['non-canonical spelling', nonCanonicalSpelling(legacyType)],
    ['non-base64', 'not*base64']
  ])(
    'treats a %s type as unverifiable even when its own preimage was signed',
    async (_name, type) => {
      const certificate = certificateWithType(type)
      // Sign exactly what a lenient verifier would reconstruct for this spelling,
      // so only the type validation can make verification fail.
      await signHistorically(certificate, leniently(type), certifierWallet)

      await expect(certificate.verifyHistoricalSignature()).resolves.toBe(false)
    }
  )

  it('leaves signing, binary serialization and parsing canonical', async () => {
    const certificate = certificateWithType(legacyType)

    await expect(certificate.sign(certifierWallet)).rejects.toThrow('type')
    expect(() => certificate.toBinary()).toThrow('type')
    const historical = historicalPreimage(certificate, Utils.toArray(legacyType, 'base64'))
    expect(() => Certificate.fromBinary(historical)).toThrow()
  })
})
