import { withBrc38PrivateCurrentStructuredSource } from './Brc38PrivateCurrentStructuredSourceNode'
import {
  readBrc38NativePackedTextDescriptorData,
  readBrc38NativePackedTextExtentData,
  readBrc38NativePackedTextVersionDescriptorData,
  readBrc38NativePackedTextVersionExtentData
} from './Brc38NativePackedTextFieldsNode'
import { createHash } from 'node:crypto'
import type { Knex } from 'knex'

import { runInSeries } from '../../utility/runInSeries'

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
}, 180000)

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
}, 180000)

test('private current range checks its complete schema at both operation boundaries', async () => {
  await withBrc38NativePrivateContractFixture(async fixture => {
    const original = await seed(fixture),
      working = new Brc38WorkingAllocation(8388608),
      coordinate = { table: 'provenTxReqs', field: 'history', rowId: original.requestId } as const,
      expected = Buffer.from(original.history),
      sha256 = createHash('sha256').update(expected).digest('hex'),
      extent = { ...coordinate, offset: 0, length: expected.length, totalBytes: expected.length },
      versionExtent = { sha256, offset: 0, length: expected.length, totalBytes: expected.length }
    let escaped: Knex.Transaction | undefined
    await fixture.withRead(async trx => {
      escaped = trx
      await withBrc38PrivateCurrentStructuredSource(
        fixture.storage,
        trx,
        coordinate,
        policy(fixture, working),
        async source => {
          let completeSchemaAnchors = 0
          const count = (query: { sql: string; bindings?: readonly unknown[] }): void => {
            if (
              /^select sql from sqlite_schema where name = \? and type = \? limit \?$/.test(
                query.sql.replace(/[`"]/g, '')
              ) &&
              query.bindings?.[0] === 'brc38_native_text_versions' &&
              query.bindings?.[1] === 'table'
            )
              completeSchemaAnchors++
          }
          trx.on('query', count)
          let bytes: Uint8Array | undefined
          try {
            bytes = await source.read(0, expected.length)
            expect(Buffer.from(bytes)).toEqual(expected)
            // Actual schema selection runs before and after every operation.
            // Nested descriptor/extent reads use this same readonly transaction.
            expect(completeSchemaAnchors).toBe(2)
          } finally {
            trx.off('query', count)
            bytes?.fill(0)
          }
        }
      )
      const descriptor = await readBrc38NativePackedTextDescriptorData(trx, coordinate)
      expect(descriptor).toEqual({ bytes: expected.length, sha256 })
      expect(await readBrc38NativePackedTextVersionDescriptorData(trx, sha256)).toEqual(descriptor)
      const rowBytes = await readBrc38NativePackedTextExtentData(trx, extent)
      try {
        expect(Buffer.from(rowBytes)).toEqual(expected)
      } finally {
        rowBytes.fill(0)
      }
      const versionBytes = await readBrc38NativePackedTextVersionExtentData(trx, versionExtent)
      try {
        expect(Buffer.from(versionBytes)).toEqual(expected)
      } finally {
        versionBytes.fill(0)
      }
      const forgedSql = jest.fn(() => {
          throw new Error('Forged SQL executed')
        }),
        forged = Object.assign(forgedSql, { isTransaction: true }) as unknown as Knex.Transaction
      await runInSeries([new Proxy(trx, {}), forged], async copy => {
        await expect(readBrc38NativePackedTextDescriptorData(copy, coordinate)).rejects.toThrow()
        await expect(readBrc38NativePackedTextVersionDescriptorData(copy, sha256)).rejects.toThrow()
        await expect(readBrc38NativePackedTextExtentData(copy, extent)).rejects.toThrow()
        await expect(readBrc38NativePackedTextVersionExtentData(copy, versionExtent)).rejects.toThrow()
      })
      expect(forgedSql).not.toHaveBeenCalled()
    })
    await fixture.withWriter(async trx => {
      await expect(readBrc38NativePackedTextDescriptorData(trx, coordinate)).rejects.toThrow('private readonly')
      await expect(readBrc38NativePackedTextExtentData(trx, extent)).rejects.toThrow('private readonly')
      await expect(readBrc38NativePackedTextVersionDescriptorData(trx, sha256)).rejects.toThrow('private readonly')
      await expect(readBrc38NativePackedTextVersionExtentData(trx, versionExtent)).rejects.toThrow('private readonly')
    })
    expect(escaped).toBeDefined()
    await expect(readBrc38NativePackedTextDescriptorData(escaped!, coordinate)).rejects.toThrow()
    await expect(readBrc38NativePackedTextExtentData(escaped!, extent)).rejects.toThrow()
    expect(working.used).toBe(0)
    expected.fill(0)
  })
}, 180000)
