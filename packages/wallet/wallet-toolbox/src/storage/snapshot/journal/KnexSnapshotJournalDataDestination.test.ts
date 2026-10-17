import { encodeSnapshotJournalFieldFrame, decodeSnapshotJournalFieldFrame } from './SnapshotJournalDeltaFrame'
import type { RemoteSnapshotJournalFieldArchive } from './openRemoteSnapshotJournalFieldArchive'
import {
  retireSnapshotJournalDestinationWindow,
  replaceSnapshotJournalDestinationWindow
} from './SnapshotJournalDestinationWindow'
import { cleanupSnapshotJournalWindowCustody, requireSnapshotJournalWindowClean } from './SnapshotJournalWindowCleanup'
import * as RpcProofs from '../../remoting/validateRpcSyncProofs'
import { knex } from 'knex'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StorageKnex } from '../../StorageKnex'
import { StorageProvider } from '../../StorageProvider'
import { StorageClient } from '../../remoting/StorageClient'
import { WalletStorageManager } from '../../WalletStorageManager'
import { snapshotHttpFixture } from '../../../../test/utils/snapshotArchiveHttpFixtures'
import { KnexSnapshotJournalDataDestination } from './KnexSnapshotJournalDataDestination'
import { journalCopyLimits } from './SnapshotJournalCopyLimits'
import { snapshotJournalDestinationStreams } from './SnapshotJournalDestinationWindow'
import {
  encodeSnapshotJournalArchiveFrame,
  encodeSnapshotJournalArchiveIdentities
} from './SnapshotJournalArchivePacket'
import type { RemoteSnapshotJournalArchive } from './openRemoteSnapshotJournalArchive'
import type { SnapshotJournalDestinationCheckpoint } from './SnapshotJournalTypes'

async function fixture(full = false) {
  const source = await snapshotHttpFixture(true, full),
    directory = await mkdtemp(join(tmpdir(), 'journal-data-target-'))
  const target = new StorageKnex({
    ...StorageProvider.createStorageBaseOptions('test'),
    knex: knex({
      client: 'better-sqlite3',
      connection: { filename: join(directory, 'target.sqlite') },
      useNullAsDefault: true,
      pool: { min: 0, max: 1 }
    })
  })
  const close = async () => {
    const results = await Promise.allSettled([source.close(), target.destroy()])
    await rm(directory, { recursive: true, force: true })
    const errors = results.flatMap(x => (x.status === 'rejected' ? [x.reason] : []))
    if (errors.length) throw new AggregateError(errors, 'Actual journal DATA fixture cleanup failed')
  }
  try {
    await target.knex.raw('PRAGMA journal_mode=WAL')
    await target.migrate('DATA journal target', 'journal-data-target')
    await target.makeAvailable()
    await target.findOrInsertUser(source.identityKey)
    const manager = new WalletStorageManager(source.identityKey, target)
    await manager.makeAvailable()
    await manager.setActive(target.getSettings().storageIdentityKey)
    const admission = async <T>(operation: () => Promise<T>) =>
      await manager.runAsWriter(async active => {
        if (active !== target) throw new Error('Actual target manager changed')
        return await operation()
      })
    const { url } = await source.serve(),
      client = new StorageClient(source.wallet, url, { serverIdentityKey: source.serverIdentityKey })
    return { source, target, manager, admission, client, close }
  } catch (error) {
    await close()
    throw error
  }
}
async function copy(
  archive: RemoteSnapshotJournalArchive,
  destination: KnexSnapshotJournalDataDestination,
  checkpoint: SnapshotJournalDestinationCheckpoint
) {
  for (let ordinal = checkpoint.sequence; ordinal < archive.frameCount; ordinal++) {
    const stream = snapshotJournalDestinationStreams[checkpoint.streamIndex],
      expected = checkpoint
    const frame = await archive.readFrame(ordinal, async (digest, index, identities) => {
      const prefix = encodeSnapshotJournalArchiveIdentities(
        stream,
        digest,
        index,
        identities,
        destination.binding.receipt.highWater
      )
      expect(await destination.stagePacket(expected, prefix)).toEqual(expected)
    })
    expect(frame.stream).toBe(stream.stream)
    expect(frame.tableId).toBe(stream.tableId)
    checkpoint = await destination.stagePacket(expected, encodeSnapshotJournalArchiveFrame(stream, frame.page))
  }
  const deadline = performance.now() + 10000
  while (checkpoint.phase !== 'acknowledged') {
    if (performance.now() >= deadline)
      throw new Error('Actual semantic promotion did not finish inside fixture deadline')
    checkpoint = (await destination.promote(checkpoint)).checkpoint
  }
  return checkpoint
}

