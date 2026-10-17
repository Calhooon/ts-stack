import { seedArchiveClosure } from '../../../../test/utils/snapshotArchiveFixtures'
import { knex } from 'knex'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageKnex } from '../../StorageKnex'
import { StorageProvider } from '../../StorageProvider'
import { KnexSnapshotArchiveStore } from '../archive/KnexSnapshotArchiveStore'
import { snapshotArchiveLimits } from '../archive/SnapshotArchive'
import { captureSnapshotJournalArchiveSource } from './captureSnapshotJournalArchiveSource'
import { decodeSnapshotJournalArchivePacket, snapshotJournalArchiveEncoding } from './SnapshotJournalArchivePacket'
import { snapshotJournalArchiveStreams, type SnapshotJournalArchiveManifest } from './SnapshotJournalArchiveBinding'
import * as Backend from './SnapshotJournalCaptureBackend'
import type { SnapshotJournalReconciliationSource } from './SnapshotJournalProvider'
import { runInSeries } from '../../../utility/runInSeries'

const identityKey = '02' + '11'.repeat(32),
  foreignKey = '03' + '22'.repeat(32)
const fixtures: Array<{ storage: StorageKnex; directory: string }> = [],
  sources: SnapshotJournalReconciliationSource[] = []
async function fixture(fullClosure = false) {
  const directory = await mkdtemp(join(tmpdir(), 'ts569-journal-archive-')),
    storage = new StorageKnex({
      ...StorageProvider.createStorageBaseOptions('test'),
      knex: knex({
        client: 'better-sqlite3',
        connection: { filename: join(directory, 'wallet.sqlite') },
        useNullAsDefault: true,
        pool: { min: 0, max: 1 }
      })
    })
  fixtures.push({ storage, directory })
  await storage.knex.raw('PRAGMA journal_mode=WAL')
  await storage.migrate('journal archive fixture', 'source')
  await storage.makeAvailable()
  const { user } = await storage.findOrInsertUser(identityKey),
    { user: foreign } = await storage.findOrInsertUser(foreignKey)
  await storage.updateUser(user.userId, { activeStorage: 'source' })
  if (fullClosure) await seedArchiveClosure(storage, user.userId, foreign.userId)
  const original = await storage.findOrInsertTxLabel(user.userId, 'original label')
  await storage.findOrInsertTxLabel(foreign.userId, 'foreign label')
  const open = async () => {
    const source = await storage.openCurrentSnapshotJournalSource(identityKey)
    sources.push(source)
    return source
  }
  return { storage, user, original, foreign, store: new KnexSnapshotArchiveStore(storage.knex), open }
}
async function packets(store: KnexSnapshotArchiveStore, manifest: SnapshotJournalArchiveManifest) {
  const directory = await store.journalDirectory(identityKey, manifest.archiveId)
  expect(directory.encoding).toBe(snapshotJournalArchiveEncoding)
  const result: Array<{ streamIndex: number; packet: ReturnType<typeof decodeSnapshotJournalArchivePacket> }> = []
  let streamIndex = 0
  await runInSeries(directory.receipts, async receipt => {
    const stream = snapshotJournalArchiveStreams[streamIndex]
    expect(receipt.table).toBe(stream.table)
    const page = await store.readJournal(identityKey, manifest.archiveId, receipt.sequence),
      packet = decodeSnapshotJournalArchivePacket(
        page.bytes,
        { stream: stream.stream, tableId: stream.tableId },
        manifest.binding.journal.receipt.highWater
      )
    expect(page.rows).toBe(packet.kind === 'frame' ? packet.page.changes.length : 0)
    expect(page.done).toBe(packet.kind === 'frame' && packet.page.complete)
    result.push({ streamIndex, packet })
    if (page.done) streamIndex++
  })
  expect(streamIndex).toBe(15)
  return result
}
afterEach(async () => {
  jest.restoreAllMocks()
  await runInSeries(sources.splice(0), async source => {
    await source.close()
    await source.closed
  })
  await runInSeries(fixtures.splice(0), async f => {
    await f.storage.destroy()
    await rm(f.directory, { recursive: true, force: true })
  })
})

