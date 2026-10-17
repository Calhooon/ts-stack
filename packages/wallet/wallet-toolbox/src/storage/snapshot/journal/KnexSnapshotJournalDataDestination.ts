import { KnexSnapshotJournalDataContentReceipts } from './KnexSnapshotJournalDataContentReceipts'
import type { SnapshotSyncContentRevision } from '../SnapshotSyncContentRevision'
import { SnapshotJournalDataBootstrapRequiredError } from './SnapshotJournalDataBootstrapRequiredError'
import { validateSyncProofs } from '../../remoting/validateRpcSyncProofs'
import type { TableProvenTx } from '../../schema/tables'
import { SnapshotResourceLimitError } from '../SnapshotResourceLimitError'
import { randomBytes } from 'node:crypto'
import type { Knex } from 'knex'
import type { StorageKnex } from '../../StorageKnex'
import { WERR_INVALID_OPERATION, WERR_UNAUTHORIZED } from '../../../sdk/WERR_errors'
import type { SnapshotJournalDestinationLimits, SnapshotJournalWriterAdmission } from './SnapshotJournalProvider'
import type { SnapshotJournalDestinationBinding, SnapshotJournalDestinationCheckpoint } from './SnapshotJournalTypes'
import { parseSnapshotJournalArchiveBinding, type SnapshotJournalArchiveBinding } from './SnapshotJournalArchiveBinding'
import { decodeSnapshotJournalArchivePacket } from './SnapshotJournalArchivePacket'
import { snapshotJournalRevision } from './SnapshotJournalRevision'
import { readSnapshotJournalCaptureConfiguration } from './SnapshotJournalLifecycle'
import { verifySnapshotJournalDestinationSchema } from './SnapshotJournalDestinationSchema'
import {
  withSnapshotJournalDestinationWindowFence,
  beginSnapshotJournalDestinationWindow,
  readSnapshotJournalDestinationWindow,
  readSnapshotJournalStoredWindow,
  retireSnapshotJournalDestinationWindow,
  replaceSnapshotJournalDestinationWindow,
  succeedSnapshotJournalDestinationWindow,
  snapshotJournalDestinationStreams
} from './SnapshotJournalDestinationWindow'
import { snapshotJournalLineage, snapshotJournalAssociationGeneration } from './SnapshotJournalLineage'
import {
  captureSnapshotJournalIdentities,
  sealSnapshotJournalCapturedFrame,
  requireSnapshotJournalCapturedFrame
} from './SnapshotJournalCapturedIdentities'
import { stageSnapshotJournalDestinationPage } from './SnapshotJournalDestinationStage'
import { applySnapshotJournalProvenancePage } from './SnapshotJournalProvenance'
import {
  beginSnapshotJournalProgress,
  advanceSnapshotJournalProgress,
  readSnapshotJournalProgress
} from './SnapshotJournalProgress'
import {
  cleanupSnapshotJournalAcknowledgedWindow,
  cleanupSnapshotJournalWindowCustody,
  requireSnapshotJournalWindowClean
} from './SnapshotJournalWindowCleanup'
import { promoteSnapshotJournalData } from './KnexSnapshotJournalDestination'

function invalid(): never {
  throw new WERR_INVALID_OPERATION('Journal DATA destination differs from its actual admitted window')
}

function ownLimits(input: SnapshotJournalDestinationLimits): SnapshotJournalDestinationLimits {
  const limits = { ...input }
  if (
    !Number.isSafeInteger(limits.maximumChanges) ||
    limits.maximumChanges < 1 ||
    limits.maximumChanges > 32 ||
    !Number.isSafeInteger(limits.maximumAllocationBytes) ||
    limits.maximumAllocationBytes < 1 ||
    limits.maximumAllocationBytes > 16777216
  )
    invalid()
  return limits
}

/** Actual target-owned receiver. Source receipt/primary/packet values are DATA;
 * they never provide a SQL source actor or select the target primary. The caller
 * supplies its actual authenticated manager/provider queue, not a wire callback.
 * All financial writes use fresh physical target/schema/profile/window fences.
 */