test('actual HTTP artifact feeds a target-owned receiver, survives replacement, and promotes incremental tombstones without primary activation', async () => {
  const f = await fixture()
  let archive: RemoteSnapshotJournalArchive | undefined
  try {
    const user = (await f.source.storage.findOrInsertUser(f.source.identityKey)).user
    const original = await f.source.storage.findOrInsertTxLabel(user.userId, 'DATA original label')
    archive = await f.client.openSnapshotJournalArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual journal artifact unavailable')
    const first = await KnexSnapshotJournalDataDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    const checkpoint = await copy(archive, first.destination, first.checkpoint)
    expect(checkpoint.phase).toBe('acknowledged')
    expect(await f.target.findTxLabels({ partial: { label: 'DATA original label' } })).toHaveLength(1)
    const recovered = await KnexSnapshotJournalDataDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    expect((await recovered.destination.status()).checkpoint).toEqual(checkpoint)
    const replacement = await KnexSnapshotJournalDataDestination.resume(
      f.target,
      f.source.identityKey,
      archive.manifest.binding.sourceStorage.storageIdentityKey,
      journalCopyLimits(),
      f.admission
    )
    if (replacement === undefined) throw new Error('Actual durable receiver missing after replacement')
    expect((await replacement.status()).checkpoint).toEqual(checkpoint)

    const previous = archive.manifest.binding.journal.receipt
    await archive.close()
    await f.source.storage.knex('tx_labels').where('txLabelId', original.txLabelId).delete()
    await f.source.storage.findOrInsertTxLabel(user.userId, 'DATA next label')
    archive = await f.client.openSnapshotJournalArchive(f.source.identityKey, {
      binding: previous.binding,
      highWater: previous.highWater
    })
    if (archive === undefined) throw new Error('Actual incremental artifact unavailable')
    const next = await KnexSnapshotJournalDataDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    expect(next.destination.binding.bootstrap).toBeUndefined()
    expect(next.destination.binding.low).toBe(previous.highWater)
    expect((await copy(archive, next.destination, next.checkpoint)).phase).toBe('acknowledged')
    expect(await f.target.findTxLabels({ partial: { label: 'DATA next label' } })).toHaveLength(1)
    expect(
      await f.target.knex('snapshot_reconciliation_identity_maps').where({ incomingId: original.txLabelId, tableId: 3 })
    ).toHaveLength(0)
    expect((await f.target.findOrInsertUser(f.source.identityKey)).user.activeStorage).toBe('journal-data-target')
  } finally {
    await archive?.close()
    await f.close()
  }
})

