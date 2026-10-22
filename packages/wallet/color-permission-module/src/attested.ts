// The built-in BRC-207 attested processing profile v1 (0207:166-189, 0207:435-445): its
// descriptor rules and handler. Evidence, coverage and frontier checks are applied by the module
// for assets whose resolution carries `attested`.

import { PublicKey } from '@bsv/sdk'
import { isProfileId, StrictCborLink } from '@bsv/templates'
import type { StrictCborMap, StrictCborValue } from '@bsv/templates'
import { ATTESTED_PROFILE_ID } from './attestation.js'
import { AttestationEvidenceError, ProfileParamsError } from './errors.js'
import { validateIdentityKey } from './identifiers.js'
import type {
  AttestedParams,
  ProfileDescriptor,
  RequiredProfileHandler,
  TrustMode
} from './profiles.js'

/** The attested receipt limit: the largest receipt the module parses (0207:1442-1448). */
const ATTESTED_MAX_RECEIPT_BYTES = 16_777_216
const TRUST_MODES: readonly TrustMode[] = ['any', 'same', 'all', 'identity']
const MEMBERS = new Set(['trustMode', 'identityKey', 'evidenceProfile'])

/** The handler property carrying `createAttestedProfile`'s `trustedIdentities` callback. */
export const TRUSTED_IDENTITIES: unique symbol = Symbol('brc207.attested.trustedIdentities')

/** A BRC-189 trusted-identity snapshot provider for the `any`, `same` and `all` modes. */
export type TrustedIdentities = () => Promise<{ snapshot: string; identityKeys: string[] }>

/** The attested handler as built here: a `RequiredProfileHandler` carrying its trust source. */
export type AttestedProfileHandler = RequiredProfileHandler & {
  readonly [TRUSTED_IDENTITIES]: TrustedIdentities | undefined
}

/** A CBOR map as the strict decoder returns it: an object that is no array, bytes or link. */
const isCborMap = (value: StrictCborValue): value is StrictCborMap =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Uint8Array) &&
  !(value instanceof StrictCborLink)

const fail = (reason: string): ProfileParamsError =>
  new ProfileParamsError(`BRC-207: invalid attested profile params: ${reason}`)

/** The member's text value, or undefined when absent; any other type fails. */
function text(map: StrictCborMap, member: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(map, member)) return undefined
  const value = map[member]
  if (typeof value !== 'string') throw fail(`${member} must be text`)
  return value
}

/**
 * Parses attested v1 `params` (0207:177-182, 0207:439-442): exactly a map with the optional text
 * members `trustMode` (any, same, all or identity; default any), `identityKey` (a lowercase
 * compressed key, present exactly in identity mode) and `evidenceProfile` (a profile id other
 * than this profile's, with neither other member present). Unknown members and `null` fail.
 * Throws ProfileParamsError.
 */
export function parseAttestedParams(params: StrictCborValue): AttestedParams {
  if (!isCborMap(params)) throw fail('params must be a map')
  for (const member of Object.keys(params)) {
    if (!MEMBERS.has(member)) throw fail(`unknown member ${JSON.stringify(member)}`)
  }
  const trustMode = text(params, 'trustMode')
  const identityKey = text(params, 'identityKey')
  const evidenceProfile = text(params, 'evidenceProfile')

  if (evidenceProfile !== undefined) {
    if (trustMode !== undefined || identityKey !== undefined) {
      throw fail('trustMode and identityKey must be absent with evidenceProfile')
    }
    if (!isProfileId(evidenceProfile)) {
      throw fail('evidenceProfile must be a processing-profile identifier')
    }
    if (evidenceProfile === ATTESTED_PROFILE_ID) {
      throw fail('evidenceProfile must name a different profile')
    }
    return { trustMode: 'any', evidenceProfile }
  }

  const mode = trustMode ?? 'any'
  if (!(TRUST_MODES as readonly string[]).includes(mode)) {
    throw fail(`unknown trustMode ${JSON.stringify(mode)}`)
  }
  if (mode !== 'identity') {
    if (identityKey !== undefined) throw fail('identityKey requires trustMode identity')
    return { trustMode: mode as TrustMode }
  }
  if (identityKey === undefined) throw fail('trustMode identity requires identityKey')
  try {
    validateIdentityKey(identityKey, 'identityKey')
  } catch (error) {
    throw fail((error as Error).message)
  }
  // The sdk reduces an x coordinate >= p modulo p; only the canonical encoding names the key.
  if (PublicKey.fromString(identityKey).toString() !== identityKey) {
    throw fail('identityKey is not a canonical compressed public key')
  }
  return { trustMode: 'identity', identityKey }
}

/**
 * The built-in attested v1 handler (contract §2.4): id `ATTESTED_PROFILE_ID`, version 1, a
 * 16 MiB receipt limit, no own `ext` state and no hooks beyond `checkDescriptor`, which also
 * requires a named `evidenceProfile` in the same `req`. `trustedIdentities` supplies the BRC-189
 * snapshot for the any, same and all modes; without it those modes fail closed, and identity
 * mode never calls it. The handler is frozen; spread it to add a `provider`.
 */
