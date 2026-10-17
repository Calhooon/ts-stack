import { createHash } from 'node:crypto'
import { snapshotHttpFixture } from '../../../../test/utils/snapshotArchiveHttpFixtures'
import * as Archive from '../archive/KnexSnapshotArchiveSource'
import { SnapshotResourceLimitError } from '../SnapshotResourceLimitError'
import { snapshotJournalRevision } from './SnapshotJournalRevision'
import type { SnapshotJournalReconciliationSource, SnapshotJournalDeltaRequest } from './SnapshotJournalProvider'
import type { SnapshotJournalFieldDelta, SnapshotJournalFieldReader } from './SnapshotJournalFieldTypes'

let fixture: Awaited<ReturnType<typeof snapshotHttpFixture>>
const raw = Buffer.from(Array.from({ length: 2097153 }, (_, at) => (at * 31 + 7) % 256))
const text = 'independent\0雪😀'.repeat(30000)
const request: SnapshotJournalDeltaRequest = {
  bootstrap: true,
  stream: 'scope',
  tableId: 0,
  low: snapshotJournalRevision('0'),
  maximumRows: 8,
  maximumBytes: 16384
}
let source: SnapshotJournalReconciliationSource | undefined
beforeAll(async () => {
  fixture = await snapshotHttpFixture()
})
beforeEach(async () => {
  await fixture.storage.knex('transactions').where('transactionId', 1).update({ rawTx: raw, description: text })
})
afterEach(async () => {
  await source?.close()
  await source?.closed
  source = undefined
  jest.restoreAllMocks()
})
afterAll(async () => {
  await fixture?.close()
})
function present(change: SnapshotJournalFieldDelta | undefined) {
  if (change === undefined || !change.present) throw new Error('Independent actual source row is required')
  return change
}

test('actual field metadata omits large bytes/TEXT, while bounded extents remain in the original view across a foreground write', async () => {
  const create = Archive.createKnexSnapshotArchiveSource
  const payloads: number[] = []
  let responses = 0
  jest.spyOn(Archive, 'createKnexSnapshotArchiveSource').mockImplementation((storage, view, header) => {
    storage.knex.on('query-response', (rows: unknown) => {
      responses++
      if (!Array.isArray(rows)) return
      for (const row of rows) {
        if (row === null || typeof row !== 'object') continue
        for (const name of ['rawTx', 'description', 'bytes']) {
          const value = Reflect.get(row, name)
          if (value instanceof Uint8Array) payloads.push(value.byteLength)
          if (typeof value === 'string') payloads.push(Buffer.byteLength(value))
        }
      }
    })
    return create(storage, view, header)
  })
  source = await fixture.storage.openCurrentSnapshotJournalSource(fixture.identityKey)
  const reader = source.fieldDeltaReader
  if (reader === undefined) throw new Error('Actual field source was not issued')
  payloads.length = 0
  const page = await reader.readPage(request),
    row = present(page.changes.find(value => value.metadata.id1 === 1))
  expect(row.row).not.toHaveProperty('rawTx')
  expect(row.row).not.toHaveProperty('description')
  expect(row.row.noSendExpiryReclaimRawTx).toBeNull()
  expect(row.fields).not.toHaveProperty('noSendExpiryReclaimRawTx')
  expect(row.fields.rawTx).toEqual({ kind: 'binary', bytes: raw.length })
  expect(row.fields.description).toEqual({ kind: 'utf8', bytes: Buffer.byteLength(text) })
  expect(page.metadataBytes).toBeLessThanOrEqual(request.maximumBytes)
  expect(page.fieldBytes).toBeGreaterThan(raw.length)
  expect(responses).toBeGreaterThan(0)
  expect(payloads.every(size => size === 0)).toBe(true)
  expect(await reader.readExtent(request, row.metadata, 'rawTx', 65530, 65536, row.fields.rawTx)).toEqual(
    new Uint8Array(raw.subarray(65530, 65530 + 65536))
  )
  const utf8 = Buffer.from(text)
  expect(await reader.readExtent(request, row.metadata, 'description', 65530, 65536, row.fields.description)).toEqual(
    new Uint8Array(utf8.subarray(65530, 65530 + 65536))
  )
  await fixture.storage
    .knex('transactions')
    .where('transactionId', 1)
    .update({ rawTx: Buffer.alloc(raw.length, 0xab), description: 'new current text' })
  expect(await reader.readExtent(request, row.metadata, 'rawTx', 0, 65536, row.fields.rawTx)).toEqual(
    new Uint8Array(raw.subarray(0, 65536))
  )
  expect(payloads.every(size => size <= 65536)).toBe(true)
  const hash = createHash('sha256')
  for (let offset = 0; offset < raw.length; offset += 65536)
    hash.update(
      await reader.readExtent(
        request,
        row.metadata,
        'rawTx',
        offset,
        Math.min(65536, raw.length - offset),
        row.fields.rawTx
      )
    )
  expect(hash.digest('hex')).toBe(createHash('sha256').update(raw).digest('hex'))
  await source.close()
  await source.closed
  await expect(reader.readExtent(request, row.metadata, 'rawTx', 0, 1, row.fields.rawTx)).rejects.toThrow()
  source = await fixture.storage.openCurrentSnapshotJournalSource(fixture.identityKey)
  const nextReader = source.fieldDeltaReader
  if (nextReader === undefined) throw new Error('Fresh actual field source is required')
  const next = present((await nextReader.readPage(request)).changes.find(value => value.metadata.id1 === 1))
  expect(next.metadata.revision).not.toBe(row.metadata.revision)
  expect(await nextReader.readExtent(request, next.metadata, 'rawTx', 0, 1, next.fields.rawTx)).toEqual(
    Uint8Array.of(0xab)
  )
})

