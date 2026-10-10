import { createSyncMap, type SyncMap } from '../schema/entities/EntityBase'
import {
  rewriteBrc38StructuredJsonMembers,
  type Brc38StructuredMemberEdit,
  type Brc38StructuredJsonPolicy,
  type Brc38StreamedStructured
} from './Brc38StructuredJson'
import { brc38WorkingAllocation, type Brc38WorkingCharge } from './Brc38WorkingAllocation'
import { SnapshotResourceLimitError } from '../snapshot/SnapshotResourceLimitError'

type Entity = keyof SyncMap
export interface Brc38CheckpointSyncMapDelta {
  readonly entity?: Entity
  readonly count: number
  readonly mappings: readonly Readonly<{ incomingId: number; localId: number }>[]
  readonly maximumUpdatedAt?: Date
  readonly done: boolean
}
export interface Brc38CheckpointSyncMapPolicy extends Brc38StructuredJsonPolicy {
  readonly maximumDateCodeUnits: number
}
interface Entry {
  object: boolean
  countSeen: boolean
  mapSeen: boolean
  count: number
  maximum?: string
}
const names = Object.freeze(Object.keys(createSyncMap()) as Entity[])
function invalid(): never {
  throw new Error('Operational checkpoint sync map differs from its complete current state or finite delta')
}

/** Stream a CURRENT operational map, preserving every unknown member and
 * every existing ID mapping. This is a codec, never row/source/writer/primary
 * admission. Output must remain private until EOF and index cleanup. The caller
 * supplies actual planned IDs and independently rechecks them in its final
 * atomic row/map/provenance/checkpoint/receipt transaction. */