export class KnexSnapshotJournalDataDestination {
  private busy = false
  private readonly root: Knex
  private constructor(
    private readonly storage: StorageKnex,
    readonly binding: Readonly<SnapshotJournalDestinationBinding>,
    private readonly limits: SnapshotJournalDestinationLimits,
    private readonly admission: SnapshotJournalWriterAdmission,
    private readonly signal?: AbortSignal
  ) {
    this.root = storage.knex
  }

  static async begin(
    storage: StorageKnex,
    identityKey: string,
    input: SnapshotJournalArchiveBinding,
    limits: SnapshotJournalDestinationLimits,
    admission: SnapshotJournalWriterAdmission,
    signal?: AbortSignal
  ): Promise<{ destination: KnexSnapshotJournalDataDestination; checkpoint: SnapshotJournalDestinationCheckpoint }> {
    limits = ownLimits(limits)
    const source = parseSnapshotJournalArchiveBinding(input),
      root = storage.knex
    if (source.user.identityKey !== identityKey)
      throw new WERR_UNAUTHORIZED('Journal DATA profile must match authentication')
    if (source.sourceStorage.chain !== storage.chain || typeof admission !== 'function') invalid()
    signal?.throwIfAborted()
    const begin = await admission(
      async () =>
        await storage.runSnapshotJournalWriter(
          async (trx, backend) => {
            if (storage.knex !== root || backend === source.journal.source.backend) invalid()
            await verifySnapshotJournalDestinationSchema(trx)
            await readSnapshotJournalCaptureConfiguration(trx)
            const users: Array<{ userId: unknown; activeStorage: unknown; identityKey: unknown }> = await trx('users')
              .where('identityKey', identityKey)
              .select(
                'userId',
                trx.raw('substr(identityKey,1,131) AS identityKey'),
                trx.raw('substr(activeStorage,1,257) AS activeStorage')
              )
              .limit(2)
            const settings: Array<{ storageIdentityKey: unknown; chain: unknown }> = await trx('settings')
              .select(
                trx.raw('substr(storageIdentityKey,1,257) AS storageIdentityKey'),
                trx.raw('substr(chain,1,9) AS chain')
              )
              .limit(2)
            if (
              users.length !== 1 ||
              settings.length !== 1 ||
              users[0].identityKey !== identityKey ||
              !Number.isSafeInteger(Number(users[0].userId)) ||
              Number(users[0].userId) < 1 ||
              typeof settings[0].storageIdentityKey !== 'string' ||
              settings[0].chain !== source.journal.source.chain ||
              !(users[0].activeStorage === null || typeof users[0].activeStorage === 'string')
            )
              invalid()
            const userId = Number(users[0].userId),
              mysql = ['mysql', 'mysql2'].includes(String(trx.client.config.client)),
              epochs: Array<{ epoch: unknown }> = await trx('snapshot_sync_primary_epochs')
                .where('userId', userId)
                .select(trx.raw(mysql ? 'CAST(epoch AS CHAR) AS epoch' : 'CAST(epoch AS TEXT) AS epoch'))
                .limit(2)
            if (epochs.length > 1) invalid()
            const binding: SnapshotJournalDestinationBinding = {
              lineageVersion: 2,
              ...(source.journal.bootstrap ? { bootstrap: true as const } : {}),
              source: { ...source.journal.source },
              receipt: { ...source.journal.receipt },
              low: source.journal.low,
              destinationBackend: backend,
              destinationStorageIdentity: settings[0].storageIdentityKey,
              destinationUserId: userId,
              primaryEpoch: snapshotJournalRevision(epochs[0]?.epoch ?? '0'),
              activeStorage: users[0].activeStorage
            }
            const previous = await readSnapshotJournalStoredWindow(trx, binding)
            if (
              previous !== undefined &&
              !previous.retired &&
              previous.checkpoint.phase === 'acknowledged' &&
              !source.journal.bootstrap &&
              (await new KnexSnapshotJournalDataContentReceipts(storage, root).destinationMatches(
                trx as Knex.Transaction,
                previous.binding,
                previous.checkpoint
              )) === false
            )
              throw new SnapshotJournalDataBootstrapRequiredError()
            if (
              previous !== undefined &&
              !previous.retired &&
              JSON.stringify(previous.binding) === JSON.stringify(binding)
            ) {
              const checkpoint = await readSnapshotJournalDestinationWindow(trx, binding)
              if (checkpoint === undefined) invalid()
              await new KnexSnapshotJournalDataContentReceipts(storage, root).pending(
                trx as Knex.Transaction,
                binding,
                checkpoint,
                source.snapshotId,
                source.journal.contentRevision
              )
              return { binding, checkpoint, previous: undefined, incremental: false }
            }
            if (previous !== undefined) {
              if (
                previous.binding.lineageVersion !== 2 ||
                snapshotJournalLineage(previous.binding) !== snapshotJournalLineage(binding)
              )
                invalid()
              const incremental =
                !source.journal.bootstrap &&
                !previous.retired &&
                previous.checkpoint.phase === 'acknowledged' &&
                snapshotJournalAssociationGeneration(previous.binding) ===
                  snapshotJournalAssociationGeneration(binding) &&
                previous.binding.receipt.highWater === binding.low
              if (!source.journal.bootstrap && !incremental) throw new SnapshotJournalDataBootstrapRequiredError()
              return { binding, checkpoint: undefined, previous, incremental }
            }
            if (!source.journal.bootstrap) throw new SnapshotJournalDataBootstrapRequiredError()
            const scopes = await trx('snapshot_reconciliation_windows')
              .where('userId', userId)
              .select('sourceStorageIdentity')
              .limit(9)
            if (scopes.length >= 8) throw new SnapshotResourceLimitError('Journal DATA source-scope quota reached')
            const checkpoint = await beginSnapshotJournalDestinationWindow(
              trx,
              binding,
              randomBytes(32).toString('hex')
            )
            await beginSnapshotJournalProgress(trx, binding, checkpoint)
            await new KnexSnapshotJournalDataContentReceipts(storage, root).pending(
              trx as Knex.Transaction,
              binding,
              checkpoint,
              source.snapshotId,
              source.journal.contentRevision
            )
            return { binding, checkpoint, previous: undefined, incremental: false }
          },
          undefined,
          signal
        )
    )
    if (storage.knex !== root) invalid()
    const destination = new KnexSnapshotJournalDataDestination(
      storage,
      Object.freeze({
        ...begin.binding,
        source: Object.freeze({ ...begin.binding.source }),
        receipt: Object.freeze({ ...begin.binding.receipt })
      }),
      Object.freeze({ ...limits }),
      admission,
      signal
    )
    let checkpoint = begin.checkpoint
    if (begin.previous !== undefined) {
      const previous = begin.previous
      if (!begin.incremental)
        await destination.writer(
          async trx => await retireSnapshotJournalDestinationWindow(trx, previous.binding, previous.checkpoint)
        )
      let clean = false
      while (!clean) {
        signal?.throwIfAborted()
        clean = (
          await destination.writer(async trx =>
            begin.incremental
              ? await cleanupSnapshotJournalAcknowledgedWindow(trx, previous.binding, previous.checkpoint)
              : await cleanupSnapshotJournalWindowCustody(trx, previous.binding, previous.checkpoint)
          )
        ).complete
      }
      checkpoint = await destination.writer(async trx => {
        const requireClean = async (fenced: Knex) =>
          await requireSnapshotJournalWindowClean(fenced, previous.binding, previous.checkpoint)
        const next = begin.incremental
          ? await succeedSnapshotJournalDestinationWindow(
              trx,
              previous.binding,
              previous.checkpoint,
              begin.binding,
              randomBytes(32).toString('hex'),
              requireClean
            )
          : await replaceSnapshotJournalDestinationWindow(
              trx,
              previous.binding,
              previous.checkpoint,
              begin.binding,
              randomBytes(32).toString('hex'),
              requireClean
            )
        await beginSnapshotJournalProgress(trx, begin.binding, next)
        await new KnexSnapshotJournalDataContentReceipts(storage, root).pending(
          trx as Knex.Transaction,
          begin.binding,
          next,
          source.snapshotId,
          source.journal.contentRevision
        )
        return next
      })
    }
    if (checkpoint === undefined) invalid()
    await destination.verifyCurrent()
    return { destination, checkpoint }
  }

