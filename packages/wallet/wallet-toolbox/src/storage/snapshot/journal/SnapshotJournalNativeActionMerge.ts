import { inspectBrc38StreamedProofReader } from '../../portable/Brc38StreamedProof'
import type { Brc38StreamedProofReader } from '../../portable/Brc38StreamedProof'
import type { Brc38JsonStreamedRow } from '../../portable/Brc38JsonBinaryFields'
import { applyPreparedNativeSnapshotProofs, type PreparedNativeSnapshotProof } from '../NativeSnapshotSyncProvenTxsNode'
import {
  nativeSnapshotSyncProofRow,
  readNativeSnapshotSyncProofCurrent,
  requireSameNativeSnapshotSyncProofCurrent,
  readNativeSnapshotSyncProofCurrentExtent
} from '../NativeSnapshotSyncProofCurrentNode'
import type { SnapshotJournalDestinationBinding, SnapshotJournalDestinationCheckpoint } from './SnapshotJournalTypes'
import { readSnapshotJournalDestinationFieldPromotionPage } from './SnapshotJournalDestinationStage'
import { requireSnapshotJournalCapturedFrame } from './SnapshotJournalCapturedIdentities'
import { createHash } from 'node:crypto'
import type { Knex } from 'knex'
import type { StorageKnex } from '../../StorageKnex'
import { ownedNativeRootIdentity } from '../../schema/ownedNativeSqliteConnectionsNode'
import { Brc38WorkingAllocation, type Brc38WorkingCharge } from '../../portable/Brc38WorkingAllocation'
import { Brc38StagingCleanupError } from '../../portable/Brc38StagingCleanupError'
import { prepareBrc38NativePackedTextWalletWrite } from '../../portable/Brc38NativePackedTextWalletNode'
import {
  snapshotSyncTransactionMetadata,
  snapshotSyncOutputMetadata,
  transactionPayloadFields,
  outputPayloadFields
} from '../SnapshotSyncActionMetadata'
import {
  readNativeSnapshotSyncActionCurrent,
  type NativeSnapshotSyncAction
} from '../NativeSnapshotSyncActionsCurrentNode'
import { applyPreparedNativeSnapshotActions, type PreparedNativeSnapshotAction } from '../NativeSnapshotSyncActionsNode'
import {
  preparePackedNativeSnapshotArchiveField,
  type PreparedPackedNativeSnapshotField
} from '../preparePackedNativeSnapshotFieldNode'
import {
  assertRemoteSnapshotJournalFieldFrame,
  type RemoteSnapshotJournalFieldArchive,
  type RemoteSnapshotJournalFieldFrame
} from './openRemoteSnapshotJournalFieldArchive'
import { encodeSnapshotJournalFieldFrame } from './SnapshotJournalDeltaFrame'
import type { SnapshotJournalHashedFieldDelta } from './SnapshotJournalFieldTypes'
import type { SnapshotJournalDestinationStageReceipt } from './SnapshotJournalDestinationStage'
import type { SnapshotJournalWriterAdmission, SnapshotJournalDestinationLimits } from './SnapshotJournalProvider'
import {
  withSnapshotJournalDestinationWindowFence,
  snapshotJournalDestinationStreams
} from './SnapshotJournalDestinationWindow'
import { verifySnapshotJournalDestinationSchema } from './SnapshotJournalDestinationSchema'
import { readSnapshotJournalCaptureConfiguration } from './SnapshotJournalLifecycle'
import { snapshotJournalReceiptBinding } from './SnapshotJournalReceipt'
import {
  applySnapshotJournalPreparedEntityEffect,
  readSnapshotJournalEntityFrameIdentities
} from './SnapshotJournalEntityMerge'
import { loadSnapshotJournalDestinationParents } from './SnapshotJournalDestinationIdentities'
import { normalizeSnapshotJournalNativeRow, type SnapshotJournalAllocationBudget } from './SnapshotJournalNativeRows'