test('DATA receiver refuses foreign identity and a changed current primary before accepting a frame', async () => {
  const f = await fixture()
  let archive: RemoteSnapshotJournalArchive | undefined
  try {
    archive = await f.client.openSnapshotJournalArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual journal artifact unavailable')
    await expect(
      KnexSnapshotJournalDataDestination.begin(
        f.target,
        '02' + '33'.repeat(32),
        archive.manifest.binding,
        journalCopyLimits(),
        f.admission
      )
    ).rejects.toThrow('authentication')
    expect(await f.target.knex('snapshot_reconciliation_windows')).toHaveLength(0)
    const begun = await KnexSnapshotJournalDataDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    const frame = await archive.readFrame(0, async () => {
      await f.target.knex('users').first()
    })
    const { user } = await f.target.findOrInsertUser(f.source.identityKey)
    await f.target.updateUser(user.userId, { activeStorage: 'changed-primary' })
    await expect(
      begun.destination.stagePacket(
        begun.checkpoint,
        encodeSnapshotJournalArchiveFrame(snapshotJournalDestinationStreams[0], frame.page)
      )
    ).rejects.toThrow()
    expect((await begun.destination.status()).checkpoint).toEqual(begun.checkpoint)
    expect(await f.target.knex('snapshot_reconciliation_stage_pages')).toHaveLength(0)
  } finally {
    await archive?.close()
    await f.close()
  }
})

test('DATA receiver rejects a freshly rehashed cross-profile row before advancing its ACK', async () => {
  const f = await fixture()
  let archive: RemoteSnapshotJournalArchive | undefined
  try {
    const user = (await f.source.storage.findOrInsertUser(f.source.identityKey)).user
    await f.source.storage.findOrInsertTxLabel(user.userId, 'profile-bound DATA')
    archive = await f.client.openSnapshotJournalArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual journal artifact unavailable')
    const begun = await KnexSnapshotJournalDataDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    let expected = begun.checkpoint
    for (let ordinal = 0; ordinal < archive.frameCount; ordinal++) {
      const stream = snapshotJournalDestinationStreams[expected.streamIndex]
      const frame = await archive.readFrame(ordinal, async (digest, index, identities) => {
        await begun.destination.stagePacket(
          expected,
          encodeSnapshotJournalArchiveIdentities(
            stream,
            digest,
            index,
            identities,
            begun.destination.binding.receipt.highWater
          )
        )
      })
      if (stream.stream === 'scope' && stream.tableId === 3) {
        expect(frame.page.changes.some(change => change.present && change.row.label === 'profile-bound DATA')).toBe(
          true
        )
        const forged = {
          ...frame.page,
          changes: frame.page.changes.map(change =>
            change.present ? { ...change, row: { ...change.row, userId: user.userId + 100 } } : change
          )
        }
        await expect(
          begun.destination.stagePacket(expected, encodeSnapshotJournalArchiveFrame(stream, forged))
        ).rejects.toThrow('different source profile')
        expect((await begun.destination.status()).checkpoint).toEqual(expected)
        expect(await f.target.knex('tx_labels')).toHaveLength(0)
        return
      }
      expected = await begun.destination.stagePacket(expected, encodeSnapshotJournalArchiveFrame(stream, frame.page))
    }
    throw new Error('Actual profile-bound frame was not visited')
  } finally {
    await archive?.close()
    await f.close()
  }
})

test('DATA receiver runs the real RPC proof policy before acknowledging an invalid original proof frame', async () => {
  const f = await fixture(true)
  let archive: RemoteSnapshotJournalArchive | undefined
  const validate = jest.spyOn(RpcProofs, 'validateSyncProofs')
  try {
    archive = await f.client.openSnapshotJournalArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual journal artifact unavailable')
    const begun = await KnexSnapshotJournalDataDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    let expected = begun.checkpoint
    for (let ordinal = 0; ordinal < archive.frameCount; ordinal++) {
      const stream = snapshotJournalDestinationStreams[expected.streamIndex]
      const frame = await archive.readFrame(ordinal, async (digest, index, identities) => {
        await begun.destination.stagePacket(
          expected,
          encodeSnapshotJournalArchiveIdentities(
            stream,
            digest,
            index,
            identities,
            begun.destination.binding.receipt.highWater
          )
        )
      })
      const packet = encodeSnapshotJournalArchiveFrame(stream, frame.page)
      if (stream.tableId === 8 && frame.page.changes.some(change => change.present)) {
        await expect(begun.destination.stagePacket(expected, packet)).rejects.toThrow()
        expect(validate).toHaveBeenCalledTimes(1)
        expect((await begun.destination.status()).checkpoint).toEqual(expected)
        expect(await f.target.knex('proven_txs')).toHaveLength(0)
        return
      }
      expected = await begun.destination.stagePacket(expected, packet)
    }
    throw new Error('Actual invalid fixture proof was not visited')
  } finally {
    validate.mockRestore()
    await archive?.close()
    await f.close()
  }
})

