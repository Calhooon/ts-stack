// The built-in BRC-207 attested processing profile v1 (0207:166-189, 0207:435-445): its
// descriptor rules and handler. Evidence, coverage and frontier checks are applied by the module
// for assets whose resolution carries `attested`.

import { PublicKey } from '@bsv/sdk'
import { isProfileId, StrictCborLink } from '@bsv/templates'
import type { StrictCborMap, StrictCborValue } from '@bsv/templates'
import { ATTESTED_PROFILE_ID } from './attestation.js'
import { ProfileParamsError } from './errors.js'
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
