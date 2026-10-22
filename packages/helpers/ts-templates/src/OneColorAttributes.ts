// BRC-162 1Color attribute reader: the reserved `req` and `ext` payload keys and
// processing-profile identifiers (BRC-162 "Processing profiles", pinned 0162:171-191),
// read under the BRC-207 wallet rules (pinned 0207:82-93): absent and malformed are
// distinct, and nothing is recovered from a payload that is not a strictly valid
// DAG-CBOR map. Every function here is pure and total; none throws on any input.
import type { StrictCborMap, StrictCborValue } from './strictCbor.js'

/** A required-profile descriptor: exactly `{params, version}` (0162:181-183). */
export interface OneColorProfileDescriptor {
  /** positive uint32: 1..4294967295 */
  version: number
  /** any DAG-CBOR value, including null (0162:182-183) */
  params: StrictCborValue
}

/** Absent and malformed are distinct (0207:88-93). */
export type OneColorField<T> =
  { status: 'absent' } | { status: 'valid'; value: T } | { status: 'malformed'; reason: string }

export interface OneColorAttributes {
  /** 'absent' = no payload push; 'empty' = zero-byte payload (OP_0 OP_DROP);
   *  'opaque' = nonzero bytes that are not a strictly valid DAG-CBOR map (no partial recovery, 0207:82-87);
   *  'map' = strictly valid DAG-CBOR map. Every field below is { status: 'absent' } unless payload === 'map'. */
  payload: 'absent' | 'empty' | 'opaque' | 'map'
  /** uint 0..18 (0162:246-252); anything else is malformed */
  dec: OneColorField<number>
  /** text */
  sym: OneColorField<string>
  /** exactly [text, bytes]; display MUST treat malformed as absent (0162:240) */
  icon: OneColorField<{ mediaType: string; bytes: Uint8Array }>
  /** map; keys satisfy isProfileId; values exactly {params, version} */
  req: OneColorField<ReadonlyMap<string, OneColorProfileDescriptor>>
  /** map; keys satisfy isProfileId */
  ext: OneColorField<ReadonlyMap<string, StrictCborValue>>
  /** Exact wire span of the `req` VALUE inside the payload (not the whole payload); canonical because only
   *  strictly decoded payloads reach 'map'. Set iff req.status === 'valid'. */
  reqBytes?: Uint8Array
  /** The decoded map, iff payload === 'map'. */
  map?: StrictCborMap
}

const PROFILE_ID_MAX_BYTES = 200
// The pattern admits only ASCII, so string length equals the byte count.
const PROFILE_ID_RE = /^[a-z][a-z0-9+.-]*:[\x21-\x7e]+$/

/** 0162:178-183: case-sensitive ASCII URI, 1..200 bytes, ^[a-z][a-z0-9+.-]*:[\x21-\x7e]+$ */
export function isProfileId(id: string): boolean {
  return typeof id === 'string' && id.length <= PROFILE_ID_MAX_BYTES && PROFILE_ID_RE.test(id)
}