test('an actual owned field window cannot resume or bootstrap through the original row DATA receiver', async () => {
  const f = await fixture()
  let archive: RemoteSnapshotJournalArchive | undefined
  try {
    archive = await f.client.openSnapshotJournalArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual authenticated source unavailable')
    const original = await KnexSnapshotJournalDataDestination.begin(
        f.target,
        f.source.identityKey,
        archive.manifest.binding,
        journalCopyLimits(),
        f.admission
      ),
      fieldBinding = { ...original.destination.binding, fieldEncoding: 'wallet-journal-fields/1' as const }
    const fieldCheckpoint = await f.admission(
      async () =>
        await f.target.runSnapshotJournalWriter(async trx => {
          await retireSnapshotJournalDestinationWindow(trx, original.destination.binding, original.checkpoint)
          while (
            !(await cleanupSnapshotJournalWindowCustody(trx, original.destination.binding, original.checkpoint))
              .complete
          ) {
            // Each iteration performs actual bounded SQL custody cleanup.
          }
          return await replaceSnapshotJournalDestinationWindow(
            trx,
            original.destination.binding,
            original.checkpoint,
            fieldBinding,
            'ed'.repeat(32),
            async actual =>
              await requireSnapshotJournalWindowClean(actual, original.destination.binding, original.checkpoint)
          )
        })
    )
    const before = await f.target.knex('snapshot_reconciliation_windows').first()
    expect(JSON.parse(before.bindingJson).fieldEncoding).toBe('wallet-journal-fields/1')
    expect(fieldCheckpoint.phase).toBe('intake')
    await expect(
      KnexSnapshotJournalDataDestination.resume(
        f.target,
        f.source.identityKey,
        archive.manifest.binding.sourceStorage.storageIdentityKey,
        journalCopyLimits(),
        f.admission
      )
    ).rejects.toThrow('actual admitted window')
    await expect(
      KnexSnapshotJournalDataDestination.begin(
        f.target,
        f.source.identityKey,
        archive.manifest.binding,
        journalCopyLimits(),
        f.admission
      )
    ).rejects.toThrow('actual admitted window')
    expect(await f.target.knex('snapshot_reconciliation_windows').first()).toEqual(before)
    expect(await f.target.knex('snapshot_sync_journal_data_receipts').where('complete', 1)).toHaveLength(0)
    expect((await f.target.findOrInsertUser(f.source.identityKey)).user.activeStorage).toBe('journal-data-target')
  } finally {
    await archive?.close()
    await f.close()
  }
})