function invalid(): never {
  throw new Error('Native journal action differs from its actual field/window/current ownership')
}
function changeDigest(
  change: SnapshotJournalHashedFieldDelta,
  receipt: SnapshotJournalDestinationStageReceipt
): string {
  const context = snapshotJournalDestinationStreams[receipt.streamIndex]
  if (context?.tableId !== receipt.tableId || !change.present || ![0, 1, 8].includes(receipt.tableId)) invalid()
  const { revision, id1, id2, exactText } = change.metadata
  return createHash('sha256')
    .update(
      encodeSnapshotJournalFieldFrame(
        {
          table: receipt.tableId === 0 ? 'transactions' : receipt.tableId === 1 ? 'outputs' : 'provenTxs',
          changes: [change],
          examined: 1,
          metadataBytes: 0,
          fieldBytes: Object.values(change.fields).reduce((sum, field) => sum + field.bytes, 0),
          complete: false,
          after: { revision, id1, id2, exactText }
        },
        context
      )
    )
    .digest('hex')
}

export interface PreparedSnapshotJournalNativeAction {
  /** Effect only; the real receiver owns outer transaction commit and ACK. */
  apply: (
    trx: Knex,
    binding: SnapshotJournalDestinationBinding,
    expected: SnapshotJournalDestinationCheckpoint,
    change: SnapshotJournalHashedFieldDelta,
    receipt: SnapshotJournalDestinationStageReceipt,
    changeIndex: number
  ) => Promise<{ inserts: number; updates: number }>
  close: () => Promise<void>
}

/** Genuine authenticated field archive -> prepared native financial action.
 * Source HTTP and content hashing finish outside target writer admission. The
 * original action kernel and actual identity/membership boundary run in the
 * final writer, including mapped parents, current generations, BRC177 quarantine
 * and one-use native attachments. No complete snapshot/session is fabricated. */
