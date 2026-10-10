import { previewPrivateFixture, previewReceiptPolicy } from './Brc38ImportPreviewFixture'
import { withBrc38NativePrivateContractFixture } from './Brc38NativePrivateContractFixture'
import {
  installBrc38NativeLocalPackedLayout,
  hasBrc38NativeLocalPackedLayout
} from './Brc38NativeLocalPackedLayoutNode'
import {
  installBrc38NativeLocalBaselineGeneration,
  readBrc38NativeLocalBaselineGeneration
} from './Brc38NativeLocalBaselineGenerationNode'
import {
  installSnapshotJournalSqliteGeneration,
  readSnapshotJournalSqliteGeneration
} from '../snapshot/journal/SnapshotJournalSqliteGeneration'
import { snapshotJournalRevision, MAX_SNAPSHOT_JOURNAL_REVISION } from '../snapshot/journal/SnapshotJournalRevision'
import type { Knex } from 'knex'

/** Independent complete catalogue observation in one genuine retained view.
 * Metadata pages and exact BLOB windows keep the native response bounded;
 * the production reader's per-source object bound is not a database bound. */
async function catalogue(k: Knex.Transaction): Promise<unknown> {
  const result: Array<{
    position: number
    type: string
    name: string
    tbl_name: string
    rootpage: number
    sql: string | null
  }> = []
  let position = 0
  while (true) {
    const rows: Array<{
      position: number
      type: string
      name: string
      tbl_name: string
      rootpage: number
      sqlBytes: number | null
    }> = await k('main.sqlite_schema')
      .where('rowid', '>', position)
      .orderBy('rowid')
      .select(
        k.raw('rowid AS position'),
        'type',
        'name',
        'tbl_name',
        'rootpage',
        k.raw('length(CAST(sql AS BLOB)) AS sqlBytes')
      )
      .limit(8)
    if (rows.length === 0) return result
    for (const row of rows) {
      expect(Number.isSafeInteger(row.position)).toBe(true)
      expect(row.position).toBeGreaterThan(position)
      let sql: string | null = null
      if (row.sqlBytes !== null) {
        expect(Number.isSafeInteger(row.sqlBytes)).toBe(true)
        expect(row.sqlBytes).toBeGreaterThanOrEqual(0)
        expect(row.sqlBytes).toBeLessThanOrEqual(65536)
        const parts: Buffer[] = []
        for (let offset = 0; offset < row.sqlBytes; offset += 4096) {
          const bytes = Math.min(4096, row.sqlBytes - offset),
            part = (
              await k('main.sqlite_schema')
                .where('rowid', row.position)
                .select(k.raw('substr(CAST(sql AS BLOB),?,?) AS part', [offset + 1, bytes]))
                .first()
            ).part
          expect(Buffer.isBuffer(part)).toBe(true)
          expect(part.length).toBe(bytes)
          parts.push(part)
        }
        sql = Buffer.concat(parts, row.sqlBytes).toString('utf8')
      }
      result.push({
        position: row.position,
        type: row.type,
        name: row.name,
        tbl_name: row.tbl_name,
        rootpage: row.rootpage,
        sql
      })
      position = row.position
    }
  }
}
async function installAdditionalLayout(k: Knex.Transaction): Promise<void> {
  await installBrc38NativeLocalPackedLayout(k)
  await installBrc38NativeLocalBaselineGeneration(k, {
    maximumRows: 1024,
    ceiling: snapshotJournalRevision('100000')
  })
}

test('private preview retains its original four-MiB authenticated admission by default', async () => {
  const fixture = await previewPrivateFixture()
  try {
    expect(fixture.selected.limits.maximumPhysicalBytes).toBe(4194304)
    expect(fixture.value.reservation.store.limits.maximumPhysicalBytes).toBe(4194304)
    expect(fixture.selected.limits.maximumRowAllocationBytes).toBe(65536)
  } finally {
    await fixture.close()
  }
}, 30000)

test('explicit preview admission rejects invalid physical allowances before opening a fixture', async () => {
  for (const maximum of [0, 1048575, 16777217, Number.MAX_SAFE_INTEGER, Number.NaN])
    await expect(previewPrivateFixture(undefined, undefined, 65536, maximum)).rejects.toThrow(
      'explicit bounded physical allowance'
    )
})