test('authenticated field DATA and copied frames cannot enroll an ordinary SQL row window as a native financial action', async () => {
  const { prepareSnapshotJournalNativeActionMerge } = await import('./SnapshotJournalNativeActionMerge')
  const f = await fixture(true)
  let archive: RemoteSnapshotJournalArchive | undefined, fields: RemoteSnapshotJournalFieldArchive | undefined
  try {
    archive = await f.client.openSnapshotJournalArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual original row source unavailable')
    const old = await KnexSnapshotJournalDataDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    await archive.close()
    await archive.closed
    fields = await f.client.openSnapshotJournalFieldArchive(f.source.identityKey)
    if (fields === undefined) throw new Error('Actual authenticated field source unavailable')
    let admissions = 0
    const frame = await fields.readFrame(0, async () => {
        expect(await f.target.knex('users').where('identityKey', f.source.identityKey).first()).toBeDefined()
      }),
      page = frame.page,
      bytes = encodeSnapshotJournalFieldFrame(page, { stream: frame.stream, tableId: frame.tableId }),
      receipt = {
        sequence: 1,
        streamIndex: 0,
        tableId: frame.tableId,
        examined: page.examined,
        bytes: bytes.length,
        digest: frame.frameDigest
      },
      admission = async <T>(operation: () => Promise<T>): Promise<T> => {
        admissions++
        return await f.admission(operation)
      },
      before = await f.target.knex('snapshot_reconciliation_windows').first()
    expect(page.changes.some(change => change.present)).toBe(true)
    await expect(
      prepareSnapshotJournalNativeActionMerge(
        f.target,
        old.destination.binding,
        old.checkpoint,
        receipt,
        0,
        fields,
        structuredClone(frame),
        journalCopyLimits(),
        admission
      )
    ).rejects.toThrow('actual opened artifact')
    await expect(
      prepareSnapshotJournalNativeActionMerge(
        f.target,
        old.destination.binding,
        old.checkpoint,
        receipt,
        0,
        fields,
        frame,
        journalCopyLimits(),
        admission
      )
    ).rejects.toThrow('actual field/window/current ownership')
    expect(admissions).toBe(0)
    expect(await f.target.knex('snapshot_reconciliation_windows').first()).toEqual(before)
    expect(await f.target.knex('transactions')).toHaveLength(0)
    expect(await f.target.knex('outputs')).toHaveLength(0)
    expect(await f.target.knex('snapshot_sync_journal_data_receipts').where('complete', 1)).toHaveLength(0)
  } finally {
    await fields?.close()
    await archive?.close()
    await f.close()
  }
})

test('actual field intake retains large-field descriptors, resumes its own window, and refuses copied archive frames without a financial ACK', async () => {
  const { KnexSnapshotJournalFieldDestination } = await import('./KnexSnapshotJournalFieldDestination')
  const f = await fixture(true),
    bytes = Buffer.alloc(2097152, 107)
  let archive: RemoteSnapshotJournalFieldArchive | undefined
  try {
    await f.source.storage.knex('transactions').where('transactionId', 1).update({ rawTx: bytes })
    archive = await f.client.openSnapshotJournalFieldArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual authenticated field artifact unavailable')
    const begun = await KnexSnapshotJournalFieldDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    expect(begun.destination.binding.fieldEncoding).toBe('wallet-journal-fields/1')
    await expect(
      KnexSnapshotJournalDataDestination.resume(
        f.target,
        f.source.identityKey,
        archive.manifest.binding.sourceStorage.storageIdentityKey,
        journalCopyLimits(),
        f.admission
      )
    ).rejects.toThrow('actual admitted window')
    const actual = archive,
      copied = {
        ...archive,
        readFrame: async (...args: Parameters<typeof actual.readFrame>) =>
          structuredClone(await actual.readFrame(...args))
      }
    await expect(begun.destination.stageArchiveFrame(begun.checkpoint, copied)).rejects.toThrow(
      'actual opened artifact'
    )
    expect((await begun.destination.status()).checkpoint).toEqual(begun.checkpoint)
    expect(
      await f.target.knex('snapshot_reconciliation_captured_identities').where('sessionId', begun.checkpoint.sessionId)
    ).toHaveLength(0)
    const next = await begun.destination.stageArchiveFrame(begun.checkpoint, actual)
    expect(next.sequence).toBe(1)
    expect(next.phase).toBe('intake')
    const staged = await f.target
      .knex('snapshot_reconciliation_stage_pages')
      .where('sessionId', next.sessionId)
      .select('tableId', 'payload')
    expect(staged).toHaveLength(1)
    const page = decodeSnapshotJournalFieldFrame(new Uint8Array(staged[0].payload), { stream: 'scope', tableId: 0 }),
      selected = page.changes.find(change => change.present && change.metadata.id1 === 1)
    if (selected === undefined || !selected.present) throw new Error('Actual staged source transaction missing')
    expect(selected.fields.rawTx.bytes).toBe(bytes.length)
    expect(selected.row).not.toHaveProperty('rawTx')
    expect(staged[0].payload.length).toBeLessThan(262144)
    expect(await f.target.knex('transactions')).toHaveLength(0)
    expect(await f.target.knex('snapshot_sync_journal_data_receipts').where('complete', 1)).toHaveLength(0)
    const resumed = await KnexSnapshotJournalFieldDestination.resume(
      f.target,
      f.source.identityKey,
      actual.manifest.binding.sourceStorage.storageIdentityKey,
      journalCopyLimits(),
      f.admission
    )
    if (resumed === undefined) throw new Error('Actual durable field window unavailable')
    expect((await resumed.status()).checkpoint).toEqual(next)
    await actual.close()
    await actual.closed
    await expect(resumed.stageArchiveFrame(next, actual)).rejects.toThrow('actual admitted artifact/window')
    expect((await resumed.status()).checkpoint).toEqual(next)
  } finally {
    bytes.fill(0)
    await archive?.close()
    await f.close()
  }
})

