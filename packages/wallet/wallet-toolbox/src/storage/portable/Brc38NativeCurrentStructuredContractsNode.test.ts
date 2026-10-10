import {
  withBrc38NativePrivateContractFixture,
  type Brc38NativePrivateContractFixture
} from './Brc38NativePrivateContractFixture'
import {
  verifyPrivateCurrentStructuredSources,
  verifyPrivateCurrentCheckpointDelta,
  verifyPrivateCurrentLegacySpelling
} from './Brc38PrivateCurrentStructuredSourceNode.case'
import { Brc38WorkingAllocation } from './Brc38WorkingAllocation'

// Independently authored map closure; no production createSyncMap result or
// projection output supplies the expected postimage.
const entities = [
  'provenTx',
  'outputBasket',
  'transaction',
  'provenTxReq',
  'txLabel',
  'txLabelMap',
  'output',
  'outputTag',
  'outputTagMap',
  'certificate',
  'certificateField',
  'commission'
]
function independentMap() {
  return Object.fromEntries(entities.map(entity => [entity, { entityName: entity, count: 0, idMap: {} }]))
}
function policy(fixture: Brc38NativePrivateContractFixture, workingAllocation: Brc38WorkingAllocation) {
  return {
    privateIndexParent: fixture.privateIndexParent,
    expiresAt: fixture.expiresAt,
    maximumTemporaryIndexBytes: 2097152,
    maximumCombinedTemporaryBytes: 4194304,
    maximumIndexMembers: 10000,
    maximumStructuredBytes: 1048576,
    maximumCanonicalBytes: 1048576,
    maximumReadBytes: 1024,
    maximumIndexAllocationBytes: 262144,
    maximumGrammarAllocationBytes: 262144,
    workingAllocation
  }
}
async function seed(fixture: Brc38NativePrivateContractFixture) {
  const when = new Date('2026-10-08T00:00:00.000Z'),
    history = '{"notes":[{"when":"2026-10-08T00:00:00.000Z","what":"independent 雪😀 history"}],"unknown":null}',
    notify = '{"transactionIds":[17,19],"unknown":"independent 雪"}',
    syncMap = JSON.stringify({ ...independentMap(), unknown: { retained: '雪😀', empty: null } }),
    errorLocal = '{"code":"independent local","description":"雪😀"}',
    errorOther = '{"code":"independent remote","description":"\\u0000"}'
  const coordinates = await fixture.withWriter(async trx => {
    const userId = await fixture.storage.insertUser(
      {
        userId: 0,
        created_at: when,
        updated_at: when,
        identityKey: 'independent structured user',
        activeStorage: 'synthetic target'
      },
      trx
    )
    const requestId = await fixture.storage.insertProvenTxReq(
      {
        provenTxReqId: 0,
        created_at: when,
        updated_at: when,
        status: 'unprocessed',
        attempts: 0,
        notified: false,
        txid: '7'.repeat(64),
        history,
        notify,
        rawTx: []
      },
      trx
    )
    const syncStateId = await fixture.storage.insertSyncState(
      {
        syncStateId: 0,
        userId,
        created_at: when,
        updated_at: when,
        storageIdentityKey: 'independent remote storage',
        storageName: 'independent remote',
        status: 'unknown',
        init: false,
        refNum: 'independent checkpoint',
        syncMap,
        errorLocal,
        errorOther
      },
      trx
    )
    return { requestId, syncStateId }
  })
  return { ...coordinates, history, notify, syncMap, errorLocal, errorOther }
}

test('five current private native JSON fields preserve independent bytes and reject escaped sources', async () => {
  await withBrc38NativePrivateContractFixture(async fixture => {
    const original = await seed(fixture),
      working = new Brc38WorkingAllocation(8388608)
    await fixture.withRead(
      async trx =>
        await verifyPrivateCurrentStructuredSources(
          fixture.storage,
          trx,
          [
            { table: 'provenTxReqs', field: 'history', rowId: original.requestId, expected: original.history },
            { table: 'provenTxReqs', field: 'notify', rowId: original.requestId, expected: original.notify },
            { table: 'syncStates', field: 'syncMap', rowId: original.syncStateId, expected: original.syncMap },
            { table: 'syncStates', field: 'errorLocal', rowId: original.syncStateId, expected: original.errorLocal },
            { table: 'syncStates', field: 'errorOther', rowId: original.syncStateId, expected: original.errorOther }
          ],
          policy(fixture, working)
        )
    )
    expect(working.used).toBe(0)
  })
}, 30000)

test('private checkpoint delta preserves the complete map, unknown members and actual prior bytes', async () => {
  await withBrc38NativePrivateContractFixture(async fixture => {
    const original = await seed(fixture),
      working = new Brc38WorkingAllocation(8388608),
      expected = JSON.stringify({
        ...independentMap(),
        output: { entityName: 'output', count: 1, idMap: { '23': 29 }, maxUpdated_at: '2026-10-08T00:00:01.000Z' },
        unknown: { retained: '雪😀', empty: null }
      })
    await fixture.withRead(
      async trx =>
        await verifyPrivateCurrentCheckpointDelta(
          fixture.storage,
          trx,
          original.syncStateId,
          original.syncMap,
          expected,
          {
            entity: 'output',
            count: 1,
            mappings: [{ incomingId: 23, localId: 29 }],
            maximumUpdatedAt: new Date('2026-10-08T00:00:01.000Z'),
            done: false
          },
          policy(fixture, working)
        )
    )
    expect(working.used).toBe(0)
  })
}, 30000)

test('private legacy spelling drains two real indexes between complete passes', async () => {
  await withBrc38NativePrivateContractFixture(async fixture => {
    const original = await seed(fixture),
      working = new Brc38WorkingAllocation(8388608)
    await fixture.withRead(
      async trx =>
        await verifyPrivateCurrentLegacySpelling(
          fixture.storage,
          trx,
          { table: 'provenTxReqs', field: 'history', rowId: original.requestId, expected: original.history },
          policy(fixture, working)
        )
    )
    expect(working.used).toBe(0)
  })
}, 30000)
