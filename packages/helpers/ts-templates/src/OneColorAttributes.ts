// BRC-162 1Color attribute reader: the reserved `req` and `ext` payload keys and
// processing-profile identifiers (BRC-162 "Processing profiles", pinned 0162:171-191),
// read under the BRC-207 wallet rules (pinned 0207:82-93): absent and malformed are
// distinct, and nothing is recovered from a payload that is not a strictly valid
// DAG-CBOR map. Every function here is pure and total; none throws on any input.
import { tryDecodeStrictCbor } from './strictCbor.js'
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

type Field<T> = OneColorField<T>

// Fresh objects per call, so no caller can mutate a shared result.
const absent = (): { status: 'absent' } => ({ status: 'absent' })
const malformed = (reason: string): { status: 'malformed'; reason: string } => ({
  status: 'malformed',
  reason
})

const DEC_MAX = 18n

const withoutFields = (payload: 'absent' | 'empty' | 'opaque'): OneColorAttributes => ({
  payload,
  dec: absent(),
  sym: absent(),
  icon: absent(),
  req: absent(),
  ext: absent()
})

const has = (map: StrictCborMap, key: string): boolean => Object.hasOwn(map, key)

// dec: a CBOR unsigned integer 0..18 (0162:246-252). A float (even 2.0) decodes as a
// number, not a bigint, so it is malformed rather than coerced.
const readDec = (map: StrictCborMap): Field<number> => {
  if (!has(map, 'dec')) return absent()
  const v = map.dec
  if (typeof v === 'bigint' && v >= 0n && v <= DEC_MAX) return { status: 'valid', value: Number(v) }
  return malformed('dec must be an unsigned integer 0..18')
}

const readSym = (map: StrictCborMap): Field<string> => {
  if (!has(map, 'sym')) return absent()
  const v = map.sym
  if (typeof v === 'string') return { status: 'valid', value: v }
  return malformed('sym must be text')
}

// icon: exactly [text, bytes] (0162:236-240); any other shape is malformed.
const readIcon = (map: StrictCborMap): Field<{ mediaType: string; bytes: Uint8Array }> => {
  if (!has(map, 'icon')) return absent()
  const v = map.icon
  if (Array.isArray(v) && v.length === 2) {
    const [mediaType, bytes] = v
    if (typeof mediaType === 'string' && bytes instanceof Uint8Array) {
      return { status: 'valid', value: { mediaType, bytes } }
    }
  }
  return malformed('icon must be exactly [text, bytes]')
}

const isByteContainer = (v: unknown): v is readonly number[] | Uint8Array =>
  Array.isArray(v) || v instanceof Uint8Array

/**
 * Reads the BRC-162 1Color payload attributes. Pure and total: never throws.
 * `undefined` => 'absent'; a zero-length array or Uint8Array => 'empty'; anything else that is
 * not a strictly valid DAG-CBOR map (non-arrays, entries outside 0..255, any decoder error)
 * => 'opaque', with every field absent and nothing recovered (0207:82-87). In a valid map a
 * reserved key that is present but ill-shaped is 'malformed', never 'absent' (0207:88-93).
 */
export function readOneColorAttributes(
  payload: readonly number[] | Uint8Array | undefined
): OneColorAttributes {
  if (payload === undefined) return withoutFields('absent')
  let map: StrictCborMap | undefined
  try {
    if (isByteContainer(payload) && payload.length === 0) return withoutFields('empty')
    // tryDecodeStrictCbor rethrows anything that is not a StrictCborError (e.g. a TypeError
    // on a non-iterable runtime value); every such error also means 'opaque'.
    map = tryDecodeStrictCbor(payload)
  } catch {
    map = undefined
  }
  if (map === undefined) return withoutFields('opaque')
  return {
    payload: 'map',
    dec: readDec(map),
    sym: readSym(map),
    icon: readIcon(map),
    req: absent(),
    ext: absent(),
    map
  }
}