  /** Replacement controllers recover the actual stored binding/checkpoint.
   * A caller-supplied session or copied schema value cannot create this actor. */
  static async resume(
    storage: StorageKnex,
    identityKey: string,
    sourceStorageIdentity: string,
    limits: SnapshotJournalDestinationLimits,
    admission: SnapshotJournalWriterAdmission,
    signal?: AbortSignal
  ): Promise<KnexSnapshotJournalDataDestination | undefined> {
    if (typeof admission !== 'function') invalid()
    const root = storage.knex,
      ownedLimits = ownLimits(limits)
    const binding = await admission(
      async () =>
        await storage.runSnapshotJournalWriter(async (trx, backend) => {
          if (storage.knex !== root) invalid()
          await verifySnapshotJournalDestinationSchema(trx)
          await readSnapshotJournalCaptureConfiguration(trx)
          const users: Array<{ userId: number }> = await trx('users')
            .where('identityKey', identityKey)
            .select('userId')
            .limit(2)
          if (users.length !== 1) throw new WERR_UNAUTHORIZED('Journal DATA current profile is unavailable')
          const rows: Array<{ bindingJson: unknown }> = await trx('snapshot_reconciliation_windows')
            .where({ userId: users[0].userId, sourceStorageIdentity })
            .select(trx.raw('substr(bindingJson,1,4097) AS bindingJson'))
            .limit(2)
          if (rows.length === 0) return undefined
          if (
            rows.length !== 1 ||
            typeof rows[0].bindingJson !== 'string' ||
            Buffer.byteLength(rows[0].bindingJson) > 4096
          )
            invalid()
          const value = JSON.parse(rows[0].bindingJson) as SnapshotJournalDestinationBinding
          if (
            value.source.identityKey !== identityKey ||
            value.source.storageIdentity !== sourceStorageIdentity ||
            value.source.chain !== storage.chain ||
            value.destinationBackend !== backend
          )
            invalid()
          const actual = await readSnapshotJournalStoredWindow(trx, value)
          if (actual === undefined || actual.retired) invalid()
          return actual.binding
        }),
      'observe'
    )
    if (storage.knex !== root) invalid()
    return binding === undefined
      ? undefined
      : new KnexSnapshotJournalDataDestination(
          storage,
          Object.freeze({
            ...binding,
            source: Object.freeze({ ...binding.source }),
            receipt: Object.freeze({ ...binding.receipt })
          }),
          Object.freeze(ownedLimits),
          admission,
          signal
        )
  }