test('a bounded ordinary full-row read refuses the real large payload instead of returning a marker', async () => {
  source = await fixture.storage.openCurrentSnapshotJournalSource(fixture.identityKey)
  const page = await source.fieldDeltaReader!.readPage(request),
    row = present(page.changes.find(value => value.metadata.id1 === 1))
  const failed = source.readDeltaPage(
    { ...request, bootstrap: undefined, low: snapshotJournalRevision((BigInt(row.metadata.revision) - 1n).toString()) },
    async () => undefined
  )
  const error = await failed.catch((error: unknown) => error)
  expect(error).toBeInstanceOf(SnapshotResourceLimitError)
  await expect(source.close()).rejects.toBe(error)
  await expect(source.closed).rejects.toBe(error)
  source = undefined
})

test('copied header/coordinates, another profile, changed length and unknown fields cannot select payload bytes', async () => {
  source = await fixture.storage.openCurrentSnapshotJournalSource(fixture.identityKey)
  const reader = source.fieldDeltaReader!
  const actualUser = await fixture.storage.knex('users').where('identityKey', fixture.identityKey).first('userId')
  source.user.userId = 999
  source.receipt.highWater = snapshotJournalRevision('9223372036854775807')
  const page = await reader.readPage(request),
    row = present(page.changes.find(value => value.metadata.id1 === 1))
  expect(page.changes.every(value => !value.present || value.row.userId === actualUser.userId)).toBe(true)
  expect(page.changes.some(value => value.metadata.id1 === 2)).toBe(false)
  expect(BigInt(row.metadata.revision)).toBeGreaterThan(1n)
  await source.close()
  await source.closed
  source = undefined
  const cases: Array<(reader: SnapshotJournalFieldReader, row: ReturnType<typeof present>) => Promise<Uint8Array>> = [
    (reader, row) => reader.readExtent(request, { ...row.metadata, id1: 2 }, 'rawTx', 0, 1, row.fields.rawTx),
    (reader, row) =>
      reader.readExtent(request, row.metadata, 'rawTx', 0, 1, { ...row.fields.rawTx, bytes: raw.length - 1 }),
    (reader, row) => reader.readExtent(request, row.metadata, 'rawTx', 0, 65537, row.fields.rawTx),
    (reader, row) => reader.readExtent(request, row.metadata, 'rawTx', -1, 1, row.fields.rawTx),
    (reader, row) => reader.readExtent(request, row.metadata, 'rawTx; SELECT secret', 0, 1, row.fields.rawTx),
    (reader, row) => reader.readExtent(request, row.metadata, 'rawTx', 0, 1, { ...row.fields.rawTx, kind: 'utf8' }),
    (reader, row) =>
      reader.readExtent(
        request,
        { ...row.metadata, revision: snapshotJournalRevision('1') },
        'rawTx',
        0,
        1,
        row.fields.rawTx
      )
  ]
  for (const refuse of cases) {
    source = await fixture.storage.openCurrentSnapshotJournalSource(fixture.identityKey)
    const current = source.fieldDeltaReader!
    const selected = present((await current.readPage(request)).changes.find(value => value.metadata.id1 === 1))
    const outcome = await refuse(current, selected).then(
      value => ({ value }),
      (error: unknown) => ({ error })
    )
    expect(outcome).toHaveProperty('error')
    if (!('error' in outcome)) throw new Error('The actual retained source accepted invalid field coordinates')
    await expect(source.close()).rejects.toBe(outcome.error)
    await expect(source.closed).rejects.toBe(outcome.error)
    source = undefined
  }
})

test('NULL, empty and embedded-NUL Unicode fields retain distinct logical values', async () => {
  const description = '\ufeffstart\0雪😀end'
  await fixture.storage
    .knex('transactions')
    .where('transactionId', 1)
    .update({ rawTx: Buffer.alloc(0), description })
  source = await fixture.storage.openCurrentSnapshotJournalSource(fixture.identityKey)
  const reader = source.fieldDeltaReader!,
    page = await reader.readPage(request),
    row = present(page.changes.find(value => value.metadata.id1 === 1))
  expect(row.row.noSendExpiryReclaimRawTx).toBeNull()
  expect(row.fields).not.toHaveProperty('noSendExpiryReclaimRawTx')
  expect(row.fields.rawTx).toEqual({ kind: 'binary', bytes: 0 })
  expect(await reader.readExtent(request, row.metadata, 'rawTx', 0, 0, row.fields.rawTx)).toEqual(new Uint8Array())
  const actual = await reader.readExtent(
    request,
    row.metadata,
    'description',
    0,
    row.fields.description.bytes,
    row.fields.description
  )
  expect(actual).toEqual(new Uint8Array(Buffer.from(description)))
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(actual)
  expect(decoded).toBe(description)
  const full = await source.readDeltaPage(request, async () => undefined),
    complete = full.page.changes.find(value => value.metadata.id1 === 1)
  if (complete === undefined || !complete.present) throw new Error('Full bounded source row is missing')
  expect(complete.row.rawTx).toEqual(Buffer.alloc(0))
  expect(complete.row.description).toBe(description)
  expect(complete.row.noSendExpiryReclaimRawTx).toBeNull()
})
