import type { Knex } from 'knex'
import {
  withBrc38NativeCandidateContractFixture,
  type Brc38NativeCandidateContractFixture
} from './Brc38NativeCandidateContractFixture'
import {
  verifyBrc38PrivateLocalCandidateResume,
  verifyBrc38PrivateLocalCandidateUniqueRebuild,
  type IndependentLocalCandidateRow
} from './Brc38PrivateLocalCandidateNode.case'
import {
  copyIndependentNativeInventory,
  wipeIndependentNativeInventory
} from './Brc38IndependentNativeInventoryFixture'
import { Brc38PublishedProfileNode } from './Brc38PublishedProfileNode'

const nativeCandidateFixtureLifetimeMs = 180000
const nativeCandidateCaseTimeoutMs = nativeCandidateFixtureLifetimeMs + 30000
// UNIQUE recovery completes an initial COPY, drains it, then completes a fresh
// COPY. Admit two existing copy windows under the same finite fixture owner.
const nativeCandidateRebuildFixtureLifetimeMs = 2 * nativeCandidateFixtureLifetimeMs
const nativeCandidateRebuildCaseTimeoutMs = nativeCandidateRebuildFixtureLifetimeMs + 30000

const one = (rows: readonly IndependentLocalCandidateRow[]): IndependentLocalCandidateRow => {
    if (rows.length !== 1) throw new Error('Independent resume fixture requires one original row')
    return rows[0]
  },
  integer = (original: unknown, value: number): number | bigint =>
    typeof original === 'bigint' ? BigInt(value) : value,
  writeSource = async (
    fixture: Brc38NativeCandidateContractFixture,
    operation: (writer: Knex.Transaction) => Promise<void>
  ): Promise<void> => {
    await fixture.source.manager.runAsStorageProvider(async active => {
      if (active !== fixture.source.storage) throw new Error('Candidate resume fixture selected another source')
      await Brc38PublishedProfileNode.withNativeImmediateSourceWriter(fixture.source.storage, async writer => {
        expect(await writer('snapshot_journal_clock').first('enabled', 'reason')).toEqual({ enabled: 1, reason: null })
        await operation(writer)
        expect(await writer('snapshot_journal_clock').first('enabled', 'reason')).toEqual({ enabled: 1, reason: null })
      })
    })
  }

// Expected complete postimages are declared from the separate source
// preimage before changing the real source. FK checks remain on; SQLite's
// transaction-local deferral checks the final graph at the actual commit.
test(
  'actual local candidate resumes all47 copying and catches parent removal, signed reuse and recovery fields',
  async () => {
    await withBrc38NativeCandidateContractFixture(
      async fixture => {
        const changed = copyIndependentNativeInventory(fixture.initial),
          basket = one(changed.output_baskets),
          output = one(changed.outputs),
          session = one(changed.snapshot_sync_sessions),
          mapping = one(changed.snapshot_sync_ids),
          replacement = Uint8Array.from([1, 254, 127, 2, 1]),
          text = Buffer.from('independent replacement \u0000雪😀'),
          reusedMonitor = {
            rowId: -105,
            metadata: {
              ...one(changed.monitor_events).metadata,
              id: integer(one(changed.monitor_events).metadata.id, -105),
              event: 'independent signed replacement'
            },
            fields: { details: text }
          }
        changed.output_baskets = [
          {
            ...basket,
            rowId: 101,
            metadata: {
              ...basket.metadata,
              basketId: integer(basket.metadata.basketId, 101),
              name: 'independent replacement basket'
            }
          }
        ]
        changed.outputs = [
          { ...output, metadata: { ...output.metadata, basketId: integer(output.metadata.basketId, 101) } }
        ]
        changed.monitor_events = [reusedMonitor]
        changed.action_batch_blobs = changed.action_batch_blobs.map(row => ({ ...row, fields: { bytes: replacement } }))
        changed.action_batches = changed.action_batches.map(row => ({
          ...row,
          fields: { ...row.fields, manifest: null }
        }))
        changed.snapshot_sync_sessions = [
          {
            ...session,
            metadata: {
              ...session.metadata,
              sequence: integer(session.metadata.sequence, 1),
              cursor: 'independent checkpoint'
            }
          }
        ]
        changed.snapshot_sync_ids = [
          { ...mapping, metadata: { ...mapping.metadata, incomingId: integer(mapping.metadata.incomingId, 116) } }
        ]
        try {
          await verifyBrc38PrivateLocalCandidateResume(
            {
              ...fixture,
              mutateSource: async () =>
                await writeSource(fixture, async writer => {
                  await writer.raw('PRAGMA defer_foreign_keys=ON')
                  // Delete the old parent before its surviving child's later update.
                  expect(
                    await writer('output_baskets')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(basket.rowId).toString()])
                      .delete()
                  ).toBe(1)
                  await writer('output_baskets').insert(changed.output_baskets[0].metadata)
                  expect(
                    await writer('outputs')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(output.rowId).toString()])
                      .update({ basketId: 101 })
                  ).toBe(1)
                  expect(await writer('monitor_events').where({ id: 400 }).delete()).toBe(1)
                  await writer('monitor_events').insert({ ...reusedMonitor.metadata, details: text.toString('utf8') })
                  // This genuine published source has ordinary auxiliary fields. Its
                  // private candidate packs them; source mutation retains that actual
                  // source layout instead of sending it a private marker-only writer.
                  expect(
                    await writer('action_batch_blobs')
                      .where({ actionBatchBlobId: 403 })
                      .update({ bytes: Buffer.from(replacement) })
                  ).toBe(1)
                  expect(await writer('action_batches').where({ actionBatchId: 402 }).update({ manifest: null })).toBe(
                    1
                  )
                  expect(
                    await writer('snapshot_sync_sessions')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(session.rowId).toString()])
                      .update({ sequence: 1, cursor: 'independent checkpoint' })
                  ).toBe(1)
                  expect(
                    await writer('snapshot_sync_ids')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(mapping.rowId).toString()])
                      .update({ incomingId: 116 })
                  ).toBe(1)
                })
            },
            fixture.initial,
            changed
          )
        } finally {
          wipeIndependentNativeInventory(changed)
          replacement.fill(0)
          text.fill(0)
        }
      },
      { lifetimeMs: nativeCandidateFixtureLifetimeMs, maximumNativeReadBytes: 16384 }
    )
  },
  nativeCandidateCaseTimeoutMs
)

