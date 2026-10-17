import { brc38Utf8ByteLength } from '../../portable/Brc38Utf8Length'
import { sha256 } from '@bsv/sdk/primitives/Hash'
import { toHex } from '@bsv/sdk/primitives/utils'
import { SnapshotResourceLimitError } from '../SnapshotResourceLimitError'
import {
  decodeSnapshotJournalDeltaFrame,
  encodeSnapshotJournalDeltaFrame,
  type SnapshotJournalDeltaFrameContext
} from './SnapshotJournalDeltaFrame'
import {
  snapshotJournalDataDigest,
  snapshotJournalDataRecord,
  snapshotJournalDataText
} from './SnapshotJournalReceiptData'
import {
  compareSnapshotJournalRevisions,
  snapshotJournalRevision,
  type SnapshotJournalRevision
} from './SnapshotJournalRevision'
import type {
  SnapshotJournalDeltaPage,
  SnapshotJournalIdentityTable,
  SnapshotJournalSourceIdentity,
  SnapshotJournalSourceNaturalKey
} from './SnapshotJournalTypes'

/** A distinct transport encoding, never a complete BRC-38 row archive. Identity
 * prefixes stream separately so a notification set cannot become one JS map. */
export const snapshotJournalArchiveEncoding = 'wallet-journal-packets/1'
export const snapshotJournalArchivePacketBytes = 1048576
export type SnapshotJournalArchivePacket =
  | {
      kind: 'identities'
      frameDigest: string
      changeIndex: number
      identities: ReadonlyMap<string, SnapshotJournalSourceIdentity>
    }
  | { kind: 'frame'; frameDigest: string; page: SnapshotJournalDeltaPage }

function invalid(): never {
  throw new TypeError('Invalid snapshot journal archive packet DATA')
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid()
  return value
}
function array(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input)) invalid()
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value
  integer(length, 0, maximum)
  if (Reflect.ownKeys(input).length !== length + 1) invalid()
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid()
    return descriptor.value
  })
}
function naturalKey(input: unknown, tableId: SnapshotJournalIdentityTable): Readonly<SnapshotJournalSourceNaturalKey> {
  const fields: Record<SnapshotJournalIdentityTable, readonly string[]> = {
    0: ['reference'],
    1: ['transactionId', 'vout'],
    2: ['serialNumber', 'certifier'],
    3: ['label'],
    4: ['name'],
    5: ['tag'],
    6: ['transactionId'],
    8: ['txid'],
    9: ['txid']
  }
  const names = [...fields[tableId]]
  if (tableId === 0 && input !== null && typeof input === 'object' && Object.hasOwn(input, 'txid')) names.push('txid')
  const data = snapshotJournalDataRecord(input, ['tableId', ...names])
  if (data.tableId !== tableId) invalid()
  const output: Record<string, string | number> = { tableId }
  for (const name of names) {
    const value = data[name]
    if (tableId === 0 && name === 'txid' && value === undefined) continue
    output[name] =
      name === 'transactionId' || name === 'vout'
        ? integer(value, name === 'vout' ? 0 : 1)
        : snapshotJournalDataText(value, 1200)
  }
  if (brc38Utf8ByteLength(JSON.stringify(output)) > 8192) invalid()
  return Object.freeze(output) as unknown as Readonly<SnapshotJournalSourceNaturalKey>
}
function identity(input: unknown, high: SnapshotJournalRevision): SnapshotJournalSourceIdentity {
  const data = snapshotJournalDataRecord(input, [
    'tableId',
    'incomingId',
    'generation',
    'revision',
    'naturalIdentity',
    'naturalKey',
    'required'
  ])
  if (![0, 1, 2, 3, 4, 5, 6, 8, 9].includes(data.tableId as number) || typeof data.required !== 'boolean') invalid()
  const tableId = data.tableId as SnapshotJournalIdentityTable,
    generation = snapshotJournalRevision(data.generation),
    revision = snapshotJournalRevision(data.revision)
  if (
    generation === '0' ||
    compareSnapshotJournalRevisions(generation, revision) > 0 ||
    compareSnapshotJournalRevisions(revision, high) > 0
  )
    invalid()
  return Object.freeze({
    tableId,
    incomingId: integer(data.incomingId, 1),
    generation,
    revision,
    naturalIdentity: snapshotJournalDataDigest(data.naturalIdentity),
    naturalKey: naturalKey(data.naturalKey, tableId),
    required: data.required
  })
}
function context(input: SnapshotJournalDeltaFrameContext): SnapshotJournalDeltaFrameContext {
  const data = snapshotJournalDataRecord(input, ['stream', 'tableId'])
  if (data.stream !== 'scope' && data.stream !== 'physical') invalid()
  const tableId = integer(data.tableId, 0, 12)
  if (data.stream === 'physical' && tableId !== 8 && tableId !== 9) invalid()
  return { stream: data.stream, tableId }
}
function envelope(header: object, frame: Uint8Array = new Uint8Array()): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(header)),
    length = 4 + bytes.byteLength + frame.byteLength
  if (length > snapshotJournalArchivePacketBytes)
    throw new SnapshotResourceLimitError('Journal archive packet exceeds its negotiated byte bound')
  const result = new Uint8Array(length)
  new DataView(result.buffer).setUint32(0, bytes.byteLength, false)
  result.set(bytes, 4)
  result.set(frame, 4 + bytes.byteLength)
  return result
}