async function prepareSnapshotJournalNativeEntityMerge(
  storage: StorageKnex,
  binding: SnapshotJournalDestinationBinding,
  expected: SnapshotJournalDestinationCheckpoint,
  receipt: SnapshotJournalDestinationStageReceipt,
  changeIndex: number,
  source: RemoteSnapshotJournalFieldArchive,
  frame: RemoteSnapshotJournalFieldFrame,
  limits: SnapshotJournalDestinationLimits,
  admission: SnapshotJournalWriterAdmission,
  signal?: AbortSignal
): Promise<Readonly<PreparedSnapshotJournalNativeAction>> {
  binding = structuredClone(binding)
  expected = structuredClone(expected)
  receipt = { ...receipt }
  limits = Object.freeze({ ...limits })
  assertRemoteSnapshotJournalFieldFrame(source, frame)
  const root = storage.knex,
    origin = ownedNativeRootIdentity(root),
    originalBinding = JSON.stringify(binding),
    originalState = JSON.stringify(expected),
    page = frame.page,
    change = page.changes[changeIndex],
    encoded = encodeSnapshotJournalFieldFrame(page, { stream: frame.stream, tableId: frame.tableId }),
    digest = createHash('sha256').update(encoded).digest('hex'),
    working = new Brc38WorkingAllocation(limits.maximumAllocationBytes),
    allocations: Brc38WorkingCharge[] = [],
    stages: PreparedPackedNativeSnapshotField[] = [],
    failures = new Set<Brc38StagingCleanupError>(),
    expiresAt = Math.min(source.expiresAt, binding.receipt.expiresAt),
    deadline = performance.now() + expiresAt - Date.now()
  if (
    origin?.slot !== 0 ||
    root.isTransaction ||
    binding.fieldEncoding !== 'wallet-journal-fields/1' ||
    expected.phase !== 'promoting' ||
    !Number.isSafeInteger(changeIndex) ||
    changeIndex < 0 ||
    change === undefined ||
    !change.present ||
    ![0, 1, 8].includes(frame.tableId) ||
    receipt.tableId !== frame.tableId ||
    snapshotJournalDestinationStreams[receipt.streamIndex]?.stream !== frame.stream ||
    digest !== frame.frameDigest ||
    digest !== receipt.digest ||
    encoded.length !== receipt.bytes ||
    binding.source.identityKey !== source.manifest.binding.user.identityKey ||
    snapshotJournalReceiptBinding(binding.source) !==
      snapshotJournalReceiptBinding(source.manifest.binding.journal.source) ||
    JSON.stringify(binding.receipt) !== JSON.stringify(source.manifest.binding.journal.receipt) ||
    binding.low !== source.manifest.binding.journal.low ||
    typeof admission !== 'function'
  )
    invalid()
  const selectedChangeDigest = changeDigest(change, receipt),
    table = frame.tableId === 0 ? 'transactions' : frame.tableId === 1 ? 'outputs' : 'provenTxs',
    payloadNames: readonly string[] =
      table === 'transactions'
        ? transactionPayloadFields
        : table === 'outputs'
          ? outputPayloadFields
          : ['rawTx', 'merklePath']
  let closed = false,
    consumed = false,
    closing: Promise<void> | undefined,
    applying: Promise<{ inserts: number; updates: number }> | undefined,
    row: PreparedNativeSnapshotAction | undefined,
    proofRow: PreparedNativeSnapshotProof | undefined
  const check = (): void => {
    signal?.throwIfAborted()
    assertRemoteSnapshotJournalFieldFrame(source, frame)
    if (
      closed ||
      storage.knex !== root ||
      ownedNativeRootIdentity(root)?.token !== origin.token ||
      ownedNativeRootIdentity(root)?.slot !== 0 ||
      Date.now() >= expiresAt ||
      performance.now() >= deadline
    )
      invalid()
  }
  const requireOriginalStage = async (trx: Knex): Promise<void> => {
    const staged = await readSnapshotJournalDestinationFieldPromotionPage(trx, binding, expected)
    if (
      staged === undefined ||
      staged.receipt.digest !== receipt.digest ||
      staged.receipt.sequence !== receipt.sequence ||
      staged.page.changes[changeIndex] === undefined ||
      changeDigest(staged.page.changes[changeIndex], staged.receipt) !== selectedChangeDigest
    )
      invalid()
    await requireSnapshotJournalCapturedFrame(trx, binding, expected, receipt.digest, staged.page.changes.length)
  }
  const inspect = async <T>(operation: (trx: Knex.Transaction) => Promise<T>): Promise<T> =>
    await admission(
      async () =>
        await storage.runSnapshotJournalWriter(
          async (trx, backend) => {
            check()
            if (backend !== binding.destinationBackend) invalid()
            await verifySnapshotJournalDestinationSchema(trx)
            await readSnapshotJournalCaptureConfiguration(trx)
            return await withSnapshotJournalDestinationWindowFence(
              trx,
              binding,
              expected,
              async actual => await operation(actual as Knex.Transaction)
            )
          },
          binding.destinationBackend,
          signal
        )
    )
  const cleanup = async (): Promise<void> => {
    closed = true
    if (applying !== undefined) await applying.catch(() => undefined)
    const causes: unknown[] = []
    for (const stage of stages)
      try {
        await stage.close()
      } catch (cause) {
        causes.push(cause)
      }
    for (const failure of failures)
      try {
        await failure.retryCleanup()
        failures.delete(failure)
      } catch (cause) {
        causes.push(cause)
      }
    if (causes.length)
      throw new Brc38StagingCleanupError(causes, 'Journal action retains its actual prepared fields', cleanup)
    if (row !== undefined) for (const field of row.inline.fields) field.bytes.fill(0)
    for (const allocation of allocations) allocation.close()
    allocations.length = 0
    stages.length = 0
    row = undefined
    proofRow = undefined
  }
  try {
    check()
    allocations.push(working.claim(16384 + 16 * encoded.length))
    const budget: SnapshotJournalAllocationBudget = { remaining: working.maximum - working.used },
      before = budget.remaining,
      fields = normalizeSnapshotJournalNativeRow(storage, table, change.row, budget)
    allocations.push(working.claim(before - budget.remaining))
    if (table === 'provenTxs') {
      proofRow = await prepareJournalProofFields(
        storage,
        binding.destinationUserId,
        fields,
        change,
        source,
        frame,
        changeIndex,
        working,
        allocations,
        stages,
        check,
        async operation =>
          await inspect(async trx => {
            await requireOriginalStage(trx)
            return await operation(trx)
          }),
        expiresAt,
        deadline,
        signal
      )
    } else {
      if (fields.userId !== binding.source.userId) invalid()
      const action: NativeSnapshotSyncAction =
        table === 'transactions'
          ? { table, row: snapshotSyncTransactionMetadata(fields, change.fields) }
          : { table, row: snapshotSyncOutputMetadata(fields, change.fields) }
      const currentAllowance = working.claim(16384 + 16 * 65536)
      allocations.push(currentAllowance)
      const current = await inspect(async trx => {
        await requireOriginalStage(trx)
        const parentsBudget = { remaining: working.maximum - working.used },
          parents = await loadSnapshotJournalDestinationParents(
            trx,
            binding,
            expected,
            readSnapshotJournalEntityFrameIdentities(trx, binding, expected, receipt.digest, changeIndex),
            limits,
            parentsBudget
          )
        return await readNativeSnapshotSyncActionCurrent(
          storage,
          trx,
          binding.destinationUserId,
          action,
          parents.map,
          signal
        )
      })
      currentAllowance.resize(16384 + 16 * current.field.allocationBytes)
      const inlineText: Record<string, string> = {},
        rowStages: Record<string, PreparedPackedNativeSnapshotField> = {}
      let inlineBytes = 0
      for (const name of payloadNames) {
        const cell: unknown = Reflect.get(action.row, name)
        if (typeof cell === 'string') {
          inlineText[name] = cell
          inlineBytes += Buffer.byteLength(cell)
        }
      }
      allocations.push(working.claim(16384 + 16 * inlineBytes))
      row = {
        action,
        metadata: { fields },
        current,
        inline: prepareBrc38NativePackedTextWalletWrite(table, inlineText),
        stages: rowStages
      }
      for (const name of payloadNames)
        if (change.fields[name] !== undefined) {
          const stage = await preparePackedNativeSnapshotArchiveField(storage, source, frame, changeIndex, name, {
            workingAllocation: working,
            maximumFieldBytes: 1000000000,
            maximumReadBytes: 16384,
            expiresAt,
            signal
          })
          stages.push(stage)
          rowStages[name] = stage
          check()
        }
      Object.freeze(rowStages)
    }
    check()
    return Object.freeze({
      apply: async (
        trx: Knex,
        actualBinding: SnapshotJournalDestinationBinding,
        actualState: SnapshotJournalDestinationCheckpoint,
        actualChange: SnapshotJournalHashedFieldDelta,
        actualReceipt: SnapshotJournalDestinationStageReceipt,
        actualIndex: number
      ) => {
        check()
        if (
          consumed ||
          (row === undefined && proofRow === undefined) ||
          JSON.stringify(actualBinding) !== originalBinding ||
          JSON.stringify(actualState) !== originalState ||
          actualReceipt.digest !== receipt.digest ||
          actualReceipt.sequence !== receipt.sequence ||
          actualIndex !== changeIndex ||
          changeDigest(actualChange, actualReceipt) !== selectedChangeDigest
        )
          invalid()
        if (
          !trx.isTransaction ||
          ownedNativeRootIdentity(trx)?.token !== origin.token ||
          ownedNativeRootIdentity(trx)?.slot !== 0
        )
          invalid()
        consumed = true
        const reserved = working.maximum - working.used,
          currentReadBytes = 32768 + 16 * 65536
        if (reserved < currentReadBytes) invalid()
        const writerAllowance = working.claim(reserved),
          writerBudget = { remaining: reserved - currentReadBytes },
          prepared = row,
          preparedProof = proofRow
        applying = (async () => {
          await verifySnapshotJournalDestinationSchema(trx)
          await readSnapshotJournalCaptureConfiguration(trx)
          await requireOriginalStage(trx)
          check()
          return await applySnapshotJournalPreparedEntityEffect(
            trx,
            actualBinding,
            actualState,
            actualChange,
            actualReceipt,
            actualIndex,
            limits,
            writerBudget,
            async (actual, map, observeCurrent) => {
              check()
              if (table === 'provenTxs') {
                if (preparedProof === undefined) invalid()
                const current = await readNativeSnapshotSyncProofCurrent(
                  storage,
                  actual as Knex.Transaction,
                  binding.destinationUserId,
                  preparedProof.proof.txid,
                  signal
                )
                requireSameNativeSnapshotSyncProofCurrent(preparedProof.current, current)
                if (current.field.metadata !== undefined) await observeCurrent(current.field.metadata)
                return await applyPreparedNativeSnapshotProofs(
                  storage,
                  actual as Knex.Transaction,
                  binding.destinationUserId,
                  [preparedProof],
                  map,
                  check,
                  signal
                )
              }
              if (prepared === undefined) invalid()
              const current = await readNativeSnapshotSyncActionCurrent(
                storage,
                actual as Knex.Transaction,
                binding.destinationUserId,
                prepared.action,
                map,
                signal
              )
              if (current.field.metadata !== undefined) await observeCurrent(current.field.metadata)
              return await applyPreparedNativeSnapshotActions(
                storage,
                actual as Knex.Transaction,
                binding.destinationUserId,
                table,
                [prepared],
                map,
                check,
                signal
              )
            }
          )
        })()
        try {
          return await applying
        } finally {
          applying = undefined
          writerAllowance.close()
        }
      },
      close: async () => {
        if (closing === undefined) closing = cleanup()
        try {
          await closing
        } catch (cause) {
          closing = undefined
          throw cause
        }
      }
    })
  } catch (cause) {
    if (cause instanceof Brc38StagingCleanupError) failures.add(cause)
    try {
      await cleanup()
    } catch (cleanupCause) {
      throw new Brc38StagingCleanupError(
        [cause, cleanupCause],
        'Journal action preparation failed with retained cleanup',
        cleanup
      )
    }
    throw cause
  }
}

