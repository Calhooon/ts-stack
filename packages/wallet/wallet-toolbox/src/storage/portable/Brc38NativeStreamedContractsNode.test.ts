import { withBrc38NativeStreamedContractFixture } from './Brc38NativeStreamedContractFixture'
import {
  verifyNativePackedFieldPreparationRecovery,
  verifyNativePackedFieldPreparationReadDrain
} from './Brc38NativePackedFieldPreparationNode.case'
import { verifyNativePackedTextPreparationRecovery } from './Brc38NativePackedTextPreparationNode.case'
import { verifyNativeScalarTextPreparationRecovery } from './Brc38NativeScalarTextPreparationNode.case'
import { verifyPrivateHistoryReadDrain } from './Brc38PrivateHistoryReadDrainNode.case'
import { verifyNativeStructuredSqlWindowOracle } from './Brc38SqlStructuredChunkWindowNode.case'
import { readBrc38ImportJournal } from './Brc38ImportJournal'
import {
  verifyNativeExistingFieldMetadataBound,
  verifyNativeExistingFieldWriterFence
} from './Brc38ImportExistingFieldRowsNode.case'
import { createHash } from 'node:crypto'

type Fixture = Parameters<Parameters<typeof withBrc38NativeStreamedContractFixture>[1]>[0]
const when = new Date('2026-10-08T00:00:00.000Z')
async function seedTransaction(fixture: Fixture): Promise<{ transactionId: number; userId: number }> {
  return await fixture.withWriter(async trx => {
    const userId = await fixture.storage.insertUser(
        {
          userId: 0,
          created_at: when,
          updated_at: when,
          identityKey: 'independent streamed field user',
          activeStorage: 'synthetic target'
        },
        trx
      ),
      transactionId = await fixture.storage.insertTransaction(
        {
          transactionId: 0,
          userId,
          created_at: when,
          updated_at: when,
          status: 'nosend',
          reference: 'aW5kZXBlbmRlbnQgc3RyZWFtZWQ=',
          isOutgoing: false,
          satoshis: 0,
          description: ''
        },
        trx
      )
    return { userId, transactionId }
  })
}

// Each case has a separate actual authenticated native receiver and original
// finite expiry. Byte oracles are authored before encryption/source staging.
test('actual authenticated multichunk binary staging survives an interrupted installer', async () => {
  const expected = Uint8Array.from({ length: 131073 }, (_, index) => (index * 17 + 29) % 251)
  try {
    await withBrc38NativeStreamedContractFixture(
      data => {
        data.tables.outputs[0].lockingScript = Buffer.from(expected).toString('base64')
      },
      async fixture => {
        const parent = await seedTransaction(fixture),
          rowId = await fixture.withWriter(
            async trx =>
              await fixture.storage.insertOutput(
                {
                  outputId: 0,
                  ...parent,
                  created_at: when,
                  updated_at: when,
                  spendable: false,
                  change: false,
                  vout: 0,
                  satoshis: 0,
                  providedBy: 'you',
                  purpose: 'independent staging',
                  type: 'custom',
                  outputDescription: 'independent pointer-free output'
                },
                trx
              )
          )
        await fixture.withPage('outputs', async freshPage => {
          await verifyNativePackedFieldPreparationRecovery(fixture.store, freshPage, rowId, expected, fixture.expiresAt)
          const target = {
              table: 'outputs' as const,
              index: 'outputs' as const,
              key: { userId: parent.userId, transactionId: parent.transactionId, vout: 0 },
              found: true,
              localId: rowId
            },
            descriptor = { bytes: expected.byteLength, sha256: createHash('sha256').update(expected).digest('hex') }
          await fixture.store.withPrivateNativeDatabase(
            true,
            async database =>
              await database.transaction(async trx => {
                fixture.store.assertPrivateNativeReadTransaction(trx)
                await verifyNativeExistingFieldMetadataBound(
                  trx,
                  fixture.storage,
                  parent.userId,
                  target,
                  descriptor,
                  65536
                )
              })
          )
          await verifyNativeExistingFieldWriterFence(fixture.store, fixture.storage, parent.userId, target)
        })
      }
    )
  } finally {
    expected.fill(0)
  }
}, 30000)

