/**
 * Regression coverage for bsv-blockchain/ts-stack#1085.
 *
 * BRC-52 certificate types are exactly 32 bytes and every wallet certificate
 * argument keeps requiring that. A wallet may still hold a certificate issued
 * before @bsv/sdk 2.8.0 under a non-compliant type; such a record is left out
 * of `listCertificates` and discovery results instead of failing the whole
 * result, so applications that never used those types are unaffected and the
 * record can be swapped out through the wallet's recovery path.
 */
import {
  validateAcquireIssuanceCertificateArgs,
  validateListCertificatesArgs,
  validateProveCertificateArgs,
  validateRelinquishCertificateArgs
} from '../validationHelpers.js'
import { validateWalletResult } from '../WalletResultValidation.js'
import WalletWireProcessor from '../substrates/WalletWireProcessor.js'
import WalletWireTransceiver from '../substrates/WalletWireTransceiver.js'
import { WalletInterface } from '../Wallet.interfaces.js'
import * as Utils from '../../primitives/utils.js'

const PUBLIC_KEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const VERIFIER = '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const bytes = (length: number): string =>
  Utils.toBase64(Array.from({ length }, (_, index) => (index * 7 + 1) & 0xff))
const LEGACY_TYPE = bytes(16)
const LONG_LEGACY_TYPE = bytes(39)
const CANONICAL_TYPE = bytes(32)
const SERIAL_NUMBER = Utils.toBase64(Array.from({ length: 32 }).fill(2) as number[])
const OUTPOINT = `${'ab'.repeat(32)}.0`
const SIGNATURE = '3006020101020101'

const certificate = (type: string): Record<string, unknown> => ({
  type,
  serialNumber: SERIAL_NUMBER,
  subject: PUBLIC_KEY,
  certifier: PUBLIC_KEY,
  revocationOutpoint: OUTPOINT,
  signature: SIGNATURE,
  fields: {}
})

const discovered = (type: string): Record<string, unknown> => ({
  ...certificate(type),
  certifierInfo: {
    name: 'Certifier',
    iconUrl: 'https://certifier.example.com/icon.png',
    description: 'Trusted certifier',
    trust: 1
  },
  publiclyRevealedKeyring: {},
  decryptedFields: {}
})

describe('certificate type arguments stay canonical', () => {
  it.each([
    [
      'listCertificates',
      () => validateListCertificatesArgs({ certifiers: [], types: [LEGACY_TYPE] })
    ],
    [
      'relinquishCertificate',
      () =>
        validateRelinquishCertificateArgs({
          type: LEGACY_TYPE,
          serialNumber: SERIAL_NUMBER,
          certifier: PUBLIC_KEY
        })
    ],
    [
      'proveCertificate',
      () =>
        validateProveCertificateArgs({
          certificate: { type: LEGACY_TYPE },
          fieldsToReveal: [],
          verifier: VERIFIER
        })
    ],
    [
      'acquireCertificate',
      () =>
        validateAcquireIssuanceCertificateArgs({
          acquisitionProtocol: 'issuance',
          type: LEGACY_TYPE,
          certifier: PUBLIC_KEY,
          certifierUrl: 'https://certifier.example.com',
          fields: { name: 'Alice' }
        })
    ]
  ])('rejects a 16-byte type on %s with the exact length', (_call, validate) => {
    expect(validate).toThrow('exactly 32 bytes')
  })

  it('rejects an oversized type with the exact length', () => {
    expect(() =>
      validateListCertificatesArgs({ certifiers: [], types: [LONG_LEGACY_TYPE] })
    ).toThrow('exactly 32 bytes')
  })
})

describe('non-compliant certificates in list results', () => {
  it('are left out of an unfiltered listCertificates result with the total adjusted', () => {
    const result = validateWalletResult(
      'listCertificates',
      {
        totalCertificates: 3,
        certificates: [
          certificate(LEGACY_TYPE),
          certificate(CANONICAL_TYPE),
          certificate(LONG_LEGACY_TYPE)
        ]
      },
      { certifiers: [], types: [] }
    )
    expect(result.certificates.map(c => c.type)).toEqual([CANONICAL_TYPE])
    expect(result.totalCertificates).toBe(1)
  })

  it('reduce the total by the number left out, never below the entries kept', () => {
    const result = validateWalletResult(
      'listCertificates',
      { totalCertificates: 5, certificates: [certificate(LEGACY_TYPE)], limit: 1 },
      { certifiers: [], types: [], limit: 1 }
    )
    expect(result.certificates).toEqual([])
    expect(result.totalCertificates).toBe(4)
  })

  it('are left out of a discovery result', () => {
    const result = validateWalletResult(
      'discoverByIdentityKey',
      {
        totalCertificates: 2,
        certificates: [discovered(LEGACY_TYPE), discovered(CANONICAL_TYPE)]
      },
      { identityKey: PUBLIC_KEY }
    )
    expect(result.certificates.map(c => c.type)).toEqual([CANONICAL_TYPE])
    expect(result.totalCertificates).toBe(1)
  })

  it.each([
    ['a 129-byte type', { ...certificate(bytes(129)) }],
    [
      'a legacy type with a short serial number',
      { ...certificate(LEGACY_TYPE), serialNumber: LEGACY_TYPE }
    ],
    [
      'a legacy type with a malformed signature',
      { ...certificate(LEGACY_TYPE), signature: '3000' }
    ],
    [
      'a canonical type with a short serial number',
      { ...certificate(CANONICAL_TYPE), serialNumber: LEGACY_TYPE }
    ]
  ])('still reject the whole result for %s', (_name, entry) => {
    expect(() =>
      validateWalletResult(
        'listCertificates',
        { totalCertificates: 2, certificates: [entry, certificate(CANONICAL_TYPE)] },
        { certifiers: [], types: [] }
      )
    ).toThrow('canonical signed wallet certificate')
  })

  it('are still rejected on acquisition and proof results', () => {
    expect(() =>
      validateWalletResult('acquireCertificate', certificate(LEGACY_TYPE), {
        type: LEGACY_TYPE,
        certifier: PUBLIC_KEY
      })
    ).toThrow('canonical signed wallet certificate')
    expect(() =>
      validateWalletResult(
        'proveCertificate',
        { keyringForVerifier: {}, certificate: certificate(LEGACY_TYPE), verifier: VERIFIER },
        { fieldsToReveal: [], verifier: VERIFIER }
      )
    ).toThrow('canonical signed wallet certificate')
  })

  it('are left out of a listCertificates result on the binary wallet wire too', async () => {
    const processor = new WalletWireProcessor({
      listCertificates: async () => ({
        totalCertificates: 2,
        certificates: [certificate(LEGACY_TYPE), certificate(CANONICAL_TYPE)]
      })
    } as unknown as WalletInterface)
    const client = new WalletWireTransceiver(processor)

    const result = await client.listCertificates({ certifiers: [], types: [] })
    expect(result.certificates.map(c => c.type)).toEqual([CANONICAL_TYPE])
    expect(result.totalCertificates).toBe(1)
  })
})
