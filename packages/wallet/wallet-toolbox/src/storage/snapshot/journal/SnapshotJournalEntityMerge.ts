import type { SyncMap } from '../../schema/entities/EntityBase'
import { createHash } from 'node:crypto'
import type { Knex } from 'knex'
import type { StorageKnex } from '../../StorageKnex'
import type { SyncChunk } from '../../../sdk/WalletStorage.interfaces'
import { WERR_INVALID_OPERATION } from '../../../sdk/WERR_errors'
import type { TableProvenTx } from '../../schema/tables'
import { mergeSyncChunkEntities } from '../../schema/entities/mergeSyncChunkEntities'
import { validateSyncProof } from '../../methods/validateSyncProof'
import { SnapshotResourceLimitError } from '../SnapshotResourceLimitError'
import type { SnapshotJournalDelta } from './SnapshotJournalDeltaPage'
import { encodeSnapshotJournalDeltaFrame } from './SnapshotJournalDeltaFrame'
import {
  readSnapshotJournalCapturedIdentities,
  type SnapshotJournalCapturedIdentity
} from './SnapshotJournalCapturedIdentities'
import {
  snapshotJournalDestinationStreams,
  withSnapshotJournalDestinationWindowFence,
  type SnapshotJournalDestinationBinding,
  type SnapshotJournalDestinationCheckpoint
} from './SnapshotJournalDestinationWindow'
import type { SnapshotJournalDestinationStageReceipt } from './SnapshotJournalDestinationStage'
import {
  applySnapshotJournalIdentityTransition,
  type SnapshotJournalIdentityTransitionLimits
} from './SnapshotJournalIdentityRetirements'
import {
  loadSnapshotJournalDestinationParents,
  snapshotJournalIdentityEntities,
  verifySnapshotJournalDestinationIdentity
} from './SnapshotJournalDestinationIdentities'
import {
  chargeSnapshotJournalAllocation,
  normalizeSnapshotJournalNativeRow,
  readSnapshotJournalNativeEntityRows,
  snapshotJournalNativeFindTable,
  verifySnapshotJournalEntityIndexes,
  type SnapshotJournalAllocationBudget,
  type SnapshotJournalEntityTable
} from './SnapshotJournalNativeRows'
import { brc38ImportTargetIndexName } from '../../portable/Brc38ImportTargetIndexes'
import {
  snapshotJournalLocalMembershipKey,
  updateSnapshotJournalMembership,
  readSnapshotJournalMembershipPreimage,
  readSnapshotJournalInheritedMembershipPreimage,
  type SnapshotJournalMembershipChange,
  type SnapshotJournalMembershipLimits
} from './SnapshotJournalMemberships'

export interface SnapshotJournalEntityMergeLimits
  extends SnapshotJournalIdentityTransitionLimits, SnapshotJournalMembershipLimits {}

const tables: readonly (SnapshotJournalEntityTable | 'syncStates')[] = [
  'transactions',
  'outputs',
  'certificates',
  'txLabels',
  'outputBaskets',
  'outputTags',
  'commissions',
  'syncStates',
  'provenTxs',
  'provenTxReqs',
  'txLabelMaps',
  'outputTagMaps',
  'certificateFields'
]
const writes = new Set([
  'insertProvenTx',
  'updateProvenTx',
  'insertProvenTxReq',
  'updateProvenTxReq',
  'insertTransaction',
  'updateTransaction',
  'insertOutput',
  'updateOutput',
  'insertCertificate',
  'updateCertificate',
  'insertCertificateField',
  'updateCertificateField',
  'insertOutputBasket',
  'updateOutputBasket',
  'insertOutputTag',
  'updateOutputTag',
  'insertTxLabel',
  'updateTxLabel',
  'insertTxLabelMap',
  'updateTxLabelMap',
  'insertOutputTagMap',
  'updateOutputTagMap',
  'insertCommission',
  'updateCommission'
])
function invalid(): never {
  throw new WERR_INVALID_OPERATION('Journal semantic application differs from its prepared staged row')
}
function rowDigest(change: SnapshotJournalDelta, receipt: SnapshotJournalDestinationStageReceipt): string {
  const context = snapshotJournalDestinationStreams[receipt.streamIndex]
  if (context === undefined || context.tableId !== receipt.tableId) invalid()
  const { revision, id1, id2, exactText } = change.metadata
  return createHash('sha256')
    .update(
      encodeSnapshotJournalDeltaFrame(
        {
          table: tables[receipt.tableId],
          changes: [change],
          examined: 1,
          payloadBytes: 0,
          complete: false,
          after: { revision, id1, id2, exactText }
        },
        context
      )
    )
    .digest('hex')
}

