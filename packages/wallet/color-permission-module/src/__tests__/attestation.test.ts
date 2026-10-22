import { describe, expect, it } from '@jest/globals'
import { Hash, PrivateKey, ProtoWallet, PublicKey } from '@bsv/sdk'
import { toArray, toHex } from '@bsv/sdk/primitives/utils'
import {
  ATTESTATION_KEY_ID,
  ATTESTATION_PROTOCOL_ID,
  ATTESTED_PROFILE_ID,
  COLOR_OFFLINE_TAG,
  attestationFromSteak,
  attestationMessage,
  attestationSigningKey,
  parseAttestation,
  verifyAttestation
} from '../attestation.js'
import type { ColorAttestation } from '../profiles.js'
import type { JsonValue } from '../strictJson.js'
import { C0, signAttestation } from './profileFixtures.js'

const PRIV = new PrivateKey(C0.PRIV)
const { SIGNER, CHILD, DIGEST, TWEAK, ASSET, TXID, LOW_S, HIGH_S, MESSAGE } = C0
const TOPIC = `tm_color_${ASSET}`
const OTHER_ASSET = `${'11'.repeat(32)}_0`

const attestation = (
  patch: Partial<Record<keyof ColorAttestation, unknown>> = {}
): ColorAttestation =>
  ({ txid: TXID, outputs: [0, 2], signer: SIGNER, signature: LOW_S, ...patch }) as ColorAttestation

const evidenceError = expect.objectContaining({
  name: 'AttestationEvidenceError',
  message: expect.stringMatching(/^\[AttestationEvidenceError\] BRC-207: /)
})

async function signWith(
  data: string,
  keyID: string,
  protocol = 'color admission attestation'
): Promise<string> {
  const { signature } = await new ProtoWallet(PRIV).createSignature({
    data: toArray(data, 'utf8'),
    protocolID: [2, protocol],
    keyID,
    counterparty: 'anyone'
  })
  return toHex(signature)
}