test('actual full journal capture streams fifteen sealed streams, exact identities and one profile; row archive APIs refuse it', async () => {
  const f = await fixture(true),
    source = await f.open(),
    originalReceipt = source.receipt,
    originalBinding = source.receiptBinding,
    originalPrimary = source.primary
  source.receipt.highWater = '0' as typeof source.receipt.highWater
  source.receiptBinding.storageIdentity = 'changed public DATA'
  source.primary.activeStorage = 'changed public DATA'
  expect(source.receipt).toEqual(originalReceipt)
  expect(source.receiptBinding).toEqual(originalBinding)
  expect(source.primary).toEqual(originalPrimary)
  const manifest = await captureSnapshotJournalArchiveSource(source, f.store)
  expect(source.isOpen).toBe(false)
  expect(manifest.binding.journal).toMatchObject({
    bootstrap: true,
    low: '0',
    source: originalBinding,
    receipt: originalReceipt
  })
  const entries = await packets(f.store, manifest),
    frames = entries
      .filter(x => x.packet.kind === 'frame')
      .flatMap(x => (x.packet.kind === 'frame' ? x.packet.page.changes : [])),
    rows = frames.flatMap(x => (x.present ? [x.row] : []))
  const populated = entries.flatMap(entry =>
    entry.packet.kind === 'frame' && entry.packet.page.changes.some(change => change.present)
      ? [entry.packet.page.table]
      : []
  )
  expect([...new Set(populated)].sort()).toEqual(
    [...new Set(snapshotJournalArchiveStreams.map(stream => stream.table))].sort()
  )
  const proof = entries
    .flatMap(entry =>
      entry.packet.kind === 'frame' && entry.packet.page.table === 'provenTxs'
        ? entry.packet.page.changes.flatMap(change => (change.present ? [change.row] : []))
        : []
    )
    .find(row => row.provenTxId === 1)
  expect(proof?.merklePath).toEqual(Uint8Array.of(1, 0, 255))
  expect(rows.filter(x => x.label === 'original label')).toHaveLength(1)
  expect(rows.some(x => x.label === 'foreign label')).toBe(false)
  expect(rows.every(x => !Object.hasOwn(x, 'userId') || Number(x.userId) === f.user.userId)).toBe(true)
  expect(
    entries.some(
      x =>
        x.packet.kind === 'identities' &&
        [...x.packet.identities.values()].some(i => i.tableId === 3 && i.incomingId === f.original.txLabelId)
    )
  ).toBe(true)
  await expect(f.store.inspect(identityKey, manifest.archiveId)).rejects.toThrow('unavailable')
  await expect(f.store.directory(identityKey, manifest.archiveId)).rejects.toThrow('unavailable')
  await expect(f.store.read(identityKey, manifest.archiveId, 0)).rejects.toThrow('unavailable')
  const actual = await f.store.readJournal(identityKey, manifest.archiveId, 0),
    saved = actual.bytes.slice()
  actual.bytes.fill(0)
  expect((await f.store.readJournal(identityKey, manifest.archiveId, 0)).bytes).toEqual(saved)
  await expect(f.store.inspectJournal(foreignKey, manifest.archiveId)).rejects.toThrow('unavailable')
  await f.store.close(identityKey, manifest.archiveId)
  expect(await f.storage.knex('snapshot_archive_capacity').first()).toMatchObject({ archives: 0, reservedBytes: 0 })
})

test('next actual artifact captures retained hard-delete tombstones and new rows above the previous high-water', async () => {
  const f = await fixture(),
    first = await captureSnapshotJournalArchiveSource(await f.open(), f.store)
  await f.store.close(identityKey, first.archiveId)
  await f.storage.knex('tx_labels').where('txLabelId', f.original.txLabelId).delete()
  const added = await f.storage.findOrInsertTxLabel(f.user.userId, 'next label')
  await f.storage.findOrInsertTxLabel(f.foreign.userId, 'another foreign label')
  const second = await captureSnapshotJournalArchiveSource(await f.open(), f.store, {
    binding: first.binding.journal.receipt.binding,
    highWater: first.binding.journal.receipt.highWater
  })
  expect(second.binding.journal).toMatchObject({ bootstrap: false, low: first.binding.journal.receipt.highWater })
  const entries = await packets(f.store, second),
    changes = entries
      .filter(x => x.streamIndex === 3)
      .flatMap(x => (x.packet.kind === 'frame' ? x.packet.page.changes : []))
  expect(changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ present: false, metadata: expect.objectContaining({ id1: f.original.txLabelId }) }),
      expect.objectContaining({
        present: true,
        row: expect.objectContaining({ txLabelId: added.txLabelId, label: 'next label' })
      })
    ])
  )
  expect(changes).toHaveLength(2)
  expect(changes.every(x => BigInt(x.metadata.revision) > BigInt(first.binding.journal.receipt.highWater))).toBe(true)
})

test('malformed and matching future positions close the real source without reserving artifact capacity', async () => {
  const f = await fixture(),
    malformed = await f.open()
  await expect(
    captureSnapshotJournalArchiveSource(malformed, f.store, { binding: 'invalid', highWater: '0' })
  ).rejects.toThrow()
  expect(malformed.isOpen).toBe(false)
  const future = await f.open()
  await expect(
    captureSnapshotJournalArchiveSource(future, f.store, {
      binding: future.receipt.binding,
      highWater: (BigInt(future.receipt.highWater) + 1n).toString()
    })
  ).rejects.toThrow('exceeds')
  expect(future.isOpen).toBe(false)
  expect(await f.storage.knex('snapshot_archive_capacity').first()).toMatchObject({ archives: 0, reservedBytes: 0 })
})

test('actual physical reader close must finish before ready publication; foreground SQL remains available', async () => {
  const f = await fixture(),
    source = await f.open(),
    original = Backend.closeSnapshotJournalCapturePool
  let entered!: () => void, release!: () => void
  const closing = new Promise<void>(resolve => {
      entered = resolve
    }),
    gate = new Promise<void>(resolve => {
      release = resolve
    })
  let held = false
  jest.spyOn(Backend, 'closeSnapshotJournalCapturePool').mockImplementation(async (owner, connection) => {
    const rows: Array<{ query_only: number }> = await owner.raw('PRAGMA query_only').connection(connection)
    if (rows[0].query_only === 1 && !held) {
      held = true
      entered()
      await gate
    }
    await original(owner, connection)
  })
  const capture = captureSnapshotJournalArchiveSource(source, f.store)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      closing,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Actual reader close not reached')), 5000)
      })
    ])
    expect(await f.storage.knex('snapshot_archives').first()).toMatchObject({ state: 'building' })
    expect(await f.storage.knex('snapshot_archive_capacity').first()).toMatchObject({
      archives: 1,
      reservedBytes: snapshotArchiveLimits.archiveBytes
    })
    await f.storage.findOrInsertTxLabel(f.user.userId, 'foreground while closing')
    release()
    const manifest = await capture
    expect(await f.store.inspectJournal(identityKey, manifest.archiveId)).toMatchObject({ digest: manifest.digest })
    const entries = await packets(f.store, manifest)
    expect(
      entries.some(
        x =>
          x.packet.kind === 'frame' &&
          x.packet.page.changes.some(c => c.present && c.row.label === 'foreground while closing')
      )
    ).toBe(false)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    release()
    await capture.catch(() => undefined)
  }
})