test('actual binary source leases drain before every private append writer', async () => {
  const expected = Uint8Array.from({ length: 131073 }, (_, index) => (index * 19 + 31) % 251)
  try {
    await withBrc38NativeStreamedContractFixture(
      data => {
        data.tables.outputs[0].lockingScript = Buffer.from(expected).toString('base64')
      },
      async fixture =>
        await fixture.withPage(
          'outputs',
          async freshPage =>
            await verifyNativePackedFieldPreparationReadDrain(fixture.store, freshPage, fixture.expiresAt)
        )
    )
  } finally {
    expected.fill(0)
  }
}, 30000)

test('actual original multichunk UTF-8 description survives interrupted TEXT staging', async () => {
  const description = '\uFEFFindependent\u0000雪😀'.repeat(5000),
    expected = Buffer.from(description, 'utf8')
  try {
    await withBrc38NativeStreamedContractFixture(
      data => {
        data.tables.transactions[0].description = description
      },
      async fixture => {
        const { transactionId } = await seedTransaction(fixture)
        await fixture.withPage(
          'transactions',
          async freshPage =>
            await verifyNativeScalarTextPreparationRecovery(
              fixture.store,
              freshPage,
              transactionId,
              expected,
              fixture.expiresAt
            )
        )
      }
    )
  } finally {
    expected.fill(0)
  }
}, 30000)

test('complete authenticated history and notify page retains canonical bytes and drained projection reads', async () => {
  const history = { notes: [], unknown: '雪😀'.repeat(14000) },
    notify = { transactionIds: [], unknown: '雪😀' },
    expectedHistory = Buffer.from(JSON.stringify(history), 'utf8'),
    expectedNotify = Buffer.from(JSON.stringify(notify), 'utf8')
  try {
    await withBrc38NativeStreamedContractFixture(
      data => {
        data.tables.provenTxReqs[0].history = history
        data.tables.provenTxReqs[0].notify = notify
      },
      async fixture => {
        await fixture.beforeTable('provenTxReqs')
        // This is a distinct component row. Its empty history is never a
        // replacement for the authenticated source's complete history/notify.
        const rowId = await fixture.withWriter(
          async trx =>
            await fixture.storage.insertProvenTxReq(
              {
                provenTxReqId: 0,
                created_at: when,
                updated_at: when,
                status: 'unprocessed',
                attempts: 0,
                notified: false,
                txid: '8'.repeat(64),
                history: '',
                notify: '{}',
                rawTx: []
              },
              trx
            )
        )
        await fixture.withPage('provenTxReqs', async freshPage => {
          await verifyPrivateHistoryReadDrain(
            fixture.store,
            fixture.restore.admission,
            'provenTxReqs',
            0,
            fixture.resources.sourcePolicy,
            fixture.resources.projectionPolicy,
            expectedNotify,
            0
          )
          const receipt = await fixture.store.withPrivateNativeDatabase(
              true,
              async database =>
                await database.transaction(async trx => {
                  fixture.store.assertPrivateNativeReadTransaction(trx)
                  return await readBrc38ImportJournal(trx, fixture.restore.admission)
                })
            ),
            projection = await fixture.store.stagePrivateNotifyProjection(
              fixture.restore.admission,
              0,
              receipt.nextRow,
              fixture.resources.sourcePolicy,
              fixture.resources.projectionPolicy
            )
          await verifyNativePackedTextPreparationRecovery(
            fixture.store,
            freshPage,
            rowId,
            expectedHistory,
            fixture.expiresAt,
            new Map([[0, projection.descriptor]])
          )
          await fixture.store.withPrivateNativeDatabase(
            true,
            async database =>
              await database.transaction(async trx => {
                const assertCurrent = (): void => {
                  fixture.check()
                  fixture.store.assertPrivateNativeReadTransaction(trx)
                }
                for (const family of ['raw', 'canonical'] as const)
                  await verifyNativeStructuredSqlWindowOracle(
                    trx,
                    family,
                    { table: 'provenTxReqs', position: 0, field: 'history' },
                    expectedHistory,
                    assertCurrent
                  )
                await verifyNativeStructuredSqlWindowOracle(
                  trx,
                  'projected',
                  { table: 'provenTxReqs', position: 0, field: 'notify' },
                  expectedNotify,
                  assertCurrent
                )
              })
          )
        })
      }
    )
  } finally {
    expectedHistory.fill(0)
    expectedNotify.fill(0)
  }
}, 30000)
