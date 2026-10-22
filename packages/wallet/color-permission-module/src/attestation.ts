// BRC-207 attested profile v1: the admission attestation statement, its BRC-42 signing key,
// and strict parsing and verification (0207:250-275, contract §3, C.0 at 0207:10224-10264).
//
// BSV Chronicle: signatures are never normalized. Both low-S and high-S encodings verify;
// only strict DER is required, by byte-for-byte round trip.

import { PrivateKey, PublicKey, Signature } from '@bsv/sdk'
import { toArray } from '@bsv/sdk/primitives/utils'
import { AttestationEvidenceError } from './errors.js'
import { parseAssetId, validateIdentityKey } from './identifiers.js'
import type { ColorAttestation } from './profiles.js'
import { exactMembers, type JsonValue } from './strictJson.js'
import type { AttestedAdmittance } from './types.js'

/** The built-in attested processing profile (0207:250). */
export const ATTESTED_PROFILE_ID = 'https://brc.dev/207/attested'

/** BRC-43 protocol of the admission attestation signing key. */
export const ATTESTATION_PROTOCOL_ID: [2, 'color admission attestation'] = [
  2,
  'color admission attestation'
]

/** BRC-43 key ID of the admission attestation signing key. */
export const ATTESTATION_KEY_ID = '1'

/** Output tag of a token credited offline: received without a verified attestation frontier. */
export const COLOR_OFFLINE_TAG = 'color_offline'

/** BRC-43 invoice number `<level>-<protocol>-<keyID>` of the signing key. */
const ATTESTATION_INVOICE = `${ATTESTATION_PROTOCOL_ID[0]}-${ATTESTATION_PROTOCOL_ID[1]}-${ATTESTATION_KEY_ID}`

/** The BRC-43 counterparty `anyone` is the private key 1. */
const ANYONE = new PrivateKey(1)

const TXID = /^[0-9a-f]{64}$/
const LOWER_HEX = /^(?:[0-9a-f]{2})+$/
const COLOR_TOPIC_PREFIX = 'tm_color_'
const UINT32_MAX = 0xffffffff
/** A strict-DER secp256k1 signature is at most 72 bytes. */
const MAX_DER_HEX = 144
const MEMBERS = ['txid', 'outputs', 'signer', 'signature'] as const

/** Runs `check`, rethrowing any failure as an `AttestationEvidenceError`. */
function evidence<T>(check: () => T): T {
  try {
    return check()
  } catch (error) {
    if ((error as Error | undefined)?.name === 'AttestationEvidenceError') throw error
    throw new AttestationEvidenceError(String((error as Error | undefined)?.message ?? error))
  }
}

function checkTxid(txid: unknown): string {
  if (typeof txid !== 'string' || !TXID.test(txid)) {
    throw new AttestationEvidenceError('txid must be 64 lowercase hex')
  }
  return txid
}

/** Non-empty, strictly ascending (so unique) uint32 indexes; returns a copy. */
function checkOutputs(outputs: unknown): number[] {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new AttestationEvidenceError('outputs must be a non-empty array')
  }
  let previous = -1
  for (const index of outputs) {
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      Object.is(index, -0) ||
      index < 0 ||
      index > UINT32_MAX
    ) {
      throw new AttestationEvidenceError('outputs must be integers in 0..2^32-1')
    }
    if (index <= previous) {
      throw new AttestationEvidenceError('outputs must be unique and strictly ascending')
    }
    previous = index
  }
  return [...(outputs as number[])]
}

/**
 * A compressed, lowercase, on-curve identity key in canonical form. `PublicKey.fromString`
 * reduces an x coordinate at or above the field prime instead of rejecting it, so the key must
 * also re-encode to the exact input (`02` + `ff`×32 would otherwise pass as another point).
 */
function checkSigner(signer: unknown): PublicKey {
  return evidence(() => {
    const text = validateIdentityKey(signer, 'attestation signer')
    const key = PublicKey.fromString(text)
    if (key.toString() !== text) {
      throw new AttestationEvidenceError('attestation signer is not a canonical curve point')
    }
    return key
  })
}