export function encodeSnapshotJournalArchiveIdentities(
  inputContext: SnapshotJournalDeltaFrameContext,
  inputDigest: string,
  inputChangeIndex: number,
  input: ReadonlyMap<string, SnapshotJournalSourceIdentity>,
  highWater: SnapshotJournalRevision
): Uint8Array {
  const bound = context(inputContext),
    frameDigest = snapshotJournalDataDigest(inputDigest),
    changeIndex = integer(inputChangeIndex, 0, 255),
    high = snapshotJournalRevision(highWater)
  const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get
  if (!(input instanceof Map) || size === undefined || size.call(input) > 128) invalid()
  const entries: Array<[string, SnapshotJournalSourceIdentity]> = Array.from(Map.prototype.entries.call(input))
  const identities = entries.map(([key, value]) => {
    const owned = identity(value, high)
    if (key !== owned.tableId + ':' + owned.incomingId) invalid()
    return owned
  })
  return envelope({ version: 1, kind: 'identities', ...bound, frameDigest, changeIndex, identities })
}

export function encodeSnapshotJournalArchiveFrame(
  inputContext: SnapshotJournalDeltaFrameContext,
  page: SnapshotJournalDeltaPage
): Uint8Array {
  const bound = context(inputContext),
    frame = encodeSnapshotJournalDeltaFrame(page, bound)
  return envelope({ version: 1, kind: 'frame', ...bound, frameDigest: toHex(sha256(frame)) }, frame)
}

/** Decode one bounded prefix or frame; returned maps/cells are owned copies.
 * This parser supplies no source or target authorization and admits no writer. */
export function decodeSnapshotJournalArchivePacket(
  input: Uint8Array,
  inputContext: SnapshotJournalDeltaFrameContext,
  highWater: SnapshotJournalRevision
): SnapshotJournalArchivePacket {
  const bound = context(inputContext),
    high = snapshotJournalRevision(highWater)
  const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')?.get
  if (!(input instanceof Uint8Array) || byteLength === undefined) invalid()
  const size = byteLength.call(input) as number
  if (size < 4 || size > snapshotJournalArchivePacketBytes) invalid()
  const bytes = new Uint8Array(input),
    length = new DataView(bytes.buffer).getUint32(0, false)
  if (length > bytes.byteLength - 4) invalid()
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + length)))
  if (raw === null || typeof raw !== 'object') invalid()
  const kind = Object.getOwnPropertyDescriptor(raw, 'kind')?.value,
    row = snapshotJournalDataRecord(raw, [
      'version',
      'kind',
      'stream',
      'tableId',
      'frameDigest',
      ...(kind === 'identities' ? ['changeIndex', 'identities'] : [])
    ]),
    frameDigest = snapshotJournalDataDigest(row.frameDigest)
  if (row.version !== 1 || row.stream !== bound.stream || row.tableId !== bound.tableId) invalid()
  if (kind === 'identities') {
    if (bytes.byteLength !== 4 + length) invalid()
    const changeIndex = integer(row.changeIndex, 0, 255),
      identities = new Map<string, SnapshotJournalSourceIdentity>()
    for (const input of array(row.identities, 128)) {
      const owned = identity(input, high),
        key = owned.tableId + ':' + owned.incomingId
      if (identities.has(key)) invalid()
      identities.set(key, owned)
    }
    return { kind, frameDigest, changeIndex, identities }
  }
  if (kind !== 'frame') invalid()
  const frame = bytes.subarray(4 + length)
  if (toHex(sha256(frame)) !== frameDigest) invalid()
  const page = decodeSnapshotJournalDeltaFrame(frame, bound)
  if (
    page.changes.some(change => compareSnapshotJournalRevisions(change.metadata.revision, high) > 0) ||
    (page.after !== undefined && compareSnapshotJournalRevisions(page.after.revision, high) > 0)
  )
    invalid()
  return { kind, frameDigest, page }
}