export async function* checkpointBrc38SyncMap(
  selectedSource: Brc38StreamedStructured,
  selectedPolicy: Brc38CheckpointSyncMapPolicy,
  selectedDelta: Brc38CheckpointSyncMapDelta
): AsyncGenerator<Uint8Array, Readonly<{ maximumUpdatedAt?: string }>> {
  const policy = Object.freeze({ ...selectedPolicy }),
    working = brc38WorkingAllocation(policy.workingAllocation)
  if (
    !Array.isArray(selectedDelta.mappings) ||
    selectedDelta.mappings.length > 4000 ||
    !Number.isSafeInteger(selectedDelta.count) ||
    selectedDelta.count < 0 ||
    typeof selectedDelta.done !== 'boolean' ||
    (selectedDelta.entity !== undefined && !names.includes(selectedDelta.entity)) ||
    (selectedDelta.entity === undefined &&
      (selectedDelta.count !== 0 ||
        selectedDelta.mappings.length !== 0 ||
        selectedDelta.maximumUpdatedAt !== undefined)) ||
    !Number.isSafeInteger(policy.maximumDateCodeUnits) ||
    policy.maximumDateCodeUnits < 24 ||
    policy.maximumDateCodeUnits > 8192
  )
    invalid()
  const reservation = working?.claim(32768 + 4096 * selectedDelta.mappings.length)
  let dateCharge: Brc38WorkingCharge | undefined
  try {
    const entity = selectedDelta.entity,
      done = selectedDelta.done,
      increment = selectedDelta.count,
      suppliedMaximum =
        selectedDelta.maximumUpdatedAt === undefined ? undefined : selectedDelta.maximumUpdatedAt.toISOString(),
      replacements = new Map<string, number>(),
      entries = new Map<Entity, Entry>(
        names.map(name => [name, { object: false, countSeen: false, mapSeen: false, count: 0 }])
      ),
      edits: Brc38StructuredMemberEdit[] = []
    for (const value of selectedDelta.mappings) {
      if (!Number.isInteger(value.incomingId) || !Number.isSafeInteger(value.localId) || value.localId < 1) invalid()
      const key = String(value.incomingId)
      if (replacements.has(key)) invalid()
      const localId = value.localId
      replacements.set(key, localId)
      edits.push({ path: [entity!, 'idMap'], key, value: () => localId })
    }
    const selectedEntry = (path: readonly (string | number)[]): Entry | undefined =>
      typeof path[0] === 'string' ? entries.get(path[0] as Entity) : undefined
    for (const name of names) {
      const entry = entries.get(name)!
      if (done || name === entity)
        edits.push({
          path: [name],
          key: 'count',
          value: () => {
            if (!entry.countSeen || !Number.isSafeInteger(entry.count + (name === entity ? increment : 0))) invalid()
            return done ? 0 : entry.count + increment
          }
        })
      const supplied = name === entity ? suppliedMaximum : undefined
      edits.push({
        path: [name],
        key: 'maxUpdated_at',
        existingOnly: supplied === undefined,
        value: () => {
          if (entry.maximum === undefined && supplied === undefined) invalid()
          return supplied === undefined || (entry.maximum !== undefined && entry.maximum > supplied)
            ? entry.maximum!
            : supplied
        }
      })
    }
    let date = '',
      dateEntity: Entity | undefined,
      root = false
    yield* rewriteBrc38StructuredJsonMembers(selectedSource, policy, edits, {
      enter: (path, kind) => {
        policy.signal?.throwIfAborted()
        if (path.length === 0) {
          if (kind !== 'object') invalid()
          root = true
          return
        }
        const entry = selectedEntry(path)
        if (entry === undefined) return
        if (path.length === 1) {
          if (kind !== 'object') invalid()
          entry.object = true
        }
        if (!entry.object) invalid()
        if (
          (path.length === 2 && path[1] === 'count' && kind !== 'number') ||
          (path.length === 2 && path[1] === 'idMap' && kind !== 'object') ||
          (path.length === 3 && path[1] === 'idMap' && kind !== 'number')
        )
          invalid()
        if (path.length === 2 && path[1] === 'idMap') entry.mapSeen = true
        if (path.length === 2 && path[1] === 'maxUpdated_at') {
          if (kind !== 'string') invalid()
          date = ''
          dateEntity = path[0] as Entity
          dateCharge?.close()
          dateCharge = undefined
        }
      },
      text: (path, value) => {
        if (path.length !== 2 || path[0] !== dateEntity || path[1] !== 'maxUpdated_at') return
        if (value.length > policy.maximumDateCodeUnits - date.length)
          throw new SnapshotResourceLimitError('Current sync-map date exceeds its explicit scalar allocation')
        const bytes = 1024 + 16 * (date.length + value.length)
        if (dateCharge === undefined) dateCharge = working?.claim(bytes)
        else dateCharge.resize(bytes)
        date += value
      },
      number: (path, value) => {
        const entry = selectedEntry(path)
        if (entry === undefined) return
        if (path.length === 2 && path[1] === 'count') {
          if (!Number.isSafeInteger(value) || value < 0) invalid()
          entry.count = value
          entry.countSeen = true
        }
        if (path.length === 3 && path[1] === 'idMap') {
          if (!Number.isSafeInteger(value)) invalid()
          if (
            path[0] === entity &&
            typeof path[2] === 'string' &&
            replacements.has(path[2]) &&
            replacements.get(path[2]) !== value
          )
            invalid()
        }
      },
      end: path => {
        if (path.length !== 2 || path[0] !== dateEntity || path[1] !== 'maxUpdated_at') return
        const when = new Date(date)
        if (!Number.isFinite(when.getTime())) invalid()
        entries.get(dateEntity!)!.maximum = when.toISOString()
        date = ''
        dateEntity = undefined
        dateCharge?.close()
        dateCharge = undefined
      }
    })
    if (!root || [...entries.values()].some(entry => !entry.object || !entry.countSeen || !entry.mapSeen)) invalid()
    if (entity !== undefined && suppliedMaximum !== undefined) {
      const entry = entries.get(entity)!
      if (entry.maximum === undefined || entry.maximum < suppliedMaximum) entry.maximum = suppliedMaximum
    }
    let maximumUpdatedAt: string | undefined
    for (const entry of entries.values())
      if (entry.maximum !== undefined && (maximumUpdatedAt === undefined || entry.maximum > maximumUpdatedAt))
        maximumUpdatedAt = entry.maximum
    return Object.freeze(maximumUpdatedAt === undefined ? {} : { maximumUpdatedAt })
  } finally {
    dateCharge?.close()
    reservation?.close()
  }
}