test('the original four-MiB native allowance refuses the complete layout and retains real rollback state', async () => {
  const stopped = new Error('Independent small-admission exhaustion proof completed')
  await expect(
    withBrc38NativePrivateContractFixture(
      async fixture => {
        expect(fixture.store.limits.maximumPhysicalBytes).toBe(4194304)
        expect(fixture.store.limits.maximumRowBytes).toBe(65536)
        expect(fixture.store.limits.maximumRowAllocationBytes).toBe(65536)
        await fixture.withWriter(async k => await installAdditionalLayout(k))
        const before = await fixture.withRead(async k => ({
          schema: await catalogue(k),
          baseline: await readBrc38NativeLocalBaselineGeneration(k),
          settings: await k('settings').select('*'),
          pages: await k.raw('PRAGMA page_count'),
          maximum: await k.raw('PRAGMA max_page_count')
        }))
        expect(before.maximum).toEqual([{ max_page_count: 336 }])
        let failure: unknown
        try {
          await fixture.withWriter(
            async k =>
              await installSnapshotJournalSqliteGeneration(
                k,
                snapshotJournalRevision(MAX_SNAPSHOT_JOURNAL_REVISION),
                previewReceiptPolicy
              )
          )
        } catch (cause) {
          failure = cause
        }
        const origin = failure instanceof AggregateError ? failure.cause : failure
        expect(origin).toMatchObject({ code: 'SQLITE_FULL', nativeCode: 13 })
        await fixture.withRead(async k => {
          expect(await catalogue(k)).toEqual(before.schema)
          expect(await readBrc38NativeLocalBaselineGeneration(k)).toEqual(before.baseline)
          expect(await k('settings').select('*')).toEqual(before.settings)
          expect(await k.raw('PRAGMA page_count')).toEqual(before.pages)
          expect(await k.raw('PRAGMA max_page_count')).toEqual(before.maximum)
          expect(await hasBrc38NativeLocalPackedLayout(k)).toBe(true)
          expect(await k.schema.hasTable('snapshot_journal_generation')).toBe(false)
        })
        fixture.check()
        throw stopped
      },
      'before-journal',
      4194304,
      undefined,
      65536
    )
  ).rejects.toBe(stopped)
}, 30000)

test('explicit full-feature native admission seals the complete actual packed baseline and journal', async () => {
  let completed = false
  await withBrc38NativePrivateContractFixture(
    async fixture => {
      expect(fixture.store.limits.maximumPhysicalBytes).toBe(16777216)
      await fixture.withWriter(async k => await installAdditionalLayout(k))
    },
    'before-journal',
    16777216,
    async fixture => {
      await fixture.withRead(async k => {
        const generation = await readSnapshotJournalSqliteGeneration(k, previewReceiptPolicy),
          baseline = await readBrc38NativeLocalBaselineGeneration(k),
          pages = (await k.raw('PRAGMA page_count'))[0].page_count
        expect(
          await k.raw(
            'SELECT brc38_runtime_limit(0) AS address,brc38_runtime_limit(1) AS heap,brc38_runtime_limit(2) AS descriptors'
          )
        ).toEqual([{ address: 134217728, heap: 51380224, descriptors: 32 }])
        expect(generation.complete).toBe(true)
        expect(generation.enabled).toBe(true)
        expect(baseline.enabled).toBe(true)
        expect(await hasBrc38NativeLocalPackedLayout(k)).toBe(true)
        expect(await k.raw('PRAGMA max_page_count')).toEqual([{ max_page_count: 1360 }])
        expect(pages).toBeGreaterThan(336)
        expect(pages).toBeLessThanOrEqual(1360)
        expect(fixture.store.limits.maximumPhysicalBytes).toBe(16777216)
        expect(fixture.store.limits.maximumRowBytes).toBe(65536)
        expect(fixture.store.limits.maximumRowAllocationBytes).toBe(16777216)
      })
      fixture.check()
      completed = true
    }
  )
  expect(completed).toBe(true)
}, 30000)

test('explicit full working admission retains the original serialized row limit and rejects invalid allocation before opening', async () => {
  const fixture = await previewPrivateFixture(undefined, undefined, 65536, 16777216, 16777216)
  try {
    expect(fixture.selected.limits.maximumRowBytes).toBe(65536)
    expect(fixture.selected.limits.maximumRowAllocationBytes).toBe(16777216)
    expect(fixture.value.reservation.store.limits.maximumRowBytes).toBe(65536)
    expect(fixture.value.reservation.store.limits.maximumRowAllocationBytes).toBe(16777216)
  } finally {
    await fixture.close()
  }
  for (const maximum of [0, -1, 16777217, Number.MAX_SAFE_INTEGER, Number.NaN])
    await expect(previewPrivateFixture(undefined, undefined, 65536, 16777216, maximum)).rejects.toThrow(
      'explicit bounded allocation allowance'
    )
}, 30000)
