import {
  snapshotJournalCapturedIdentitiesDdl,
  readSnapshotJournalCapturedIdentities
} from './SnapshotJournalCapturedIdentities'
import { readSnapshotJournalNotificationMappings } from './SnapshotJournalDestinationIdentities'
import { brc38ImportTargetIndexName } from '../../portable/Brc38ImportTargetIndexes'
import { knex, type Knex } from 'knex'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotJournalRevision } from './SnapshotJournalRevision'
import { snapshotJournalReceiptBinding } from './SnapshotJournalReceipt'
import {
  snapshotJournalDestinationWindowDdl,
  beginSnapshotJournalDestinationWindow,
  advanceSnapshotJournalDestinationWindow,
  readSnapshotJournalDestinationWindow,
  retireSnapshotJournalDestinationWindow,
  replaceSnapshotJournalDestinationWindow,
  type SnapshotJournalDestinationBinding,
  type SnapshotJournalDestinationCheckpoint
} from './SnapshotJournalDestinationWindow'
import {
  prepareSnapshotJournalIdentityLedger,
  snapshotJournalIdentityLedgerDdl,
  type SnapshotJournalIdentityReference
} from './SnapshotJournalIdentityLedger'

jest.setTimeout(30000)
let db: Knex
let directory: string
let filename: string
let state: SnapshotJournalDestinationCheckpoint
let binding: SnapshotJournalDestinationBinding
const sessionId = '91'.repeat(32)
const identityKey = '02' + '22'.repeat(32)

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'journal-destination-window-'))
  filename = join(directory, 'destination.sqlite')
  db = knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: { min: 0, max: 1 }
  })
  await db.raw('PRAGMA journal_mode = WAL')
  await db.raw('PRAGMA busy_timeout = 0')
  await db.raw('CREATE TABLE users(userId INTEGER PRIMARY KEY,identityKey TEXT NOT NULL UNIQUE,activeStorage TEXT)')
  await db.raw('CREATE TABLE settings(storageIdentityKey TEXT NOT NULL,chain TEXT NOT NULL)')
  await db.raw('CREATE TABLE snapshot_sync_primary_epochs(userId INTEGER PRIMARY KEY,epoch INTEGER NOT NULL)')
  await db.raw(
    'CREATE TRIGGER test_primary_change AFTER UPDATE OF activeStorage ON users WHEN OLD.activeStorage IS NOT NEW.activeStorage BEGIN INSERT INTO snapshot_sync_primary_epochs(userId,epoch) VALUES(NEW.userId,1) ON CONFLICT(userId) DO UPDATE SET epoch=epoch+1; END'
  )
  await db.raw('CREATE TABLE test_staged_rows(id INTEGER PRIMARY KEY,value TEXT NOT NULL)')
  await db('users').insert({
    userId: 7,
    identityKey,
    activeStorage: 'destination'
  })
  await db('settings').insert({
    storageIdentityKey: 'destination',
    chain: 'mock'
  })
  await db.raw(snapshotJournalDestinationWindowDdl(db))
  const source = {
    backend: '11'.repeat(32),
    epoch: '11111111-2222-4333-8444-555555555555',
    source: '33'.repeat(32),
    schema: '44'.repeat(32),
    storageIdentity: 'source',
    identityKey,
    userId: 3,
    chain: 'mock'
  }
  binding = {
    source,
    receipt: {
      requestId: '55'.repeat(32),
      binding: snapshotJournalReceiptBinding(source),
      highWater: snapshotJournalRevision('1000'),
      floor: snapshotJournalRevision('0'),
      expiresAt: Date.now() + 60000
    },
    low: snapshotJournalRevision('1'),
    destinationBackend: '66'.repeat(32),
    destinationStorageIdentity: 'destination',
    destinationUserId: 7,
    primaryEpoch: snapshotJournalRevision('0'),
    activeStorage: 'destination'
  }
  for (const sql of snapshotJournalIdentityLedgerDdl(db)) await db.raw(sql)
  state = await begin()
  for (let stream = 0; stream < 15; stream++) {
    state = (
      await db.transaction(
        async trx =>
          await advanceSnapshotJournalDestinationWindow(
            trx,
            binding,
            state,
            { phase: 'intake', examined: 0, complete: true },
            async () => undefined
          )
      )
    ).checkpoint
  }
})
afterEach(async () => {
  try {
    await db.destroy()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function begin(): Promise<SnapshotJournalDestinationCheckpoint> {
  return await db.transaction(async trx => await beginSnapshotJournalDestinationWindow(trx, binding, sessionId))
}

function reference(
  incomingId = 10,
  generation = '2',
  naturalIdentity = 'a'.repeat(64),
  required = false
): SnapshotJournalIdentityReference {
  return {
    tableId: 4,
    incomingId,
    generation: snapshotJournalRevision(generation),
    naturalIdentity,
    required
  }
}
async function write(reference: SnapshotJournalIdentityReference, localId: number, maximumMappings = 8): Promise<void> {
  await db.transaction(async trx => {
    const prepared = await prepareSnapshotJournalIdentityLedger(trx, binding, state, [reference], {
      maximumMappings
    })
    await prepared.persist(new Map([['4:' + reference.incomingId, localId]]))
  })
}

test('keeps renumbered destination IDs for unchanged required parents', async () => {
  await write(reference(), 701)
  await db.transaction(async trx => {
    const prepared = await prepareSnapshotJournalIdentityLedger(
      trx,
      binding,
      state,
      [reference(10, '2', 'a'.repeat(64), true)],
      { maximumMappings: 8 }
    )
    expect(prepared.associations.get('4:10')).toEqual({
      generation: '2',
      naturalIdentity: 'a'.repeat(64),
      localId: 701
    })
    expect(prepared.previous.size).toBe(0)
    await prepared.persist(new Map([['4:10', 701]]))
  })
  expect(await db('snapshot_reconciliation_identity_budgets').select('mappings')).toEqual([{ mappings: 1 }])
})

test('exposes a deleted and reused source ID without inheriting its previous local ID', async () => {
  await write(reference(), 701)
  await db('test_staged_rows').insert({ id: 701, value: 'independently shared old object' })
  await db.transaction(async trx => {
    const prepared = await prepareSnapshotJournalIdentityLedger(
      trx,
      binding,
      state,
      [reference(10, '3', 'b'.repeat(64))],
      { maximumMappings: 8 }
    )
    expect(prepared.associations.size).toBe(0)
    expect(prepared.previous.get('4:10')).toEqual({
      generation: '2',
      naturalIdentity: 'a'.repeat(64),
      localId: 701
    })
    await prepared.persist(new Map([['4:10', 702]]))
  })
  expect(await db('test_staged_rows')).toEqual([{ id: 701, value: 'independently shared old object' }])
  expect(await db('snapshot_reconciliation_identity_maps').select('generation', 'localId')).toEqual([
    { generation: '3', localId: 702 }
  ])
})

test('requires exact acknowledged generation and natural identity for a parent', async () => {
  await write(reference(), 701)
  await expect(
    db.transaction(
      async trx =>
        await prepareSnapshotJournalIdentityLedger(trx, binding, state, [reference(10, '3', 'b'.repeat(64), true)], {
          maximumMappings: 8
        })
    )
  ).rejects.toThrow('Invalid, stale')
  expect(await db('snapshot_reconciliation_identity_maps').select('generation', 'localId')).toEqual([
    { generation: '2', localId: 701 }
  ])
})

test('reports a natural identity change even within the same physical generation', async () => {
  await write(reference(), 701)
  await db.transaction(async trx => {
    const prepared = await prepareSnapshotJournalIdentityLedger(
      trx,
      binding,
      state,
      [reference(10, '2', 'b'.repeat(64))],
      { maximumMappings: 8 }
    )
    expect(prepared.associations.size).toBe(0)
    expect(prepared.previous.get('4:10')?.localId).toBe(701)
    await prepared.persist(new Map([['4:10', 702]]))
  })
  expect(await db('snapshot_reconciliation_identity_maps').select('naturalIdentity', 'localId')).toEqual([
    { naturalIdentity: 'b'.repeat(64), localId: 702 }
  ])
})

test('outer rollback preserves the prior association and mapping charge', async () => {
  await write(reference(), 701)
  await expect(
    db.transaction(async trx => {
      const prepared = await prepareSnapshotJournalIdentityLedger(
        trx,
        binding,
        state,
        [reference(10, '3', 'b'.repeat(64)), reference(11)],
        { maximumMappings: 8 }
      )
      await prepared.persist(
        new Map([
          ['4:10', 702],
          ['4:11', 703]
        ])
      )
      throw new Error('identity rollback')
    })
  ).rejects.toThrow('identity rollback')
  expect(await db('snapshot_reconciliation_identity_maps').select('incomingId', 'generation', 'localId')).toEqual([
    { incomingId: 10, generation: '2', localId: 701 }
  ])
  expect(await db('snapshot_reconciliation_identity_budgets').select('mappings')).toEqual([{ mappings: 1 }])
  expect(await db.transaction(async trx => await readSnapshotJournalDestinationWindow(trx, binding))).toEqual(state)
})

test('a replacement owner sees a committed association after the reply was lost', async () => {
  await write(reference(), 701)
  const replacement = knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: { min: 0, max: 1 }
  })
  try {
    await replacement.transaction(async trx => {
      const prepared = await prepareSnapshotJournalIdentityLedger(
        trx,
        binding,
        state,
        [reference(10, '2', 'a'.repeat(64), true)],
        { maximumMappings: 8 }
      )
      expect(prepared.associations.get('4:10')?.localId).toBe(701)
      await prepared.persist(new Map([['4:10', 701]]))
    })
    expect(await replacement('snapshot_reconciliation_identity_budgets').select('mappings')).toEqual([{ mappings: 1 }])
  } finally {
    await replacement.destroy()
  }
})

test('capacity counts new keys while identity replacement preserves the existing charge', async () => {
  await write(reference(), 701, 1)
  await write(reference(10, '3', 'b'.repeat(64)), 702, 1)
  await expect(write(reference(11), 703, 1)).rejects.toThrow('Invalid, stale')
  expect(await db('snapshot_reconciliation_identity_maps').select('incomingId', 'localId')).toEqual([
    { incomingId: 10, localId: 702 }
  ])
  expect(await db('snapshot_reconciliation_identity_budgets').select('mappings')).toEqual([{ mappings: 1 }])
})

test('canonical source identity is stable when equivalent input fields are reordered', async () => {
  await write(reference(), 701)
  const reordered: SnapshotJournalDestinationBinding = {
    ...binding,
    source: Object.fromEntries(Object.entries(binding.source).reverse()) as SnapshotJournalDestinationBinding['source']
  }
  const reorderedState = Object.fromEntries(
    Object.entries(state).reverse()
  ) as unknown as SnapshotJournalDestinationCheckpoint
  await db.transaction(async trx => {
    const prepared = await prepareSnapshotJournalIdentityLedger(
      trx,
      reordered,
      reorderedState,
      [reference(10, '2', 'a'.repeat(64), true)],
      { maximumMappings: 8 }
    )
    expect(prepared.associations.get('4:10')?.localId).toBe(701)
    await prepared.persist(new Map([['4:10', 701]]))
  })
  expect(await db('snapshot_reconciliation_identity_budgets')).toHaveLength(1)
})

test('V2 profile data survives source replacement but old IDs are not reusable current associations', async () => {
  await db('snapshot_reconciliation_windows').delete()
  binding = { ...binding, lineageVersion: 2 }
  state = await begin()
  for (let stream = 0; stream < 15; stream++) {
    state = (
      await db.transaction(
        async trx =>
          await advanceSnapshotJournalDestinationWindow(
            trx,
            binding,
            state,
            { phase: 'intake', examined: 0, complete: true },
            async () => undefined
          )
      )
    ).checkpoint
  }
  await write(reference(10, '10'), 701)
  const previousBinding = binding,
    previousState = state
  const source = { ...binding.source, epoch: '22222222-2222-4333-8444-555555555555' }
  binding = {
    ...binding,
    bootstrap: true,
    source,
    low: snapshotJournalRevision('0'),
    receipt: {
      ...binding.receipt,
      requestId: '77'.repeat(32),
      binding: snapshotJournalReceiptBinding(source),
      highWater: snapshotJournalRevision('2')
    }
  }
  await db.transaction(async trx => await retireSnapshotJournalDestinationWindow(trx, previousBinding, previousState))
  state = await db.transaction(
    async trx =>
      await replaceSnapshotJournalDestinationWindow(
        trx,
        previousBinding,
        previousState,
        binding,
        '88'.repeat(32),
        async () => undefined
      )
  )
  for (let stream = 0; stream < 15; stream++) {
    state = (
      await db.transaction(
        async trx =>
          await advanceSnapshotJournalDestinationWindow(
            trx,
            binding,
            state,
            { phase: 'intake', examined: 0, complete: true },
            async () => undefined
          )
      )
    ).checkpoint
  }
  const request = reference(10, '1')
  await db.transaction(async trx => {
    const actual = await prepareSnapshotJournalIdentityLedger(trx, binding, state, [request], { maximumMappings: 8 })
    expect(actual.associations.size).toBe(0)
    expect(actual.previous.get(request.tableId + ':' + request.incomingId)?.localId).toBe(701)
    await actual.persist(new Map([[request.tableId + ':' + request.incomingId, 702]]))
  })
  await db.transaction(async trx => {
    const actual = await prepareSnapshotJournalIdentityLedger(trx, binding, state, [{ ...request, required: true }], {
      maximumMappings: 8
    })
    expect(actual.associations.get(request.tableId + ':' + request.incomingId)?.localId).toBe(702)
  })
})

async function capturedRequestReferences() {
  for (const sql of snapshotJournalCapturedIdentitiesDdl(db)) await db.raw(sql)
  const frameDigest = 'f'.repeat(64),
    scope = {
      userId: binding.destinationUserId,
      sourceStorageIdentity: binding.source.storageIdentity,
      sessionId: state.sessionId,
      binding: state.binding,
      frameDigest
    },
    captured = (incomingId: number, tableId = 0, required = 1) => ({
      ...scope,
      changeIndex: 0,
      tableId,
      incomingId,
      generation: '2',
      naturalIdentity: 'a'.repeat(64),
      naturalKeyJson: JSON.stringify(
        tableId === 0 ? { tableId: 0, reference: 'transaction-' + incomingId } : { tableId, txid: String(incomingId) }
      ),
      required
    })
  await db('snapshot_reconciliation_identity_frames').insert({
    ...scope,
    windowSequence: 0,
    identities: 131,
    sealed: 1,
    changes: 1
  })
  for (let first = 1; first <= 129; first += 64) {
    await db('snapshot_reconciliation_captured_identities').insert(
      Array.from({ length: Math.min(64, 130 - first) }, (_, index) => captured(first + index))
    )
  }
  await db('snapshot_reconciliation_captured_identities').insert([captured(300, 8), captured(400, 9, 0)])
  return { scope, captured, frameDigest }
}
test('request captured point selection bounds notification batches and excludes them from scalar final maps', async () => {
  const { frameDigest } = await capturedRequestReferences()
  await db.transaction(async trx => {
    const first = await readSnapshotJournalCapturedIdentities(trx, binding, state, frameDigest, 0),
      points = await readSnapshotJournalCapturedIdentities(trx, binding, state, frameDigest, 0, undefined, {
        kind: 'transaction-points',
        ids: [129, 1, 129, 900]
      }),
      scalar = await readSnapshotJournalCapturedIdentities(trx, binding, state, frameDigest, 0, undefined, {
        kind: 'request-scalars'
      })
    expect(first).toHaveLength(128)
    expect(points.map(row => row.incomingId)).toEqual([1, 129])
    expect(scalar.map(row => [row.tableId, row.incomingId])).toEqual([
      [8, 300],
      [9, 400]
    ])
    await expect(
      readSnapshotJournalCapturedIdentities(trx, binding, state, frameDigest, 0, undefined, {
        kind: 'transaction-points',
        ids: Array.from({ length: 129 }, (_, id) => id + 1)
      })
    ).rejects.toThrow()
    await expect(
      readSnapshotJournalCapturedIdentities(trx, binding, state, frameDigest, 0, undefined, {
        kind: 'transaction-points',
        ids: [0]
      })
    ).rejects.toThrow()
    await expect(
      readSnapshotJournalCapturedIdentities(
        trx,
        binding,
        state,
        frameDigest,
        0,
        { tableId: 0, incomingId: 1 },
        { kind: 'transaction-points', ids: [2] }
      )
    ).rejects.toThrow()
  })
})
test('journal notification projection uses sealed current associations and refuses changed identity, profile and window', async () => {
  const { frameDigest, scope } = await capturedRequestReferences(),
    limit = { maximumMappings: 8 }
  await db.raw(
    'CREATE TABLE transactions(transactionId INTEGER PRIMARY KEY,userId INTEGER NOT NULL,reference TEXT NOT NULL,txid TEXT)'
  )
  await db.raw('CREATE INDEX ?? ON transactions(userId,txid)', [brc38ImportTargetIndexName('transactions')])
  await db.raw('CREATE INDEX ?? ON transactions(userId,reference)', [
    brc38ImportTargetIndexName('transactionReference')
  ])
  await db('transactions').insert([
    { transactionId: 701, userId: 7, reference: 'transaction-1' },
    { transactionId: 702, userId: 7, reference: 'transaction-129' }
  ])
  for (const [incomingId, localId] of [
    [1, 701],
    [129, 702]
  ])
    await db.transaction(async trx => {
      const prepared = await prepareSnapshotJournalIdentityLedger(
        trx,
        binding,
        state,
        [
          {
            tableId: 0,
            incomingId,
            generation: snapshotJournalRevision('2'),
            naturalIdentity: 'a'.repeat(64),
            required: false
          }
        ],
        limit
      )
      await prepared.persist(new Map([['0:' + incomingId, localId]]))
    })
  const statements: string[] = [],
    observe = (query: { sql: string }) => {
      statements.push(query.sql)
    }
  db.on('query', observe)
  try {
    const read = async (ids: number[] = [129, 1, 900, 129, 0, -1, Number.MAX_SAFE_INTEGER + 1]) =>
      await db.transaction(
        async trx => await readSnapshotJournalNotificationMappings(trx, binding, state, frameDigest, 0, 1, ids, limit)
      )
    expect(await read()).toEqual([702, 701, undefined, 702, undefined, undefined, undefined])
    expect(statements.some(sql => sql.includes('snapshot_sync_ids'))).toBe(false)
    await expect(read([2])).rejects.toThrow('identity ledger')
    await db('transactions').where('transactionId', 701).update({ userId: 8 })
    await expect(read([1])).rejects.toThrow('association')
    await db('transactions').where('transactionId', 701).update({ userId: 7 })
    await db('snapshot_reconciliation_captured_identities')
      .where({ ...scope, changeIndex: 0, tableId: 0, incomingId: 1 })
      .update({ generation: '3' })
    await expect(read([1])).rejects.toThrow()
    await db('snapshot_reconciliation_captured_identities')
      .where({ ...scope, changeIndex: 0, tableId: 0, incomingId: 1 })
      .update({ generation: '2' })
    await db('snapshot_reconciliation_identity_frames').where(scope).update({ sealed: 0 })
    await expect(read([1])).rejects.toThrow('captured')
    await db('snapshot_reconciliation_identity_frames').where(scope).update({ sealed: 1 })
    expect(await read([1, 129])).toEqual([701, 702])
    await db('users').where('userId', 7).update({ activeStorage: 'another primary' })
    await expect(read([1])).rejects.toThrow('window')
  } finally {
    db.off('query', observe)
  }
})