describe('C.0 attestation vectors', () => {
  it('pins the profile constants', () => {
    expect(ATTESTED_PROFILE_ID).toBe('https://brc.dev/207/attested')
    expect(ATTESTATION_PROTOCOL_ID).toEqual([2, 'color admission attestation'])
    expect(ATTESTATION_KEY_ID).toBe('1')
    expect(COLOR_OFFLINE_TAG).toBe('color_offline')
  })

  it('builds the exact message and digest', () => {
    expect(attestationMessage(ASSET, TXID, [0, 2])).toBe(MESSAGE)
    expect(toHex(Hash.sha256(toArray(MESSAGE, 'utf8')))).toBe(DIGEST)
  })

  it('derives the BRC-42 child for invoice 2-color admission attestation-1', () => {
    expect(PRIV.toPublicKey().toString()).toBe(SIGNER)
    expect(attestationSigningKey(SIGNER).toString()).toBe(CHILD)
  })

  it('reproduces the BRC-42 HMAC tweak (contract §3: every C.0 suite)', () => {
    // counterparty 'anyone' is the private key 1
    const shared = new PrivateKey(1).deriveSharedSecret(PublicKey.fromString(SIGNER))
    expect(toHex(Hash.sha256hmac(shared.encode(true), toArray(C0.INVOICE, 'utf8')))).toBe(TWEAK)
  })

  it('reproduces the low-S signature with ProtoWallet (RFC 6979)', async () => {
    expect(await signWith(MESSAGE, ATTESTATION_KEY_ID)).toBe(LOW_S)
    expect(await signAttestation(PRIV, ASSET, TXID, [0, 2])).toEqual(attestation())
  })

  it('accepts both low-S and high-S without normalizing', async () => {
    for (const signature of [LOW_S, HIGH_S]) {
      expect(verifyAttestation(attestation({ signature }), ASSET)).toBe(true)
      expect(parseAttestation(attestation({ signature }) as unknown as JsonValue).signature).toBe(
        signature
      )
      // The contract §3 equivalent form agrees on both encodings.
      const { valid } = await new ProtoWallet('anyone').verifySignature({
        data: toArray(MESSAGE, 'utf8'),
        signature: toArray(signature, 'hex'),
        protocolID: [2, 'color admission attestation'],
        keyID: '1',
        counterparty: SIGNER
      })
      expect(valid).toBe(true)
    }
  })

  it.each([
    ['reordered outputs', { outputs: [2, 0] }],
    ['missing index 2', { outputs: [0] }],
    ['an extra index', { outputs: [0, 1, 2] }],
    ['another txid', { txid: 'ab'.repeat(32) }]
  ])('fails for %s', (_, patch) => {
    expect(verifyAttestation(attestation(patch), ASSET)).toBe(false)
  })

  it('fails for another topic, key ID 2, a trailing newline and the bare key', async () => {
    expect(verifyAttestation(attestation(), OTHER_ASSET)).toBe(false)
    expect(verifyAttestation(attestation(), `${ASSET.slice(0, 64)}_1`)).toBe(false)

    const keyIdTwo = await signWith(MESSAGE, '2')
    expect(keyIdTwo).not.toBe(LOW_S)
    expect(verifyAttestation(attestation({ signature: keyIdTwo }), ASSET)).toBe(false)

    const newline = await signWith(`${MESSAGE}\n`, '1')
    expect(verifyAttestation(attestation({ signature: newline }), ASSET)).toBe(false)

    const otherProtocol = await signWith(MESSAGE, '1', 'color admission attestations')
    expect(verifyAttestation(attestation({ signature: otherProtocol }), ASSET)).toBe(false)

    // BRC-175's raw-key construction: SHA-256 once, signed by the bare identity key.
    const bare = PRIV.sign(MESSAGE, 'utf8').toDER('hex') as string
    expect(PRIV.toPublicKey().verify(MESSAGE, PRIV.sign(MESSAGE, 'utf8'), 'utf8')).toBe(true)
    expect(verifyAttestation(attestation({ signature: bare }), ASSET)).toBe(false)

    // A valid signature by another identity does not verify for this signer.
    const other = await signAttestation(new PrivateKey(5556), ASSET, TXID, [0, 2])
    expect(verifyAttestation(other, ASSET)).toBe(true)
    expect(verifyAttestation(attestation({ signature: other.signature }), ASSET)).toBe(false)
    expect(verifyAttestation(attestation({ signer: other.signer }), ASSET)).toBe(false)
  })

  it.each([
    ['an invalid asset ID', attestation(), 'not-an-asset'],
    ['an uppercase signer', attestation({ signer: SIGNER.toUpperCase() }), ASSET],
    ['a signer off the curve', attestation({ signer: `02${'ff'.repeat(32)}` }), ASSET],
    ['a non-strict DER signature', attestation({ signature: `${LOW_S}00` }), ASSET],
    ['a non-hex signature', attestation({ signature: 'zz' }), ASSET],
    ['an unknown member', { ...attestation(), extra: 1 } as ColorAttestation, ASSET],
    [
      'a missing member',
      { txid: TXID, outputs: [0, 2], signer: SIGNER } as ColorAttestation,
      ASSET
    ],
    ['null', null as unknown as ColorAttestation, ASSET],
    ['non-array outputs', attestation({ outputs: '0,2' }), ASSET]
  ])('verify returns false and never throws for %s', (_, att, assetId) => {
    expect(verifyAttestation(att, assetId)).toBe(false)
  })

  it('parses exact canonical JSON and rejects everything else', () => {
    const value = attestation() as unknown as JsonValue
    expect(parseAttestation(value)).toEqual(attestation())
    // The result is a fresh copy that does not alias the input.
    const parsed = parseAttestation(value)
    parsed.outputs.push(9)
    expect((value as { outputs: number[] }).outputs).toEqual([0, 2])
    expect(
      parseAttestation({ ...attestation(), outputs: [4294967295] } as unknown as JsonValue).outputs
    ).toEqual([4294967295])
  })

  it.each<[string, unknown]>([
    ['an unknown member', { ...attestation(), extra: 1 }],
    ['a missing signature', { txid: TXID, outputs: [0, 2], signer: SIGNER }],
    ['null', null],
    ['an array', [attestation()]],
    ['a string', 'attestation'],
    ['outputs [2,0]', attestation({ outputs: [2, 0] })],
    ['outputs [0,0]', attestation({ outputs: [0, 0] })],
    ['outputs []', attestation({ outputs: [] })],
    ['outputs [1.5]', attestation({ outputs: [1.5] })],
    ['outputs [-1]', attestation({ outputs: [-1] })],
    ['outputs [-0]', attestation({ outputs: [-0] })],
    ['outputs [2^32]', attestation({ outputs: [4294967296] })],
    ['outputs ["0"]', attestation({ outputs: ['0'] })],
    ['outputs not an array', attestation({ outputs: 0 })],
    ['an uppercase txid', attestation({ txid: TXID.toUpperCase() })],
    ['a short txid', attestation({ txid: TXID.slice(2) })],
    ['a numeric txid', attestation({ txid: 5 })],
    ['an uppercase signature', attestation({ signature: LOW_S.toUpperCase() })],
    ['a signer not on curve', attestation({ signer: `02${'ff'.repeat(32)}` })],
    [
      'an uncompressed signer',
      attestation({ signer: PRIV.toPublicKey().toString().replace(/^02/, '04') })
    ],
    ['non-strict DER (trailing byte)', attestation({ signature: `${LOW_S}00` })],
    [
      'non-strict DER (padded R)',
      attestation({ signature: LOW_S.replace('3045022100d1', '304602220000d1') })
    ],
    // Signature.fromDER accepts a negative (unpadded) R; only the round trip rejects it.
    [
      'non-strict DER (negative R)',
      attestation({ signature: LOW_S.replace('3045022100d1', '30440220d1') })
    ],
    ['an empty signature', attestation({ signature: '' })],
    ['an odd-length signature', attestation({ signature: LOW_S.slice(1) })],
    ['an oversized signature', attestation({ signature: `30${'00'.repeat(80)}` })],
    ['a numeric signature', attestation({ signature: 1 })]
  ])('parseAttestation rejects %s', (_, value) => {
    expect(() => parseAttestation(value as JsonValue)).toThrow(evidenceError)
  })

  it.each<[string, string, string, number[]]>([
    ['an invalid asset ID', `${'AB'.repeat(32)}_0`, TXID, [0]],
    ['a non-canonical asset vout', `${'ab'.repeat(32)}_01`, TXID, [0]],
    ['an uppercase txid', ASSET, TXID.toUpperCase(), [0]],
    ['empty outputs', ASSET, TXID, []],
    ['unsorted outputs', ASSET, TXID, [2, 0]],
    ['duplicate outputs', ASSET, TXID, [1, 1]],
    ['a fractional output', ASSET, TXID, [0.5]],
    ['an output above 2^32-1', ASSET, TXID, [4294967296]]
  ])('attestationMessage throws for %s', (_, assetId, txid, outputs) => {
    expect(() => attestationMessage(assetId, txid, outputs)).toThrow(evidenceError)
  })

  it('attestationSigningKey rejects an invalid signer', () => {
    expect(() => attestationSigningKey('02')).toThrow(evidenceError)
    expect(() => attestationSigningKey(`02${'ff'.repeat(32)}`)).toThrow(evidenceError)
  })

  it('maps a BRC-22 STEAK entry', () => {
    expect(
      attestationFromSteak(TXID, TOPIC, {
        outputsToAdmit: [0, 2],
        coinsToRetain: [],
        admissionSignature: LOW_S,
        admissionIdentityKey: SIGNER
      })
    ).toEqual(attestation())
    expect(
      attestationFromSteak(TXID, TOPIC, { outputsToAdmit: [0], coinsToRetain: [] })
    ).toBeUndefined()
    expect(() =>
      attestationFromSteak(TXID, TOPIC, {
        outputsToAdmit: [2, 0],
        coinsToRetain: [],
        admissionSignature: LOW_S,
        admissionIdentityKey: SIGNER
      })
    ).toThrow(expect.objectContaining({ name: 'AttestationEvidenceError' }))
  })

  it('treats a STEAK entry missing either attestation field as unattested', () => {
    expect(
      attestationFromSteak(TXID, TOPIC, {
        outputsToAdmit: [0, 2],
        coinsToRetain: [],
        admissionSignature: LOW_S
      })
    ).toBeUndefined()
    expect(
      attestationFromSteak(TXID, TOPIC, {
        outputsToAdmit: [0, 2],
        coinsToRetain: [],
        admissionIdentityKey: SIGNER
      })
    ).toBeUndefined()
    expect(
      attestationFromSteak(TXID, TOPIC, {
        outputsToAdmit: [0, 2],
        coinsToRetain: [],
        admissionSignature: null,
        admissionIdentityKey: null
      } as never)
    ).toBeUndefined()
  })

  it('rejects malformed STEAK entries and non-color topics', () => {
    const entry = {
      outputsToAdmit: [0, 2],
      coinsToRetain: [],
      admissionSignature: LOW_S,
      admissionIdentityKey: SIGNER
    }
    for (const topic of [
      'tm_mandala',
      `tm_color_${ASSET.slice(0, 64)}`,
      'tm_color_',
      `ls_color_${ASSET}`
    ]) {
      expect(() => attestationFromSteak(TXID, topic, entry)).toThrow(evidenceError)
    }
    expect(() => attestationFromSteak(TXID, TOPIC, null as never)).toThrow(evidenceError)
    expect(() => attestationFromSteak(TXID, TOPIC, { ...entry, admissionSignature: '' })).toThrow(
      evidenceError
    )
    expect(() => attestationFromSteak(TXID.toUpperCase(), TOPIC, entry)).toThrow(evidenceError)
    expect(() =>
      attestationFromSteak(TXID, TOPIC, { ...entry, outputsToAdmit: undefined } as never)
    ).toThrow(evidenceError)
  })
})