test(
  'actual local candidate drains a UNIQUE rebuild and resumes after natural-key reuse and a key swap',
  async () => {
    await withBrc38NativeCandidateContractFixture(
      async fixture => {
        const changed = copyIndependentNativeInventory(fixture.initial),
          basket = one(changed.output_baskets),
          output = one(changed.outputs),
          labels = changed.tx_labels
        if (labels.length !== 2 || labels[0].metadata.label === labels[1].metadata.label)
          throw new Error('Independent unique rebuild requires two distinct original labels')
        const originalKeys = labels.map(row => row.metadata.label)
        changed.output_baskets = [
          { ...basket, rowId: 101, metadata: { ...basket.metadata, basketId: integer(basket.metadata.basketId, 101) } }
        ]
        changed.outputs = [
          { ...output, metadata: { ...output.metadata, basketId: integer(output.metadata.basketId, 101) } }
        ]
        changed.tx_labels = labels.map((row, index) => ({
          ...row,
          metadata: { ...row.metadata, label: originalKeys[1 - index] }
        }))
        try {
          await verifyBrc38PrivateLocalCandidateUniqueRebuild(
            {
              ...fixture,
              mutateSource: async () =>
                await writeSource(fixture, async writer => {
                  await writer.raw('PRAGMA defer_foreign_keys=ON')
                  expect(
                    await writer('output_baskets')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(basket.rowId).toString()])
                      .delete()
                  ).toBe(1)
                  await writer('output_baskets').insert(changed.output_baskets[0].metadata)
                  expect(
                    await writer('outputs')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(output.rowId).toString()])
                      .update({ basketId: 101 })
                  ).toBe(1)
                  expect(
                    await writer('tx_labels')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(labels[0].rowId).toString()])
                      .update({ label: 'independent temporary swap key' })
                  ).toBe(1)
                  expect(
                    await writer('tx_labels')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(labels[1].rowId).toString()])
                      .update({ label: originalKeys[0] })
                  ).toBe(1)
                  expect(
                    await writer('tx_labels')
                      .whereRaw('rowid=CAST(? AS INTEGER)', [BigInt(labels[0].rowId).toString()])
                      .update({ label: originalKeys[1] })
                  ).toBe(1)
                })
            },
            fixture.initial,
            changed
          )
        } finally {
          wipeIndependentNativeInventory(changed)
        }
      },
      {
        lifetimeMs: nativeCandidateRebuildFixtureLifetimeMs,
        maximumNativeReadBytes: 16384,
        prepareSource: async source => {
          await source.manager.runAsStorageProvider(async active => {
            if (active !== source.storage) throw new Error('Independent key-swap fixture selected another source')
            await Brc38PublishedProfileNode.withNativeImmediateSourceWriter(source.storage, async writer => {
              const rows = await writer('tx_labels').select('*').limit(2)
              if (rows.length !== 1) throw new Error('Independent key-swap fixture requires one original label')
              expect(await writer('snapshot_journal_clock').first('enabled', 'reason')).toEqual({
                enabled: 1,
                reason: null
              })
              await writer('tx_labels').insert({
                ...rows[0],
                txLabelId: 106,
                label: 'independent second original label'
              })
              expect(await writer('snapshot_journal_clock').first('enabled', 'reason')).toEqual({
                enabled: 1,
                reason: null
              })
            })
          })
        }
      }
    )
  },
  nativeCandidateRebuildCaseTimeoutMs
)
