import type { StorageKnex } from '../StorageKnex'
import type {
  WalletReadSnapshot,
  WalletSnapshotFieldDescriptor,
  WalletSnapshotCursor,
  WalletSnapshotTable
} from './WalletReadSnapshot'

// Authored UNRUN. The controller must supply a fresh actual native wallet,
// independently authored fixture values, immutable runtime and original
// resource/deadline admission. This file opens no addon, process or pool.
function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Independent native field-source oracle differs')
}
async function refused(run: () => Promise<unknown>): Promise<void> {
  let failed = false
  try {
    await run()
  } catch {
    failed = true
  }
  if (!failed) throw new Error('Native field source admitted an invalid or ended coordinate')
}
export async function verifyNativeSnapshotFieldMetadataAndExactWindows(
  storage: StorageKnex,
  fixture: Readonly<{
    identityKey: string
    transactionId: number
    provenTxReqId: number
    rawTx: Uint8Array
    history: string
    expiresAt: number
  }>
): Promise<void> {
  if (
    !(fixture.rawTx instanceof Uint8Array) ||
    fixture.rawTx.length < 65537 ||
    fixture.rawTx.length > 1048576 ||
    typeof fixture.history !== 'string' ||
    fixture.history.length < 65537 ||
    fixture.history.length > 262144 ||
    !Number.isSafeInteger(fixture.expiresAt) ||
    fixture.expiresAt <= Date.now() ||
    fixture.expiresAt > Date.now() + 120000
  )
    throw new Error('Original finite native field-source fixture required')
  const identityKey = fixture.identityKey,
    transactionId = fixture.transactionId,
    provenTxReqId = fixture.provenTxReqId,
    expiresAt = fixture.expiresAt,
    monotonicDeadline = performance.now() + expiresAt - Date.now(),
    rawTx = new Uint8Array(fixture.rawTx),
    history = new TextEncoder().encode(fixture.history),
    check = () => {
      if (Date.now() >= expiresAt || performance.now() >= monotonicDeadline)
        throw new Error('Native field-source case deadline reached')
    }
  let view: WalletReadSnapshot | undefined
  try {
    view = await storage.openWalletReadSnapshot(identityKey, { lifetimeMs: expiresAt - Date.now() })
    check()
    const reader = view.fieldReader
    if (reader === undefined) throw new Error('Actual native source did not expose its field reader')
    const binary = await reader.readMetadataPage('transactions', undefined, { maxRows: 1, maxBytes: 8192 }),
      text = await reader.readMetadataPage('provenTxReqs', undefined, { maxRows: 1, maxBytes: 8192 })
    equal(binary.rows.length, 1)
    equal(binary.rows[0].fields.transactionId, transactionId)
    equal(text.rows.length, 1)
    equal(text.rows[0].fields.provenTxReqId, provenTxReqId)
    equal(binary.rows[0].fields.rawTx, undefined)
    equal(text.rows[0].fields.history, undefined)
    equal(binary.rows[0].extents.rawTx, { kind: 'binary', bytes: rawTx.length })
    equal(text.rows[0].extents.history, { kind: 'utf8', bytes: history.length })
    if (binary.payloadBytes > 8192 || text.payloadBytes > 8192) throw new Error('Native metadata budget exceeded')
    const windows = async (
      table: WalletSnapshotTable,
      cursor: WalletSnapshotCursor,
      field: string,
      descriptor: WalletSnapshotFieldDescriptor,
      oracle: Uint8Array
    ) => {
      for (const offset of [0, 65535, oracle.length - 1, oracle.length]) {
        check()
        const length = Math.min(65536, oracle.length - offset),
          actual = await reader.readFieldExtent(table, cursor, field, offset, length, descriptor)
        if (actual.length !== length || actual.some((byte, index) => byte !== oracle[offset + index]))
          throw new Error('Actual native field bytes differ from the independent fixture')
      }
      await refused(() => reader.readFieldExtent(table, cursor, field, 0, 65537, descriptor))
      await refused(() =>
        reader.readFieldExtent(table, cursor, field, 0, 1, { ...descriptor, bytes: descriptor.bytes + 1 })
      )
      await refused(() =>
        reader.readFieldExtent(table, { ...cursor, snapshotId: 'ff'.repeat(32) }, field, 0, 1, descriptor)
      )
      await refused(() =>
        reader.readFieldExtent(table, cursor, field, 0, 1, { ...descriptor, sha256: 'ff'.repeat(32) })
      )
    }
    await windows('transactions', binary.rows[0].cursor, 'rawTx', binary.rows[0].extents.rawTx, rawTx)
    await windows('provenTxReqs', text.rows[0].cursor, 'history', text.rows[0].extents.history, history)
    await view.close()
    await refused(() => reader.readMetadataPage('transactions'))
    await refused(() =>
      reader.readFieldExtent('provenTxReqs', text.rows[0].cursor, 'history', 0, 1, text.rows[0].extents.history)
    )
    check()
  } finally {
    try {
      await view?.close()
    } finally {
      rawTx.fill(0)
      history.fill(0)
    }
  }
}