test('actual field receiver commits complete semantic rows and recovers a lost final financial ACK without replaying the merge', async () => {
  const { KnexSnapshotJournalFieldDestination } = await import('./KnexSnapshotJournalFieldDestination')
  const f = await fixture()
  let archive: RemoteSnapshotJournalFieldArchive | undefined
  let dropReply = true
  let lost = false
  const admission = async <T>(operation: () => Promise<T>) =>
    await f.admission(async () => {
      const result = await operation()
      if (
        dropReply &&
        result !== null &&
        typeof result === 'object' &&
        Reflect.get(result, 'checkpoint') !== null &&
        typeof Reflect.get(result, 'checkpoint') === 'object' &&
        Reflect.get(Reflect.get(result, 'checkpoint') as object, 'phase') === 'acknowledged'
      ) {
        dropReply = false
        throw new Error('Independent field final reply lost after actual SQL commit')
      }
      return result
    })
  try {
    const incoming = await f.source.storage.findOrInsertTxLabel(
      (await f.source.storage.findOrInsertUser(f.source.identityKey)).user.userId,
      'field semantic label'
    )
    const local = await f.target.findOrInsertTxLabel(f.manager.getActiveUser().userId, 'retained local field label')
    archive = await f.client.openSnapshotJournalFieldArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual authenticated field artifact unavailable')
    const begun = await KnexSnapshotJournalFieldDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      admission
    )
    let state = begun.checkpoint
    for (let index = 0; index < archive.frameCount; index++)
      state = await begun.destination.stageArchiveFrame(state, archive)
    expect(state.phase).toBe('promoting')
    expect(await f.target.findTxLabels({ partial: { label: 'field semantic label' } })).toHaveLength(0)
    const deadline = performance.now() + 10000
    while (state.phase !== 'acknowledged') {
      if (performance.now() >= deadline)
        throw new Error('Actual field semantic promotion exceeded its original bounded fixture phase')
      try {
        state = (await begun.destination.promote(state, archive)).checkpoint
      } catch (cause) {
        if (!(cause instanceof Error) || cause.message !== 'Independent field final reply lost after actual SQL commit')
          throw cause
        lost = true
        break
      }
    }
    expect(lost).toBe(true)
    const restored = await KnexSnapshotJournalFieldDestination.resume(
      f.target,
      f.source.identityKey,
      archive.manifest.binding.sourceStorage.storageIdentityKey,
      journalCopyLimits(),
      admission
    )
    if (restored === undefined) throw new Error('Actual durable field receiver unavailable after lost reply')
    expect((await restored.status()).checkpoint.phase).toBe('acknowledged')
    const copied = await f.target.findTxLabels({ partial: { label: 'field semantic label' } })
    expect(copied).toHaveLength(1)
    expect(copied[0].txLabelId).not.toBe(incoming.txLabelId)
    expect(await f.target.findTxLabels({ partial: { txLabelId: local.txLabelId } })).toHaveLength(1)
    const mappings = await f.target
      .knex('snapshot_reconciliation_identity_maps')
      .where({ incomingId: incoming.txLabelId, tableId: 3 })
    expect(mappings).toHaveLength(1)
    expect(mappings[0].localId).toBe(copied[0].txLabelId)
    expect(await f.target.knex('snapshot_sync_journal_data_receipts').where('complete', 1)).toHaveLength(1)
    expect((await f.target.findOrInsertUser(f.source.identityKey)).user.activeStorage).toBe('journal-data-target')
  } finally {
    await archive?.close()
    await f.close()
  }
})