export async function prepareSnapshotJournalNativeActionMerge(
  ...args: Parameters<typeof prepareSnapshotJournalNativeEntityMerge>
): Promise<Readonly<PreparedSnapshotJournalNativeAction>> {
  if (![0, 1].includes(args[3].tableId)) invalid()
  return await prepareSnapshotJournalNativeEntityMerge(...args)
}
export async function prepareSnapshotJournalNativeProofMerge(
  ...args: Parameters<typeof prepareSnapshotJournalNativeEntityMerge>
): Promise<Readonly<PreparedSnapshotJournalNativeAction>> {
  if (args[3].tableId !== 8) invalid()
  return await prepareSnapshotJournalNativeEntityMerge(...args)
}

async function prepareJournalProofFields(
  storage: StorageKnex,
  userId: number,
  fields: Record<string, unknown>,
  change: Extract<SnapshotJournalHashedFieldDelta, { present: true }>,
  source: RemoteSnapshotJournalFieldArchive,
  frame: RemoteSnapshotJournalFieldFrame,
  changeIndex: number,
  working: Brc38WorkingAllocation,
  allocations: Brc38WorkingCharge[],
  stages: PreparedPackedNativeSnapshotField[],
  check: () => void,
  inspect: <T>(operation: (trx: Knex.Transaction) => Promise<T>) => Promise<T>,
  expiresAt: number,
  deadline: number,
  signal?: AbortSignal
): Promise<PreparedNativeSnapshotProof> {
  const proof = nativeSnapshotSyncProofRow(fields)
  if (
    Object.keys(change.fields).some(name => !['rawTx', 'merklePath'].includes(name)) ||
    change.fields.rawTx?.kind !== 'binary' ||
    change.fields.merklePath?.kind !== 'binary'
  )
    invalid()
  const allowance = working.claim(8192 + 16 * 65536)
  allocations.push(allowance)
  const current = await inspect(
    async trx => await readNativeSnapshotSyncProofCurrent(storage, trx, userId, proof.txid, signal)
  )
  allowance.resize(8192 + 16 * current.field.allocationBytes)
  const prepare = async (name: 'rawTx' | 'merklePath') => {
    check()
    const stage = await preparePackedNativeSnapshotArchiveField(storage, source, frame, changeIndex, name, {
      workingAllocation: working,
      maximumFieldBytes: 1000000000,
      maximumReadBytes: 16384,
      expiresAt,
      signal
    })
    stages.push(stage)
    check()
    return stage
  }
  const rawTx = await prepare('rawTx'),
    merklePath = await prepare('merklePath'),
    content = { rawTx, merklePath },
    portable: Brc38JsonStreamedRow = Object.freeze({
      fields: Object.freeze({
        txid: proof.txid,
        blockHash: proof.blockHash,
        merkleRoot: proof.merkleRoot,
        height: proof.height,
        index: proof.index
      }),
      binaries: Object.freeze({
        rawTx: Object.freeze({
          field: 'rawTx',
          encoding: 'base64' as const,
          bytes: rawTx.descriptor.bytes,
          sha256: rawTx.descriptor.sha256
        }),
        merklePath: Object.freeze({
          field: 'merklePath',
          encoding: 'base64' as const,
          bytes: merklePath.descriptor.bytes,
          sha256: merklePath.descriptor.sha256
        })
      })
    })
  const reader: Brc38StreamedProofReader = Object.freeze({
    row: async (table: 'provenTxs', index: number) => {
      check()
      if (table !== 'provenTxs' || index !== 0) invalid()
      for (const name of ['rawTx', 'merklePath'] as const) {
        const bytes = await source.readFieldExtent(frame, changeIndex, name, 0, 0)
        try {
          check()
          if (bytes.length !== 0) invalid()
        } finally {
          bytes.fill(0)
        }
      }
      return portable
    },
    chunks: async function* (
      table: 'provenTxs',
      index: number,
      field: import('../../portable/Brc38JsonBinaryFields').Brc38JsonStreamedField
    ) {
      check()
      if (table !== 'provenTxs' || index !== 0 || (field.field !== 'rawTx' && field.field !== 'merklePath')) invalid()
      const original = portable.binaries[field.field],
        stage = content[field.field]
      if (field.encoding !== original.encoding || field.bytes !== original.bytes || field.sha256 !== original.sha256)
        invalid()
      const reservation = working.claim(4096 + 16 * 65536)
      try {
        for (let offset = 0; offset < field.bytes;) {
          check()
          const length = Math.min(16384, field.bytes - offset),
            bytes = await stage.read(offset, length)
          try {
            check()
            if (bytes.length !== length) invalid()
            yield bytes
            check()
            offset += length
          } finally {
            bytes.fill(0)
          }
        }
      } finally {
        reservation.close()
      }
    }
  })
  // Unlike local full-snapshot trust, authenticated journal DATA always retains
  // the complete incoming raw/Merkle/current active-header validation policy.
  await inspectBrc38StreamedProofReader(
    reader,
    storage,
    0,
    {
      maximumRawBytes: 1000000000,
      maximumChunks: 100000,
      maximumMerkleBytes: 1048576,
      maximumDecodedMerkleBytes: 4194304,
      maximumChunkBytes: 16384,
      workingAllocation: working,
      maximumNetworkMilliseconds: 30000,
      cleanupMilliseconds: 30000,
      signal
    },
    expiresAt,
    deadline
  )
  check()
  let equal =
    current.row !== undefined &&
    current.row.txid === proof.txid &&
    current.row.height === proof.height &&
    current.row.index === proof.index &&
    current.row.blockHash === proof.blockHash &&
    current.row.merkleRoot === proof.merkleRoot
  for (const name of ['rawTx', 'merklePath'] as const) {
    const existing = current.field.binaries[name],
      stage = content[name]
    if (
      existing === undefined ||
      existing.bytes !== stage.descriptor.bytes ||
      existing.sha256 !== stage.descriptor.sha256
    )
      equal = false
    if (!equal) continue
    const reservation = working.claim(8192 + 32 * 65536)
    try {
      for (let offset = 0; offset < stage.descriptor.bytes;) {
        check()
        const length = Math.min(16384, stage.descriptor.bytes - offset),
          incoming = await stage.read(offset, length)
        let previous: Uint8Array | undefined
        try {
          previous = await inspect(
            async trx =>
              await readNativeSnapshotSyncProofCurrentExtent(
                storage,
                trx,
                userId,
                current,
                name,
                offset,
                length,
                signal
              )
          )
          check()
          if (incoming.length !== length || previous.length !== length) invalid()
          for (let at = 0; at < length; at++) if (incoming[at] !== previous[at]) equal = false
          offset += length
        } finally {
          incoming.fill(0)
          previous?.fill(0)
        }
        if (!equal) break
      }
    } finally {
      reservation.close()
    }
  }
  requireSameNativeSnapshotSyncProofCurrent(
    current,
    await inspect(async trx => await readNativeSnapshotSyncProofCurrent(storage, trx, userId, proof.txid, signal))
  )
  return Object.freeze({ proof, current, rawTx, merklePath, currentBytesEqual: equal })
}
