import { createHash } from 'node:crypto'
import type { StorageKnex } from '../../StorageKnex'
import { WERR_INVALID_OPERATION, WERR_UNAUTHORIZED } from '../../../sdk/WERR_errors'
import type { SnapshotJournalDestinationLimits, SnapshotJournalWriterAdmission } from './SnapshotJournalProvider'
import type { SnapshotJournalDestinationCheckpoint, SnapshotJournalDeltaPage } from './SnapshotJournalTypes'
import {
  parseSnapshotJournalFieldArchiveBinding,
  type SnapshotJournalFieldArchiveBinding
} from './SnapshotJournalArchiveBinding'
import { snapshotJournalReceiptBinding } from './SnapshotJournalReceipt'
import { KnexSnapshotJournalWindowDestination } from './KnexSnapshotJournalWindowDestination'
import { KnexSnapshotJournalDataContentReceipts } from './KnexSnapshotJournalDataContentReceipts'
import {
  withSnapshotJournalDestinationWindowFence,
  snapshotJournalDestinationStreams
} from './SnapshotJournalDestinationWindow'
import {
  captureSnapshotJournalIdentities,
  sealSnapshotJournalCapturedFrame,
  requireSnapshotJournalCapturedFrame
} from './SnapshotJournalCapturedIdentities'
import { stageSnapshotJournalDestinationFieldPage } from './SnapshotJournalDestinationStage'
import { advanceSnapshotJournalProgress } from './SnapshotJournalProgress'
import { encodeSnapshotJournalFieldFrame } from './SnapshotJournalDeltaFrame'
import { applySnapshotJournalProvenancePage } from './SnapshotJournalProvenance'
import {
  assertRemoteSnapshotJournalFieldFrame,
  type RemoteSnapshotJournalFieldArchive
} from './openRemoteSnapshotJournalFieldArchive'

function invalid(): never {
  throw new WERR_INVALID_OPERATION('Journal field destination differs from its actual admitted artifact/window')
}

/** Version-4 intake owns the actual authenticated archive and target writer.
 * Staged metadata is not a financial completion/primary-selection ACK. This
 * class deliberately does not inherit the version-3 row staging/promoter. */
export class KnexSnapshotJournalFieldDestination extends KnexSnapshotJournalWindowDestination {
  static async begin(
    storage: StorageKnex,
    identityKey: string,
    input: SnapshotJournalFieldArchiveBinding,
    limits: SnapshotJournalDestinationLimits,
    admission: SnapshotJournalWriterAdmission,
    signal?: AbortSignal
  ): Promise<{ destination: KnexSnapshotJournalFieldDestination; checkpoint: SnapshotJournalDestinationCheckpoint }> {
    const source = parseSnapshotJournalFieldArchiveBinding(input)
    return await this.beginWindow(
      storage,
      identityKey,
      source,
      limits,
      admission,
      (binding, ownedLimits, root) =>
        new KnexSnapshotJournalFieldDestination(storage, binding, ownedLimits, admission, signal, root),
      signal
    )
  }
  static async resume(
    storage: StorageKnex,
    identityKey: string,
    sourceStorageIdentity: string,
    limits: SnapshotJournalDestinationLimits,
    admission: SnapshotJournalWriterAdmission,
    signal?: AbortSignal
  ): Promise<KnexSnapshotJournalFieldDestination | undefined> {
    return await this.resumeWindow(
      storage,
      identityKey,
      sourceStorageIdentity,
      limits,
      admission,
      'wallet-journal-fields/1',
      (binding, ownedLimits, root) =>
        new KnexSnapshotJournalFieldDestination(storage, binding, ownedLimits, admission, signal, root)
    )
  }