test('actual field promotion refuses changed captured identity DATA and resumes after exact restoration', async () => {
  const { KnexSnapshotJournalFieldDestination } = await import('./KnexSnapshotJournalFieldDestination')
  const f = await fixture()
  let archive: RemoteSnapshotJournalFieldArchive | undefined
  try {
    const label = await f.source.storage.findOrInsertTxLabel(
      (await f.source.storage.findOrInsertUser(f.source.identityKey)).user.userId,
      'authenticated field identity'
    )
    archive = await f.client.openSnapshotJournalFieldArchive(f.source.identityKey)
    if (archive === undefined) throw new Error('Actual authenticated identity fixture unavailable')
    const begun = await KnexSnapshotJournalFieldDestination.begin(
      f.target,
      f.source.identityKey,
      archive.manifest.binding,
      journalCopyLimits(),
      f.admission
    )
    let state = begun.checkpoint
    for (let ordinal = 0; ordinal < archive.frameCount; ordinal++)
      state = await begun.destination.stageArchiveFrame(state, archive)
    const key = { sessionId: state.sessionId, tableId: 3, incomingId: label.txLabelId },
      captured = await f.target.knex('snapshot_reconciliation_captured_identities').where(key).select('naturalIdentity')
    expect(captured).toHaveLength(1)
    const original = captured[0].naturalIdentity
    await f.target
      .knex('snapshot_reconciliation_captured_identities')
      .where(key)
      .update({ naturalIdentity: original === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64) })
    let refused = false
    const deadline = performance.now() + 10000
    while (!refused && state.phase !== 'acknowledged') {
      if (performance.now() >= deadline) throw new Error('Actual identity refusal exceeded its bounded fixture phase')
      try {
        state = (await begun.destination.promote(state, archive)).checkpoint
      } catch (cause) {
        expect(cause).toBeInstanceOf(Error)
        expect((cause as Error).message).toContain('captured journal identity')
        refused = true
      }
    }
    expect(refused).toBe(true)
    expect((await begun.destination.status()).checkpoint).toEqual(state)
    expect(await f.target.findTxLabels({ partial: { label: 'authenticated field identity' } })).toHaveLength(0)
    expect(await f.target.knex('snapshot_sync_journal_data_receipts').where('complete', 1)).toHaveLength(0)
    await f.target.knex('snapshot_reconciliation_captured_identities').where(key).update({ naturalIdentity: original })
    while (state.phase !== 'acknowledged') {
      if (performance.now() >= deadline)
        throw new Error('Actual restored field promotion exceeded its bounded fixture phase')
      state = (await begun.destination.promote(state, archive)).checkpoint
    }
    expect(await f.target.findTxLabels({ partial: { label: 'authenticated field identity' } })).toHaveLength(1)
    expect((await begun.destination.status()).checkpoint).toEqual(state)
  } finally {
    await archive?.close()
    await f.close()
  }
})
