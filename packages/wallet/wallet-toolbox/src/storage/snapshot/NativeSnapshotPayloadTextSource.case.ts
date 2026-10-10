import type { StorageKnex } from '../StorageKnex'
import type { Brc38NativeTextRead } from '../portable/Brc38NativeBlobProtocol'
import { brc38NativeTextCoordinate } from '../portable/Brc38NativeBlobProtocol'
import type { WalletReadSnapshot } from './WalletReadSnapshot'

export interface NativePayloadTextSourceCase {
  readonly table: Brc38NativeTextRead['table']
  readonly field: Brc38NativeTextRead['field']
  readonly match: Readonly<Record<string, number | string>>
  /** Independently seeded complete fixture value; never derived from the
   * implementation's descriptor/hash or from its own returned bytes. */
  readonly value: string
}
const added = [
  ['transactions', 'description'],
  ['transactions', 'noSendExpiryReclaimDerivationPrefix'],
  ['transactions', 'noSendExpiryReclaimDerivationSuffix'],
  ['outputs', 'outputDescription'],
  ['outputs', 'spendingDescription'],
  ['outputs', 'customInstructions'],
  ['outputs', 'derivationPrefix'],
  ['outputs', 'derivationSuffix'],
  ['outputs', 'type'],
  ['outputs', 'purpose'],
  ['commissions', 'keyOffset'],
  ['certificates', 'subject'],
  ['certificates', 'revocationOutpoint'],
  ['certificates', 'signature'],
  ['certificates', 'verifier'],
  ['certificateFields', 'fieldValue'],
  ['certificateFields', 'masterKey']
] as const
function requireCase(condition: boolean): asserts condition {
  if (!condition) throw new Error('Independent native payload TEXT source oracle differs')
}
/** Authored UNRUN. Actual finite native controller/runtime and independently
 * populated same-profile fixtures are required. No addon/process/pool starts
 * here. Metadata excludes all seventeen large TEXT payload cells; each exact
 * byte window comes from the same retained actual view, including EOF/empty.
 * This source case does not establish destination or complete sync support. */
export async function verifyNativePayloadTextSource(
  storage: StorageKnex,
  identityKey: string,
  selected: readonly NativePayloadTextSourceCase[],
  expiresAt: number
): Promise<void> {
  requireCase(
    selected.length === 17 &&
      Number.isSafeInteger(expiresAt) &&
      expiresAt > Date.now() &&
      expiresAt <= Date.now() + 120000 &&
      added.every(([table, field]) => selected.filter(row => row.table === table && row.field === field).length === 1)
  )
  const fixtures = selected.map(row => ({
      table: row.table,
      field: row.field,
      match: Object.freeze({ ...row.match }),
      value: row.value
    })),
    deadline = performance.now() + expiresAt - Date.now(),
    check = (): void => {
      requireCase(Date.now() < expiresAt && performance.now() < deadline)
    },
    refuse = async (run: () => Promise<unknown>): Promise<void> => {
      let refused = false
      try {
        await run()
      } catch {
        refused = true
      }
      requireCase(refused)
    }
  for (const row of fixtures) {
    brc38NativeTextCoordinate(row.table, row.field)
    requireCase(
      typeof row.value === 'string' &&
        row.value.length <= 262144 &&
        Object.keys(row.match).length >= 1 &&
        Object.keys(row.match).length <= 3
    )
  }
  let view: WalletReadSnapshot | undefined
  try {
    view = await storage.openWalletReadSnapshot(identityKey, { lifetimeMs: expiresAt - Date.now() })
    check()
    const reader = view.fieldReader
    requireCase(reader !== undefined)
    for (const fixture of fixtures) {
      check()
      const page = await reader.readMetadataPage(fixture.table, undefined, { maxRows: 128, maxBytes: 32768 }),
        candidates = page.rows.filter(row =>
          Object.entries(fixture.match).every(
            ([key, value]) => (row.fields as Readonly<Record<string, unknown>>)[key] === value
          )
        )
      requireCase(candidates.length === 1 && page.payloadBytes <= 32768)
      const row = candidates[0],
        descriptor = row.extents[fixture.field],
        oracle = new TextEncoder().encode(fixture.value)
      try {
        requireCase(
          (row.fields as Readonly<Record<string, unknown>>)[fixture.field] === undefined &&
            descriptor?.kind === 'utf8' &&
            descriptor.bytes === oracle.length &&
            descriptor.sha256 === undefined
        )
        for (const offset of new Set([
          0,
          Math.min(65535, oracle.length),
          Math.max(0, oracle.length - 1),
          oracle.length
        ])) {
          check()
          const length = Math.min(65536, oracle.length - offset),
            actual = await reader.readFieldExtent(fixture.table, row.cursor, fixture.field, offset, length, descriptor)
          try {
            requireCase(actual.length === length && actual.every((byte, index) => byte === oracle[offset + index]))
          } finally {
            actual.fill(0)
          }
        }
        await refuse(() => reader.readFieldExtent(fixture.table, row.cursor, fixture.field, 0, 65537, descriptor))
        await refuse(() =>
          reader.readFieldExtent(fixture.table, row.cursor, fixture.field, 0, 1, {
            ...descriptor,
            bytes: descriptor.bytes + 1
          })
        )
        await refuse(() =>
          reader.readFieldExtent(
            fixture.table,
            { ...row.cursor, snapshotId: 'ff'.repeat(32) },
            fixture.field,
            0,
            0,
            descriptor
          )
        )
      } finally {
        oracle.fill(0)
      }
    }
    await view.close()
    await refuse(() => reader.readMetadataPage('certificates'))
    check()
  } finally {
    await view?.close()
  }
}