  private current(): void {
    if (this.storage.knex !== this.root || this.storage.chain !== this.binding.source.chain) invalid()
  }
  private async verifyCurrent(): Promise<void> {
    this.current()
    if (!(await this.storage.supportsSnapshotJournalSync())) invalid()
    this.current()
  }
  private async writer<T>(apply: (trx: Knex) => Promise<T>, observe = false): Promise<T> {
    this.current()
    return await this.admission(
      async () =>
        await this.storage.runSnapshotJournalWriter(
          async (trx, backend) => {
            this.current()
            if (backend !== this.binding.destinationBackend) invalid()
            await verifySnapshotJournalDestinationSchema(trx)
            await readSnapshotJournalCaptureConfiguration(trx)
            this.current()
            const result = await apply(trx)
            this.current()
            return result
          },
          this.binding.destinationBackend,
          observe ? undefined : this.signal
        ),
      observe ? 'observe' : undefined
    )
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) invalid()
    this.busy = true
    try {
      return await operation()
    } finally {
      this.busy = false
    }
  }
  async status() {
    return await this.exclusive(
      async () =>
        await this.writer(async trx => {
          const checkpoint = await readSnapshotJournalDestinationWindow(trx, this.binding)
          if (checkpoint === undefined) invalid()
          return { checkpoint, progress: await readSnapshotJournalProgress(trx, this.binding, checkpoint) }
        }, true)
    )
  }
  /** Bounded DATA prefixes may replay without advancing the durable intake ACK.
   * A complete verified frame seals them and stages provenance plus ACK atomically. */
  async stagePacket(
    expected: SnapshotJournalDestinationCheckpoint,
    input: Uint8Array
  ): Promise<SnapshotJournalDestinationCheckpoint> {
    expected = { ...expected, ...(expected.after === undefined ? {} : { after: { ...expected.after } }) }
    return await this.exclusive(async () => {
      this.signal?.throwIfAborted()
      const stream = snapshotJournalDestinationStreams[expected.streamIndex]
      if (expected.phase !== 'intake' || stream === undefined) invalid()
      const packet = decodeSnapshotJournalArchivePacket(input, stream, this.binding.receipt.highWater)
      await this.verifyCurrent()
      if (packet.kind !== 'frame') {
        const groups = packet.kind === 'identities' ? [packet] : packet.groups
        await this.writer(
          async trx =>
            await withSnapshotJournalDestinationWindowFence(trx, this.binding, expected, async fenced => {
              for (const group of groups)
                await captureSnapshotJournalIdentities(
                  fenced,
                  this.binding,
                  expected,
                  packet.frameDigest,
                  group.changeIndex,
                  group.identities,
                  this.limits
                )
            })
        )
        return { ...expected, ...(expected.after === undefined ? {} : { after: { ...expected.after } }) }
      }
      for (const change of packet.page.changes) {
        if (change.present && Object.hasOwn(change.row, 'userId') && change.row.userId !== this.binding.source.userId)
          throw new WERR_UNAUTHORIZED('Journal DATA row belongs to a different source profile')
      }
      if (stream.tableId === 8) {
        const proofs = packet.page.changes.flatMap(change =>
          change.present ? [change.row as unknown as TableProvenTx] : []
        )
        if (proofs.length) await validateSyncProofs(this.storage, proofs)
        // Refresh policy may validate a replacement proof, but never rewrites the
        // integrity-bound original frame or grants its candidate a cached verdict.
        await this.verifyCurrent()
      }
      const result = await this.writer(async trx => {
        this.signal?.throwIfAborted()
        await sealSnapshotJournalCapturedFrame(
          trx,
          this.binding,
          expected,
          packet.frameDigest,
          packet.page.changes.length
        )
        await requireSnapshotJournalCapturedFrame(
          trx,
          this.binding,
          expected,
          packet.frameDigest,
          packet.page.changes.length
        )
        if (stream.tableId === 7)
          await applySnapshotJournalProvenancePage(trx, this.binding, expected, packet.page, this.limits)
        const committed = await stageSnapshotJournalDestinationPage(
          trx,
          this.binding,
          expected,
          packet.page,
          this.limits
        )
        await advanceSnapshotJournalProgress(trx, this.binding, expected, committed.checkpoint, {
          pages: 1,
          examined: committed.result.examined,
          payloadBytes: committed.result.bytes
        })
        return committed
      })
      return result.checkpoint
    })
  }
  async promote(expected: SnapshotJournalDestinationCheckpoint) {
    return await this.exclusive(
      async () =>
        await promoteSnapshotJournalData(
          this.storage,
          this.binding,
          expected,
          this.limits,
          async apply => await this.writer(apply),
          async () => await this.verifyCurrent(),
          this.signal,
          async (trx, checkpoint) =>
            await new KnexSnapshotJournalDataContentReceipts(this.storage, this.root).complete(
              trx,
              this.binding,
              checkpoint
            )
        )
    )
  }
  async previousContentReceipt() {
    return await this.exclusive(
      async () =>
        await this.writer(async trx => {
          const checkpoint = await readSnapshotJournalDestinationWindow(trx, this.binding)
          return checkpoint === undefined
            ? undefined
            : await new KnexSnapshotJournalDataContentReceipts(this.storage, this.root).previous(
                trx as Knex.Transaction,
                this.binding,
                checkpoint
              )
        }, true)
    )
  }
  async confirmContentReceipt(revision: SnapshotSyncContentRevision) {
    return await this.exclusive(
      async () =>
        await this.writer(async trx => {
          const checkpoint = await readSnapshotJournalDestinationWindow(trx, this.binding)
          return checkpoint === undefined
            ? undefined
            : await new KnexSnapshotJournalDataContentReceipts(this.storage, this.root).confirm(
                trx as Knex.Transaction,
                this.binding,
                checkpoint,
                revision
              )
        }, true)
    )
  }
  async cleanup(expected: SnapshotJournalDestinationCheckpoint) {
    return await this.exclusive(
      async () =>
        await this.writer(
          async trx => await cleanupSnapshotJournalAcknowledgedWindow(trx, this.binding, expected),
          true
        )
    )
  }
}