  async stageArchiveFrame(
    expected: SnapshotJournalDestinationCheckpoint,
    archive: RemoteSnapshotJournalFieldArchive
  ): Promise<SnapshotJournalDestinationCheckpoint> {
    expected = { ...expected, ...(expected.after === undefined ? {} : { after: { ...expected.after } }) }
    return await this.exclusive(async () => {
      this.signal?.throwIfAborted()
      const stream = snapshotJournalDestinationStreams[expected.streamIndex],
        source = parseSnapshotJournalFieldArchiveBinding(archive.manifest.binding)
      if (source.user.identityKey !== this.binding.source.identityKey)
        throw new WERR_UNAUTHORIZED('Journal field artifact belongs to a different authenticated profile')
      if (
        !archive.isOpen ||
        expected.phase !== 'intake' ||
        stream === undefined ||
        this.binding.fieldEncoding !== 'wallet-journal-fields/1' ||
        snapshotJournalReceiptBinding(source.journal.source) !== snapshotJournalReceiptBinding(this.binding.source) ||
        JSON.stringify(source.journal.receipt) !== JSON.stringify(this.binding.receipt) ||
        source.journal.low !== this.binding.low ||
        source.journal.bootstrap !== (this.binding.bootstrap === true)
      )
        invalid()
      await this.verifyCurrent()
      // Network reads occur outside target writer admission. Each independently
      // bounded identity prefix is fenced in the genuine physical transaction.
      const frame = await archive.readFrame(expected.sequence, async (digest, index, identities) => {
        this.signal?.throwIfAborted()
        await this.writer(
          async trx =>
            await withSnapshotJournalDestinationWindowFence(
              trx,
              this.binding,
              expected,
              async fenced =>
                await captureSnapshotJournalIdentities(
                  fenced,
                  this.binding,
                  expected,
                  digest,
                  index,
                  identities,
                  this.limits
                )
            )
        )
      })
      assertRemoteSnapshotJournalFieldFrame(archive, frame)
      const bytes = encodeSnapshotJournalFieldFrame(frame.page, stream)
      if (
        frame.ordinal !== expected.sequence ||
        frame.stream !== stream.stream ||
        frame.tableId !== stream.tableId ||
        createHash('sha256').update(bytes).digest('hex') !== frame.frameDigest
      )
        invalid()
      for (const change of frame.page.changes) {
        if (change.present && Object.hasOwn(change.row, 'userId') && change.row.userId !== this.binding.source.userId)
          throw new WERR_UNAUTHORIZED('Journal field row belongs to a different source profile')
      }
      // The original provenance path accepts complete rows. Do not silently
      // discard a sync-state field or acknowledge metadata as full provenance.
      let provenance: SnapshotJournalDeltaPage | undefined
      if (stream.tableId === 7) {
        if (frame.page.changes.some(change => change.present && Object.keys(change.fields).length > 0))
          throw new WERR_INVALID_OPERATION('Deferred journal provenance requires complete verified field custody')
        provenance = {
          table: frame.page.table,
          changes: frame.page.changes.map(change =>
            change.present
              ? { metadata: change.metadata, present: true as const, row: change.row }
              : { metadata: change.metadata, present: false as const }
          ),
          examined: frame.page.examined,
          payloadBytes: frame.page.metadataBytes,
          complete: frame.page.complete,
          ...(frame.page.after === undefined ? {} : { after: frame.page.after })
        }
      }
      await this.verifyCurrent()
      return await this.writer(async trx => {
        this.signal?.throwIfAborted()
        assertRemoteSnapshotJournalFieldFrame(archive, frame)
        // A resumed controller must agree with the actual artifact's pending
        // content record; copied JSON cannot restamp a different session.
        await new KnexSnapshotJournalDataContentReceipts(this.storage, this.root).pending(
          trx as import('knex').Knex.Transaction,
          this.binding,
          expected,
          source.snapshotId,
          source.journal.contentRevision
        )
        await sealSnapshotJournalCapturedFrame(
          trx,
          this.binding,
          expected,
          frame.frameDigest,
          frame.page.changes.length
        )
        await requireSnapshotJournalCapturedFrame(
          trx,
          this.binding,
          expected,
          frame.frameDigest,
          frame.page.changes.length
        )
        if (provenance !== undefined)
          await applySnapshotJournalProvenancePage(trx, this.binding, expected, provenance, this.limits)
        const committed = await stageSnapshotJournalDestinationFieldPage(
          trx,
          this.binding,
          expected,
          frame.page,
          this.limits
        )
        await advanceSnapshotJournalProgress(trx, this.binding, expected, committed.checkpoint, {
          pages: 1,
          examined: committed.result.examined,
          payloadBytes: committed.result.bytes
        })
        return committed.checkpoint
      })
    })
  }
}
