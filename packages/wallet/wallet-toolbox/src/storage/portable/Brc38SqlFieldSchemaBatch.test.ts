import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnexBrc38StagingStore } from './KnexBrc38StagingStore'
import { readBrc38SqlBinaryDescriptors } from './Brc38SqlBinaryStaging'

let directory = '',
  store: KnexBrc38StagingStore | undefined
const data = new Uint8Array([1, 2, 3])
const sha256 = createHash('sha256').update(data).digest('hex')
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brc38-schema-batch-'))
  store = await KnexBrc38StagingStore.create(directory, {
    maximumRows: 100,
    maximumLogicalBytes: 1048576,
    maximumPhysicalBytes: 4194304,
    maximumRowBytes: 65536,
    maximumRowAllocationBytes: 65536,
    expiresAt: Date.now() + 60000
  })
  await store.beginBinaryField('transactions', 0, 'rawTx', 'base64', 3)
  await store.appendBinaryField('transactions', 0, 'rawTx', 0, data)
  await store.finishBinaryField('transactions', 0, { field: 'rawTx', encoding: 'base64', bytes: 3, sha256 })
})
afterEach(async () => {
  await store?.discard(new Error('finite schema comparison fixture cleanup'))
  await rm(directory, { recursive: true, force: true })
  store = undefined
})
async function read() {
  return await store!.knex.transaction(async trx => await readBrc38SqlBinaryDescriptors(trx, 'transactions', 0))
}
test('real descriptor reads retain exact bytes with bounded fresh catalog dispatches and statement bytes', async () => {
  let schemaQueries = 0,
    maximumStatementBytes = 0
  const observe = (query: { sql: string; bindings?: readonly unknown[] }): void => {
    if (!query.sql.includes('sqlite_schema')) return
    schemaQueries++
    maximumStatementBytes = Math.max(
      maximumStatementBytes,
      Buffer.byteLength(query.sql) +
        (query.bindings ?? []).reduce<number>(
          (sum, value) => sum + (typeof value === 'string' ? Buffer.byteLength(value) : 8),
          0
        )
    )
  }
  store!.knex.on('query', observe)
  try {
    expect(await read()).toEqual({ rawTx: { field: 'rawTx', encoding: 'base64', bytes: 3, sha256 } })
  } finally {
    store!.knex.off('query', observe)
  }
  expect(maximumStatementBytes).toBeLessThanOrEqual(32768)
  expect(schemaQueries).toBeLessThanOrEqual(2)
})

test.each([
  [
    'missing prefix',
    'DROP TRIGGER private_binary_chunks_prefix_delete',
    'Private structured immutable prefix definitions differ'
  ],
  [
    'altered prefix',
    'DROP TRIGGER private_binary_chunks_prefix_delete',
    'Private structured immutable prefix definitions differ'
  ],
  [
    'extra index',
    'CREATE INDEX private_binary_unexpected ON private_binary_fields(position)',
    'Private binary staging content or coordinate differs'
  ],
  [
    'altered table',
    'ALTER TABLE private_binary_fields ADD COLUMN unexpected TEXT',
    'Private binary staging content or coordinate differs'
  ],
  [
    'partial seal',
    'CREATE TRIGGER brc38_source_seal_incomplete BEFORE INSERT ON private_binary_fields BEGIN SELECT 1; END',
    'Authenticated private source write protection differs'
  ]
])('a successful real read never caches admission across %s', async (variant, sql, message) => {
  expect((await read()).rawTx.sha256).toBe(sha256)
  await store!.knex.raw(sql)
  if (variant === 'altered prefix')
    await store!.knex.raw(
      'CREATE TRIGGER private_binary_chunks_prefix_delete BEFORE DELETE ON private_binary_chunks BEGIN SELECT 1; END'
    )
  await expect(read()).rejects.toThrow(message)
})