export function createAttestedProfile(options?: {
  trustedIdentities?: TrustedIdentities
}): RequiredProfileHandler {
  const trustedIdentities = options?.trustedIdentities
  if (trustedIdentities !== undefined && typeof trustedIdentities !== 'function') {
    throw new TypeError('BRC-207: trustedIdentities must be a function when present')
  }
  const handler: AttestedProfileHandler = {
    id: ATTESTED_PROFILE_ID,
    versions: Object.freeze([1]),
    maxReceiptBytes: ATTESTED_MAX_RECEIPT_BYTES,
    checkDescriptor: (
      descriptor: ProfileDescriptor,
      req: ReadonlyMap<string, ProfileDescriptor>
    ): void => {
      const { evidenceProfile } = parseAttestedParams(descriptor.params)
      if (evidenceProfile !== undefined && !req.has(evidenceProfile)) {
        throw fail(`evidenceProfile ${evidenceProfile} is not required by the deploy`)
      }
    },
    [TRUSTED_IDENTITIES]: trustedIdentities
  }
  return Object.freeze(handler)
}

/**
 * A terminal anchor of a token frontier: an outpoint (dot form) and the identities whose
 * attestation statements for that exact output verified. Coverage deduplicates `signers` again.
 */
export interface FrontierAnchor {
  outpoint: string
  signers: readonly string[]
}

/** A BRC-189 trust snapshot: its configuration version and its distinct valid identity keys. */
export interface TrustSnapshot {
  snapshot: string
  identityKeys: string[]
}

/** The canonical lowercase compressed form of an identity key, or undefined when it is invalid. */
function canonicalIdentityKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.toLowerCase()
  try {
    validateIdentityKey(key, 'identityKey')
    // The sdk reduces an x coordinate >= p modulo p; only the canonical encoding names the key.
    return PublicKey.fromString(key).toString() === key ? key : undefined
  } catch {
    return undefined
  }
}

const reject = (reason: string): AttestationEvidenceError => new AttestationEvidenceError(reason)

/**
 * The trust snapshot for an attested decision (0207:200-209). Identity mode needs no list and
 * never calls the callback, so it resolves undefined. The list modes call the handler's
 * `trustedIdentities` once and keep the distinct valid keys, in order; hex case is folded, and an
 * invalid entry is dropped (it cannot sign, so it cannot be a covering identity). A missing
 * callback, a callback that throws or rejects, or a malformed result fails closed with
 * AttestationEvidenceError('trust list unavailable').
 */
export async function trustSnapshot(
  handler: RequiredProfileHandler,
  params: AttestedParams
): Promise<TrustSnapshot | undefined> {
  if (params.trustMode === 'identity') return undefined
  const trustedIdentities = (handler as Partial<AttestedProfileHandler>)[TRUSTED_IDENTITIES]
  if (typeof trustedIdentities !== 'function') throw reject('trust list unavailable')
  let result: unknown
  try {
    result = await trustedIdentities()
  } catch {
    throw reject('trust list unavailable')
  }
  if (result === null || typeof result !== 'object') throw reject('trust list unavailable')
  const { snapshot, identityKeys } = result as { snapshot?: unknown; identityKeys?: unknown }
  if (typeof snapshot !== 'string' || !Array.isArray(identityKeys)) {
    throw reject('trust list unavailable')
  }
  const keys = new Set<string>()
  for (const entry of identityKeys) {
    const key = canonicalIdentityKey(entry)
    if (key !== undefined) keys.add(key)
  }
  return { snapshot, identityKeys: [...keys] }
}

/**
 * The signers that count toward coverage: exactly the declared key in identity mode (whatever
 * the list holds), otherwise members of the snapshot. No snapshot qualifies no list-mode signer.
 */
export function qualifyingSigner(
  params: AttestedParams,
  snapshot: readonly string[] | undefined
): (signer: string) => boolean {
  if (params.trustMode === 'identity') {
    const identityKey = params.identityKey
    return signer => signer === identityKey
  }
  const listed = new Set(snapshot ?? [])
  return signer => listed.has(signer)
}

/**
 * The coverage test over one asset's terminal anchors (0207:211-222). Signers are deduplicated
 * per anchor, so a repeated statement never counts twice. `any`: every anchor has a snapshot
 * signer. `same`: one snapshot identity signs every anchor. `all`: every snapshot identity signs
 * every anchor. `identity`: the declared key signs every anchor, whatever the snapshot. The list
 * modes fail on a missing or empty snapshot, and no mode passes with no anchors. Throws
 * AttestationEvidenceError.
 */
export function assertCoverage(
  params: AttestedParams,
  anchors: readonly FrontierAnchor[],
  snapshot: readonly string[] | undefined
): void {
  if (params.trustMode !== 'identity') {
    if (snapshot === undefined) throw reject('trust list unavailable')
    if (snapshot.length === 0) throw reject('empty trust list')
  }
  if (anchors.length === 0) throw reject('no anchors')
  const signerSets = anchors.map(anchor => new Set(anchor.signers))
  switch (params.trustMode) {
    case 'identity': {
      const identityKey = params.identityKey
      if (identityKey === undefined || !signerSets.every(signers => signers.has(identityKey))) {
        throw reject('anchor lacks the declared identity')
      }
      return
    }
    case 'any': {
      const qualifies = qualifyingSigner(params, snapshot)
      if (!signerSets.every(signers => [...signers].some(qualifies))) {
        throw reject('anchor lacks a trusted signer')
      }
      return
    }
    case 'same': {
      const listed = new Set(snapshot)
      if (![...listed].some(id => signerSets.every(signers => signers.has(id)))) {
        throw reject('no trusted signer covers every anchor')
      }
      return
    }
    case 'all': {
      const listed = new Set(snapshot)
      if (!signerSets.every(signers => [...listed].every(id => signers.has(id)))) {
        throw reject('anchor lacks a listed signer')
      }
      return
    }
    default:
      throw reject('unknown trust mode')
  }
}
