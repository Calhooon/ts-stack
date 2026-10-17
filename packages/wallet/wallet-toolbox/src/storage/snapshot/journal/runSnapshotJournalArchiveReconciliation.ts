import { WERR_INVALID_OPERATION } from '../../../sdk/WERR_errors'
import type { RemoteSnapshotJournalArchive } from './openRemoteSnapshotJournalArchive'
import type { SnapshotJournalDestinationCheckpoint, SnapshotJournalProgress } from './SnapshotJournalTypes'
import { snapshotJournalArchiveStreams } from './SnapshotJournalArchiveBinding'
import {
  encodeSnapshotJournalArchiveIdentities,
  encodeSnapshotJournalArchiveFrame
} from './SnapshotJournalArchivePacket'
import {
  runSnapshotJournalReconciliation,
  type SnapshotJournalReconciliationOptions,
  type SnapshotJournalReconciliationProgress
} from './runSnapshotJournalReconciliation'

/** Concrete local or authenticated remote target. Only status reports its actual
 * durable ACK; sender progress and prefix uploads never advance this position. */
export interface SnapshotJournalDataDestination {
  status: () => Promise<{ checkpoint: SnapshotJournalDestinationCheckpoint; progress: SnapshotJournalProgress }>
  stagePacket: (checkpoint: SnapshotJournalDestinationCheckpoint, bytes: Uint8Array) => Promise<unknown>
  promote: (checkpoint: SnapshotJournalDestinationCheckpoint) => Promise<unknown>
}

/** Streams one verified immutable source into a separately admitted destination.
 * No SQL writer or manager queue spans artifact I/O, retries or progress callbacks.
 * The existing coordinator recovers lost ACKs from target status and drains the
 * real source owner on cancellation/error/completion. No primary is selected. */
export async function* runSnapshotJournalArchiveReconciliation(
  archive: RemoteSnapshotJournalArchive,
  openDestination: () => Promise<SnapshotJournalDataDestination>,
  options: SnapshotJournalReconciliationOptions = {}
): AsyncGenerator<SnapshotJournalReconciliationProgress, SnapshotJournalReconciliationProgress, void> {
  return yield* runSnapshotJournalReconciliation(
    archive,
    async () => {
      const destination = await openDestination(),
        manifest = archive.manifest
      return {
        status: () => destination.status(),
        intake: async (expected: SnapshotJournalDestinationCheckpoint) => {
          const stream = snapshotJournalArchiveStreams[expected.streamIndex]
          if (expected.phase !== 'intake' || stream === undefined || expected.sequence >= archive.frameCount)
            throw new WERR_INVALID_OPERATION('Journal archive differs from the actual destination intake ordinal')
          const context = { stream: stream.stream, tableId: stream.tableId }
          const frame = await archive.readFrame(expected.sequence, async (digest, index, identities) => {
            await destination.stagePacket(
              expected,
              encodeSnapshotJournalArchiveIdentities(
                context,
                digest,
                index,
                identities,
                manifest.binding.journal.receipt.highWater
              )
            )
          })
          if (frame.stream !== stream.stream || frame.tableId !== stream.tableId)
            throw new WERR_INVALID_OPERATION('Journal archive frame differs from destination stream')
          return await destination.stagePacket(expected, encodeSnapshotJournalArchiveFrame(context, frame.page))
        },
        promote: expected => destination.promote(expected)
      }
    },
    options
  )
}
