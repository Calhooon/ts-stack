import { knex } from 'knex'
import { withBrc38NativePrivateContractFixture } from './Brc38NativePrivateContractFixture'
import {
  installBrc38NativeLocalBaselineGeneration,
  hasBrc38NativeLocalBaselineGenerationSchema,
  brc38NativeLocalBaselineSourceDefinitions,
  readBrc38NativeLocalBaselineGeneration
} from './Brc38NativeLocalBaselineGenerationNode'
import { snapshotJournalRevision } from '../snapshot/journal/SnapshotJournalRevision'

// This actual native fixture stops before sealing or publication. Its original
// small admission, genuine actor and concrete cleanup remain enforced.
test('native baseline bounded comparisons retain complete schema and exact current rollback', async () => {
  const stop = new Error('independent baseline comparison fixture stop')
  await expect(
    withBrc38NativePrivateContractFixture(async fixture => {
      await fixture.withWriter(async trx => {
        await installBrc38NativeLocalBaselineGeneration(trx, {
          maximumRows: 1024,
          ceiling: snapshotJournalRevision('100000')
        })
        const expected = await brc38NativeLocalBaselineSourceDefinitions(trx)
        const batches: Array<{ sql: string; bindings: unknown[] }> = []
        const observe = (query: { sql: string; bindings?: unknown[] }): void => {
          if (query.sql.includes('count(distinct')) batches.push({ sql: query.sql, bindings: query.bindings ?? [] })
        }
        trx.on('query', observe)
        try {
          expect(await hasBrc38NativeLocalBaselineGenerationSchema(trx)).toBe(true)
        } finally {
          trx.removeListener('query', observe)
        }
        expect(batches.length).toBeGreaterThan(0)
        expect(batches.length).toBeLessThan(expected.length)
        for (const query of batches) {
          expect(query.bindings.at(-1)).toBe(1) // Knex first() adds the fixed LIMIT binding.
          const definitions = query.bindings.slice(0, -1)
          expect(definitions.every(value => typeof value === 'string')).toBe(true)
          expect(definitions.length % 3).toBe(0)
          expect(definitions.length / 3).toBeLessThanOrEqual(8)
          const bytes = definitions.reduce<number>((total, value) => total + Buffer.byteLength(String(value)), 0)
          expect(bytes <= 8192 || definitions.length === 3).toBe(true)
        }
        const generation = await readBrc38NativeLocalBaselineGeneration(trx)
        expect(generation).toMatchObject({
          maximumRows: 1024,
          ceiling: '100000',
          records: 0,
          enabled: true,
          complete: false,
          bootstrapTable: 0,
          afterRowId: null
        })
        const geometry = async (): Promise<unknown[]> => await trx.raw('PRAGMA page_count')
        const originalGeometry = await geometry()
        const objects = async (): Promise<
          Array<{ position: string; type: string; name: string; rootpage: number }>
        > => {
          const result: Array<{ position: string; type: string; name: string; rootpage: number }> = []
          let after: string | undefined
          for (;;) {
            const query = trx('main.sqlite_schema')
              .select(trx.raw('CAST(rowid AS TEXT) AS position'), 'type', 'name', 'rootpage')
              .orderBy('rowid')
              .limit(32)
            if (after !== undefined) query.whereRaw('rowid > CAST(? AS INTEGER)', [after])
            const page = await query
            if (page.length === 0) return result
            result.push(...page)
            if (result.length > 1024) throw new Error('Independent schema inventory exceeds its fixed fixture bound')
            after = page.at(-1).position
          }
        }
        const originalObjects = await objects()
        const observers = expected.filter(sql =>
          /^CREATE TRIGGER [A-Za-z0-9_]+ AFTER UPDATE ON snapshot_reconciliation_window_progress BEGIN /.test(sql)
        )
        expect(observers).toHaveLength(1)
        const observer = observers[0],
          name = /^CREATE TRIGGER ([A-Za-z0-9_]+) /.exec(observer)![1]
        expect(name).toMatch(/^brc38_local_baseline_(?:s46|snapshot_reconciliation_window_progress)_update$/)
        for (const changed of [false, true]) {
          await trx.raw('SAVEPOINT actual_baseline_batch_negative')
          try {
            await trx.raw('DROP TRIGGER ??', [name])
            if (changed) await trx.raw(observer.replace('BEGIN ', 'BEGIN SELECT 1; '))
            await expect(hasBrc38NativeLocalBaselineGenerationSchema(trx)).rejects.toThrow(
              'Local baseline original generation, schema or progress differs'
            )
          } finally {
            await trx.raw('ROLLBACK TO actual_baseline_batch_negative')
            await trx.raw('RELEASE actual_baseline_batch_negative')
          }
          expect(await hasBrc38NativeLocalBaselineGenerationSchema(trx)).toBe(true)
          expect(await readBrc38NativeLocalBaselineGeneration(trx)).toEqual(generation)
          expect(await geometry()).toEqual(originalGeometry)
          expect(await objects()).toEqual(originalObjects)
        }
        fixture.check()
      })
      throw stop
    })
  ).rejects.toBe(stop)
}, 120000)

test('genuine ordinary SQLite cannot claim a native baseline actor from matching data', async () => {
  const k = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  try {
    await k.raw('CREATE TABLE brc38_local_baseline_clock(slot INTEGER PRIMARY KEY, epoch TEXT)')
    await k.transaction(async trx => {
      await expect(hasBrc38NativeLocalBaselineGenerationSchema(trx)).rejects.toThrow(
        'Local baseline journal requires its actual current native transaction'
      )
    })
  } finally {
    await k.destroy()
  }
})
