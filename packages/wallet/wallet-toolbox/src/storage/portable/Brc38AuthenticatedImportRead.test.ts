import { previewDestinationFixture, previewPrivateFixture, previewReceiptPolicy } from './Brc38ImportPreviewFixture'
import { previewBrc38PrivateImport } from './Brc38PrivateImportPreviewNode'
import { brc38StageTables } from './Brc38SemanticStage'
import type { Brc38AuthenticatedImportReader } from './KnexBrc38StagingStore'
import { runInSeries } from '../../utility/runInSeries'
describe('actual authenticated bounded private import reads', () => {
  let target: Awaited<ReturnType<typeof previewDestinationFixture>>,
    staged: Awaited<ReturnType<typeof previewPrivateFixture>>
  const store = () => staged.value.reservation.store
  beforeEach(async () => {
    target = await previewDestinationFixture()
    staged = await previewPrivateFixture()
    await previewBrc38PrivateImport(store(), target.storage, 'restore', previewReceiptPolicy)
  })
  afterEach(async () => {
    try {
      await staged?.close()
    } finally {
      await target?.close()
    }
  })
  test('actual sealed header and thirteen indexed counts/rows match the authenticated archive without target writes', async () => {
    let escaped!: Readonly<Brc38AuthenticatedImportReader>
    const queries: string[] = []
    store().knex.on('query', (query: { sql: string }) => {
      queries.push(query.sql)
    })
    await store().withAuthenticatedImportRead(async (json, metadata, reader) => {
      escaped = reader
      expect(JSON.parse(json).archiveSha256).toBe(staged.selected.binding.archiveSha256)
      const header = await reader.header()
      expect(header.user.identityKey).toBe(staged.selected.binding.identityKey)
      let total = 0
      await runInSeries(brc38StageTables, async table => {
        const count = await reader.count(table)
        total += count
        if (count > 0)
          expect(await reader.row(table, 0)).toEqual(
            await store()
              .knex('rows')
              .where({ tableName: table, position: 0 })
              .first('payload')
              .then(row => JSON.parse(row.payload))
          )
        expect(await reader.row(table, count)).toBeUndefined()
      })
      expect(total).toBe(metadata.rows)
    })
    await expect(escaped.header()).rejects.toThrow('unavailable')
    expect(queries.some(sql => /offset|count\s*\(/i.test(sql))).toBe(false)
    expect(await target.writer('users')).toEqual([])
  })
  test('unawaited actual native read is drained before preparation releases the kernel owner', async () => {
    let read!: Promise<number>,
      settled = false
    const result = await store().withAuthenticatedImportRead(async (_json, _metadata, reader) => {
      read = reader.count(brc38StageTables[0])
      void read.then(() => {
        settled = true
      })
      await expect(store().close()).rejects.toThrow('Wait for owned')
      await expect(store().readImportPreview()).rejects.toThrow('already owned')
      return 'prepared'
    })
    expect(result).toBe('prepared')
    expect(settled).toBe(true)
    expect(await read).toBeGreaterThanOrEqual(0)
    expect(await store().readImportPreview()).toBeDefined()
  })
  test.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'invalid row coordinate %s refuses before payload SQL',
    async index => {
      await expect(
        store().withAuthenticatedImportRead(
          async (_json, _metadata, reader) => await reader.row(brc38StageTables[0], index)
        )
      ).rejects.toThrow('coordinate')
    }
  )
  test('oversized stored payload is refused at native extent before payload loading', async () => {
    const coordinate = await store().knex('rows').first('tableName', 'position')
    await store()
      .knex('rows')
      .where(coordinate)
      .update({ payload: 'x'.repeat(store().limits.maximumRowBytes + 1) })
    const queries: string[] = []
    store().knex.on('query', (query: { sql: string }) => {
      queries.push(query.sql)
    })
    await expect(
      store().withAuthenticatedImportRead(
        async (_json, _metadata, reader) => await reader.row(coordinate.tableName, coordinate.position)
      )
    ).rejects.toThrow('length is inconsistent')
    expect(queries.some(sql => /^select `payload`/i.test(sql))).toBe(false)
  })
})