export async function* readSnapshotJournalEntityFrameIdentities(
  k: Knex,
  binding: SnapshotJournalDestinationBinding,
  state: SnapshotJournalDestinationCheckpoint,
  digest: string,
  changeIndex: number,
  scope?: 'request-scalars'
): AsyncGenerator<SnapshotJournalCapturedIdentity[]> {
  let after: { tableId: SnapshotJournalCapturedIdentity['tableId']; incomingId: number } | undefined
  while (true) {
    const batch = await readSnapshotJournalCapturedIdentities(
      k,
      binding,
      state,
      digest,
      changeIndex,
      after,
      scope === undefined ? undefined : { kind: scope }
    )
    if (batch.length === 0) return
    yield batch
    const last = batch[batch.length - 1]
    after = { tableId: last.tableId, incomingId: last.incomingId }
    if (batch.length < 128) return
  }
}

/** Keep the original proof epoch and artifact invalidation semantics. Bound
 * writer work using the owned ready index before invoking the native update;
 * never fetch BEEF bytes just to determine the invalidation set. */
async function invalidateProofArtifacts(
  k: Knex,
  storage: StorageKnex,
  budget: SnapshotJournalAllocationBudget
): Promise<number> {
  const remote = ['mysql', 'mysql2'].includes(String(k.client.config.client))
  const query = k
    .from(
      k.raw(remote ? 'prepared_beefs FORCE INDEX (??)' : 'prepared_beefs INDEXED BY ??', [
        brc38ImportTargetIndexName('preparedBeefReady', k)
      ])
    )
    .where({ state: 'ready' })
    .select('preparedBeefId')
    .orderBy('preparedBeefId')
    .limit(4097)
  if (remote) query.forUpdate().noWait()
  const rows: Array<{ preparedBeefId: unknown }> = await query
  if (rows.length > 4096)
    throw new SnapshotResourceLimitError('Journal proof invalidation exceeds bounded writer capacity')
  chargeSnapshotJournalAllocation(budget, 256 * rows.length)
  if (rows.some(row => !Number.isSafeInteger(Number(row.preparedBeefId)) || Number(row.preparedBeefId) < 1)) invalid()
  return await storage.invalidatePreparedBeefs(k)
}

/** Internal, one-use prepared data. It confers no source, provider or destination
 * authority. The coordinator supplies the actual authenticated staged change
 * and a freshly verified source lease; the writer independently checks the
 * destination fence, original frame/row, live indexes and mapped natural keys. */
export class SnapshotJournalPreparedEntityMerge {
  #consumed = false
  private constructor(
    private readonly storage: StorageKnex,
    private readonly table: SnapshotJournalEntityTable,
    private readonly row: Record<string, unknown>,
    private readonly digest: string,
    private readonly frameDigest: string,
    private readonly changeIndex: number,
    private readonly budget: SnapshotJournalAllocationBudget,
    private readonly signal?: AbortSignal
  ) {}