/** Lowercase strict-DER hex: parsing and re-encoding must reproduce the exact bytes. */
function checkSignature(signature: unknown): Signature {
  if (
    typeof signature !== 'string' ||
    signature.length > MAX_DER_HEX ||
    !LOWER_HEX.test(signature)
  ) {
    throw new AttestationEvidenceError('signature must be lowercase strict-DER hex')
  }
  const parsed = evidence(() => Signature.fromDER(signature, 'hex'))
  if (parsed.toDER('hex') !== signature) {
    throw new AttestationEvidenceError('signature is not strict DER')
  }
  return parsed
}

/**
 * The exact attested statement (no newline):
 * `1color-admit:v1:tm_color_<assetId>:<txid>:<outputs joined by ",">`.
 * Throws `AttestationEvidenceError` on a non-canonical asset ID, txid or output list.
 */
export function attestationMessage(
  assetId: string,
  txid: string,
  outputs: readonly number[]
): string {
  evidence(() => parseAssetId(assetId))
  checkTxid(txid)
  const canonical = checkOutputs(outputs)
  return `1color-admit:v1:${COLOR_TOPIC_PREFIX}${assetId}:${txid}:${canonical.join(',')}`
}

/**
 * The BRC-42 child of `signer` for invoice `2-color admission attestation-1`, counterparty
 * `anyone`. Attestations verify only against this key, never against the bare identity key.
 */
export function attestationSigningKey(signer: string): PublicKey {
  return checkSigner(signer).deriveChild(ANYONE, ATTESTATION_INVOICE)
}

/**
 * Parses an attestation: exactly `{txid, outputs, signer, signature}`, canonical outputs,
 * lowercase hex, an on-curve compressed signer and strict DER. Throws `AttestationEvidenceError`.
 * Returns a fresh object; the signature is kept exactly as given (never normalized).
 */
export function parseAttestation(value: JsonValue): ColorAttestation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AttestationEvidenceError('attestation must be a JSON object')
  }
  evidence(() => exactMembers(value, MEMBERS, [], 'attestation'))
  const txid = checkTxid(value.txid)
  const outputs = checkOutputs(value.outputs)
  checkSigner(value.signer)
  checkSignature(value.signature)
  return { txid, outputs, signer: value.signer as string, signature: value.signature as string }
}

/**
 * True when `att` is a canonical attestation whose signature verifies, under the signer's
 * derived child key, over the statement for `assetId`. Accepts low-S and high-S. Never throws.
 */
export function verifyAttestation(att: ColorAttestation, assetId: string): boolean {
  try {
    const parsed = parseAttestation(att as unknown as JsonValue)
    const message = attestationMessage(assetId, parsed.txid, parsed.outputs)
    const signature = checkSignature(parsed.signature)
    // PublicKey.verify hashes the message with SHA-256 once, as the statement requires.
    return attestationSigningKey(parsed.signer).verify(toArray(message, 'utf8'), signature)
  } catch {
    return false
  }
}

/**
 * Maps a BRC-22 STEAK entry for `topic` (`tm_color_<assetId>`) of the submitted `txid` to an
 * attestation (0175:79). Returns undefined when the entry carries no attestation (either field
 * absent); otherwise the entry must parse canonically, or `AttestationEvidenceError` is thrown.
 * The result is parsed, not verified: callers run `verifyAttestation` and their trust rules.
 */
export function attestationFromSteak(
  txid: string,
  topic: string,
  entry: AttestedAdmittance
): ColorAttestation | undefined {
  if (typeof topic !== 'string' || !topic.startsWith(COLOR_TOPIC_PREFIX)) {
    throw new AttestationEvidenceError(`${String(topic)} is not a 1Color asset topic`)
  }
  evidence(() => parseAssetId(topic.slice(COLOR_TOPIC_PREFIX.length)))
  if (entry === null || typeof entry !== 'object') {
    throw new AttestationEvidenceError(`the ${topic} STEAK entry must be an object`)
  }
  const { admissionSignature: signature, admissionIdentityKey: signer } = entry
  if (signature === undefined || signature === null || signer === undefined || signer === null) {
    return undefined
  }
  return parseAttestation({
    txid,
    outputs: entry.outputsToAdmit,
    signer,
    signature
  } as unknown as JsonValue)
}
