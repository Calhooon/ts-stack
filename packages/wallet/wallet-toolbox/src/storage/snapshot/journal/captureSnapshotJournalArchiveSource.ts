import { toHex } from '@bsv/sdk/primitives/utils'
import { sha256 } from '@bsv/sdk/primitives/Hash'
import type { KnexSnapshotArchiveStore } from '../archive/KnexSnapshotArchiveStore'
import type { SnapshotArchiveWriter } from '../archive/SnapshotArchive'
import { snapshotArchiveLimits } from '../archive/SnapshotArchive'
import { SnapshotResourceLimitError } from '../SnapshotResourceLimitError'
import { SnapshotCancelledError } from '../SnapshotCancelledError'
import { closeSnapshotJournalSource } from './closeSnapshotJournalSource'
import { compareSnapshotJournalRevisions, snapshotJournalRevision } from './SnapshotJournalRevision'
import type { SnapshotJournalPosition } from './SnapshotJournalTypes'
import type { SnapshotJournalReconciliationSource } from './SnapshotJournalProvider'
import {
  parseSnapshotJournalArchiveBinding,
  snapshotJournalArchiveStreams,
  type SnapshotJournalArchiveManifest
} from './SnapshotJournalArchiveBinding'
import {
  encodeSnapshotJournalArchiveFrame,
  encodeSnapshotJournalArchiveIdentities,
  snapshotJournalArchiveEncoding
} from './SnapshotJournalArchivePacket'
import { encodeSnapshotJournalDeltaFrame } from './SnapshotJournalDeltaFrame'
import { snapshotJournalDataDigest, snapshotJournalDataRecord } from './SnapshotJournalReceiptData'

export interface SnapshotJournalArchivePosition {
  binding: string
  highWater: string
}
export type SnapshotJournalArchiveCaptureStore = Pick<
  KnexSnapshotArchiveStore,
  'beginJournal' | 'appendJournal' | 'sealJournal' | 'close'
>

/** Capture actual immutable DATA while retaining the genuine pinned source and
 * its archive guard. No SQL actor/fence is reconstructed from the output. Every
 * identity prefix is bounded and charged; ready follows physical source close. */
export async function captureSnapshotJournalArchiveSource(
  source: SnapshotJournalReconciliationSource,
  store: SnapshotJournalArchiveCaptureStore,
  position?: SnapshotJournalArchivePosition,
  options: { lifetimeMs?: number; maxBytes?: number; signal?: AbortSignal } = {}
): Promise<SnapshotJournalArchiveManifest> {
  let writer: SnapshotArchiveWriter | undefined,
    failure: { error: unknown } | undefined,
    manifest: SnapshotJournalArchiveManifest | undefined
  const active = () => {
    if (options.signal?.aborted) throw new SnapshotCancelledError('Journal archive capture cancelled')
  }
  try {
    const input = position === undefined ? undefined : snapshotJournalDataRecord(position, ['binding', 'highWater']),
      previous =
        input === undefined
          ? undefined
          : {
              binding: snapshotJournalDataDigest(input.binding),
              highWater: snapshotJournalRevision(input.highWater)
            }
    active()
    await source.verifyLive()
    if (
      previous?.binding === source.receipt.binding &&
      compareSnapshotJournalRevisions(previous.highWater, source.receipt.highWater) > 0
    )
      throw new TypeError('Journal archive position exceeds the actual source high-water')
    const incremental =
        previous !== undefined &&
        previous.binding === source.receipt.binding &&
        compareSnapshotJournalRevisions(previous.highWater, source.receipt.floor) >= 0,
      low = incremental ? previous.highWater : snapshotJournalRevision('0'),
      binding = parseSnapshotJournalArchiveBinding({
        version: 3,
        encoding: snapshotJournalArchiveEncoding,
        snapshotId: source.snapshotId,
        sourceStorage: source.sourceStorage,
        sourceSchema: source.sourceSchema,
        user: source.user,
        journal: {
          source: source.receiptBinding,
          receipt: source.receipt,
          low,
          bootstrap: !incremental,
          primary: source.primary
        }
      })
    // The immutable source receipt is never extended to fit archive admission.
    writer = await store.beginJournal(binding, options)
    if (!incremental) await source.validateClosure()
    let sequence = 0
    const append = async (
      table: (typeof snapshotJournalArchiveStreams)[number]['table'],
      bytes: Uint8Array,
      rows: number,
      done: boolean
    ) => {
      active()
      if (sequence >= snapshotArchiveLimits.pages)
        throw new SnapshotResourceLimitError('Journal archive page bound reached')
      await store.appendJournal(writer!, { sequence, table, rows, done, bytes })
      sequence++
    }
    for (const stream of snapshotJournalArchiveStreams) {
      const context = { stream: stream.stream, tableId: stream.tableId }
      let after: SnapshotJournalPosition | undefined,
        complete = false
      while (!complete) {
        active()
        const captured = await source.readDeltaPage(
          {
            ...context,
            low,
            ...(incremental ? {} : { bootstrap: true as const }),
            after,
            maximumRows: 8,
            maximumBytes: 262144
          },
          async (digest, changeIndex, identities) => {
            await append(
              stream.table,
              encodeSnapshotJournalArchiveIdentities(
                context,
                digest,
                changeIndex,
                identities,
                binding.journal.receipt.highWater
              ),
              0,
              false
            )
          }
        )
        active()
        const frame = encodeSnapshotJournalDeltaFrame(captured.page, context)
        if (toHex(sha256(frame)) !== captured.frameDigest) throw new TypeError('Captured journal frame digest changed')
        await append(
          stream.table,
          encodeSnapshotJournalArchiveFrame(context, captured.page),
          captured.page.changes.length,
          captured.page.complete
        )
        if (
          !captured.page.complete &&
          (captured.page.after === undefined || JSON.stringify(captured.page.after) === JSON.stringify(after))
        )
          throw new TypeError('Journal archive source did not advance its keyset')
        after = captured.page.after
        complete = captured.page.complete
      }
    }
    await source.verifyLive()
  } catch (error) {
    failure = { error }
  }
  // Cleanup failures retain the reservation. Never infer physical closure from
  // a rejected read, cancellation request or the existence of staged DATA.
  try {
    await closeSnapshotJournalSource(source, options.signal)
  } catch (error) {
    if (failure !== undefined && failure.error !== error)
      throw new AggregateError([failure.error, error], 'Journal archive capture and physical cleanup failed', {
        cause: failure.error
      })
    throw error
  }
  if (failure === undefined) {
    try {
      active()
      if (writer === undefined) throw new TypeError('Journal archive writer was not admitted')
      manifest = await store.sealJournal(writer)
      active()
      return manifest
    } catch (error) {
      failure = { error }
    }
  }
  if (writer !== undefined) {
    try {
      await store.close(source.user.identityKey, writer.archiveId)
    } catch (error) {
      throw new AggregateError([failure.error, error], 'Journal archive failure and staged cleanup failed', {
        cause: failure.error
      })
    }
  }
  throw failure.error
}