  static async prepare(
    storage: StorageKnex,
    binding: SnapshotJournalDestinationBinding,
    change: SnapshotJournalDelta,
    receipt: SnapshotJournalDestinationStageReceipt,
    changeIndex: number,
    maximumAllocationBytes: number,
    signal?: AbortSignal
  ): Promise<SnapshotJournalPreparedEntityMerge> {
    signal?.throwIfAborted()
    const table = tables[receipt.tableId]
    if (
      !change.present ||
      table === undefined ||
      table === 'syncStates' ||
      !Number.isSafeInteger(changeIndex) ||
      changeIndex < 0 ||
      changeIndex > 255 ||
      !Number.isSafeInteger(maximumAllocationBytes) ||
      maximumAllocationBytes < 1 ||
      maximumAllocationBytes > 16777216
    )
      invalid()
    const digest = rowDigest(change, receipt)
    const budget = { remaining: maximumAllocationBytes }
    if (
      Object.hasOwn(change.row, 'userId') &&
      change.row.userId !== binding.source.userId &&
      Number(change.row.userId) !== binding.source.userId
    )
      invalid()
    const row = normalizeSnapshotJournalNativeRow(storage, table, change.row, budget)
    if (table === 'provenTxs') {
      // Keep this exact candidate object: the existing validator binds the
      // cryptographic replacement decision to it, not to a serialized token.
      await validateSyncProof(storage, row as unknown as TableProvenTx)
    }
    signal?.throwIfAborted()
    return new SnapshotJournalPreparedEntityMerge(
      storage,
      table,
      row,
      digest,
      receipt.digest,
      changeIndex,
      budget,
      signal
    )
  }

  async apply(
    k: Knex,
    binding: SnapshotJournalDestinationBinding,
    expected: SnapshotJournalDestinationCheckpoint,
    change: SnapshotJournalDelta,
    receipt: SnapshotJournalDestinationStageReceipt,
    changeIndex: number,
    limits: SnapshotJournalEntityMergeLimits
  ): Promise<{ inserts: number; updates: number }> {
    if (
      this.#consumed ||
      receipt.digest !== this.frameDigest ||
      changeIndex !== this.changeIndex ||
      rowDigest(change, receipt) !== this.digest
    )
      invalid()
    this.#consumed = true
    this.signal?.throwIfAborted()
    return await applySnapshotJournalPreparedEntityEffect(
      k,
      binding,
      expected,
      change,
      receipt,
      changeIndex,
      limits,
      this.budget,
      async (trx, map, observeCurrent) => {
        const chunk = {
          fromStorageIdentityKey: binding.source.storageIdentity,
          toStorageIdentityKey: binding.destinationStorageIdentity,
          userIdentityKey: binding.source.identityKey,
          [this.table]: [this.row]
        } as SyncChunk
        const storage = this.storage
        const adapter = new Proxy(storage, {
          get: (target, name) => {
            if (typeof name !== 'string') return Reflect.get(target, name)
            if (name.startsWith('find'))
              return async (args: { partial: Readonly<Record<string, string | number>>; trx?: unknown }) => {
                const rows = await readSnapshotJournalNativeEntityRows(trx, storage, name, args, this.budget)
                if (snapshotJournalNativeFindTable(name) === this.table && rows.length === 1) {
                  await observeCurrent(rows[0])
                }
                return rows
              }
            if (name === 'invalidatePreparedBeefs')
              return async (token: unknown) => {
                if (token !== trx) invalid()
                return await invalidateProofArtifacts(trx, storage, this.budget)
              }
            if (!writes.has(name)) invalid()
            const method: unknown = Reflect.get(target, name)
            if (typeof method !== 'function') invalid()
            return async (...args: unknown[]) => {
              this.signal?.throwIfAborted()
              if (args[args.length - 1] !== trx) invalid()
              return await Reflect.apply(method, target, args)
            }
          }
        })
        const result = await mergeSyncChunkEntities(adapter, binding.destinationUserId, undefined, chunk, map, trx, {
          preserveManagedChangePolicy: true
        })
        this.signal?.throwIfAborted()
        return { inserts: result.inserts, updates: result.updates }
      }
    )
  }
}

/** Shared actual identity/parent/membership effect boundary. An incoming row or
 * field descriptor cannot supply SQL authority. The caller owns a real admitted
 * destination writer plus a one-use prepared semantic effect; this function
 * freshly loads captured identities, checks natural keys/generations and records
 * actual postimage custody in the same savepoint. No source/network I/O here. */
