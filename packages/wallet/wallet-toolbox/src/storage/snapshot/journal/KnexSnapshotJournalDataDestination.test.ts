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