export async function applySnapshotJournalPreparedEntityEffect(
  k: Knex,
  binding: SnapshotJournalDestinationBinding,
  expected: SnapshotJournalDestinationCheckpoint,
  change: SnapshotJournalMembershipChange,
  receipt: SnapshotJournalDestinationStageReceipt,
  changeIndex: number,
  limits: SnapshotJournalEntityMergeLimits,
  budget: SnapshotJournalAllocationBudget,
  effect: (
    trx: Knex,
    map: SyncMap,
    observeCurrent: (row: Readonly<Record<string, unknown>>) => Promise<void>
  ) => Promise<{ inserts: number; updates: number }>,
  parentScope?: 'request-scalars'
): Promise<{ inserts: number; updates: number }> {
  if (
    (parentScope !== undefined && (parentScope !== 'request-scalars' || receipt.tableId !== 9)) ||
    !change.present ||
    !change.metadata.present ||
    !Number.isSafeInteger(changeIndex) ||
    changeIndex < 0 ||
    changeIndex > 255 ||
    snapshotJournalDestinationStreams[receipt.streamIndex]?.tableId !== receipt.tableId
  )
    invalid()
  return await withSnapshotJournalDestinationWindowFence(k, binding, expected, async fenced => {
    await verifySnapshotJournalEntityIndexes(fenced)
    const { map, self } = await loadSnapshotJournalDestinationParents(
      fenced,
      binding,
      expected,
      readSnapshotJournalEntityFrameIdentities(fenced, binding, expected, receipt.digest, changeIndex, parentScope),
      limits,
      budget
    )
    let preimage: { fingerprint: string; generation: string; inheritedCreated?: true } | undefined =
      await readSnapshotJournalMembershipPreimage(fenced, binding, receipt.tableId, change, budget)
    const merge = async (trx: Knex): Promise<{ inserts: number; updates: number }> =>
      await effect(trx, map, async row => {
        const inherited = await readSnapshotJournalInheritedMembershipPreimage(
          trx,
          binding,
          receipt.tableId,
          row,
          budget
        )
        if (inherited !== undefined) preimage = inherited
      })
    if (self === undefined) {
      if (receipt.tableId < 10) invalid()
      const result = await merge(fenced)
      await updateSnapshotJournalMembership(
        fenced,
        binding,
        expected,
        receipt.tableId,
        change,
        snapshotJournalLocalMembershipKey(receipt.tableId, change, map),
        result.inserts === 1,
        limits,
        budget,
        preimage
      )
      return result
    }
    if (
      self.tableId !== receipt.tableId ||
      self.incomingId !== change.metadata.id1 ||
      (change.metadata.generation !== undefined && self.generation !== change.metadata.generation)
    )
      invalid()
    let missingBootstrapLocalId: number | undefined
    return await applySnapshotJournalIdentityTransition(
      fenced,
      binding,
      expected,
      [self],
      limits,
      async (trx, associations) => {
        const key = self.tableId + ':' + self.incomingId
        const previous = associations.get(key)
        if (previous !== undefined) {
          await verifySnapshotJournalDestinationIdentity(trx, binding.destinationUserId, self, previous, map)
          map[snapshotJournalIdentityEntities[self.tableId]].idMap[self.incomingId] = previous.localId
        }
        const result = await merge(trx)
        const localId = map[snapshotJournalIdentityEntities[self.tableId]].idMap[self.incomingId]
        if (!Number.isSafeInteger(localId) || localId < 1) invalid()
        await verifySnapshotJournalDestinationIdentity(
          trx,
          binding.destinationUserId,
          self,
          { generation: self.generation, naturalIdentity: self.naturalIdentity, localId },
          map
        )
        await updateSnapshotJournalMembership(
          trx,
          binding,
          expected,
          receipt.tableId,
          change,
          snapshotJournalLocalMembershipKey(receipt.tableId, change, map),
          result.inserts === 1,
          limits,
          budget,
          preimage,
          missingBootstrapLocalId
        )
        return { assignments: new Map([[key, localId]]), result }
      },
      binding.bootstrap === true
        ? async (trx, _reference, association) => {
            const present = await verifySnapshotJournalDestinationIdentity(
              trx,
              binding.destinationUserId,
              self,
              association,
              map,
              true
            )
            if (!present) missingBootstrapLocalId = association.localId
            return present
          }
        : undefined
    )
  })
}
