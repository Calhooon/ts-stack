import { knex } from 'knex'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StorageKnex } from '../../StorageKnex'
import { StorageProvider } from '../../StorageProvider'
import { WalletStorageManager } from '../../WalletStorageManager'
import { StorageClient } from '../../remoting/StorageClient'
import { StorageClient as StorageMobile } from '../../remoting/StorageMobile'
import { snapshotHttpFixture } from '../../../../test/utils/snapshotArchiveHttpFixtures'
import { journalCopyLimits } from './SnapshotJournalCopyLimits'
import { snapshotJournalDataSourceBinding } from './snapshotJournalDataSourceBinding'
import { runSnapshotJournalSourceDataReconciliation } from './runSnapshotJournalSourceDataReconciliation'
import type { SnapshotJournalReconciliationSource } from './SnapshotJournalProvider'
import type { SnapshotJournalReconciliationProgress } from './runSnapshotJournalReconciliation'

async function fixture() {
  const remote = await snapshotHttpFixture(true, false, 'test', 'remote-journal-data'),
    directory = await mkdtemp(join(tmpdir(), 'manager-journal-data-'))
  const storage = new StorageKnex({
    ...StorageProvider.createStorageBaseOptions('test'),
    knex: knex({
      client: 'better-sqlite3',
      connection: { filename: join(directory, 'local.sqlite') },
      useNullAsDefault: true,
      pool: { min: 0, max: 1 }
    })
  })
  const close = async () => {
    const results = await Promise.allSettled([remote.close(), storage.destroy()])
    await rm(directory, { recursive: true, force: true })
    const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
    if (errors.length) throw new AggregateError(errors, 'Actual manager DATA fixture cleanup failed')
  }
  try {
    await storage.knex.raw('PRAGMA journal_mode=WAL')
    await storage.migrate('local journal DATA', 'local-journal-data')
    await storage.makeAvailable()
    await storage.findOrInsertUser(remote.identityKey)
    const manager = new WalletStorageManager(remote.identityKey, storage)
    await manager.makeAvailable()
    await manager.setActive('local-journal-data')
    const served = await remote.serve()
    return { remote, storage, manager, served, close }
  } catch (error) {
    await close()
    throw error
  }
}
afterEach(() => jest.restoreAllMocks())
const composedCaseMs = 90000

test.each([StorageClient, StorageMobile])(
  'ordinary %p pull uses acknowledged incremental journal DATA and repairs a changed target generation with one actual bootstrap',
  async Client => {
    const f = await fixture()
    try {
      const remoteUser = (await f.remote.storage.findOrInsertUser(f.remote.identityKey)).user
      const first = await f.remote.storage.findOrInsertTxLabel(remoteUser.userId, 'manager remote original')
      const client = new Client(f.remote.wallet, f.served.url, { serverIdentityKey: f.remote.serverIdentityKey })
      const legacy = jest.spyOn(f.storage, 'processSyncChunk'),
        open = jest.spyOn(f.remote.storage, 'openSnapshotSyncContentSource')
      const initial = await f.manager.syncFromReaderResumable(f.remote.identityKey, client)
      expect(initial).toMatchObject({
        status: 'completed',
        mode: 'paged',
        journalCheckpoint: { phase: 'acknowledged' }
      })
      expect(await f.storage.findTxLabels({ partial: { label: 'manager remote original' } })).toHaveLength(1)
      await f.remote.storage.knex('tx_labels').where('txLabelId', first.txLabelId).delete()
      await f.remote.storage.findOrInsertTxLabel(remoteUser.userId, 'manager remote next')
      expect(await f.manager.syncFromReaderResumable(f.remote.identityKey, client)).toMatchObject({
        status: 'completed',
        journalCheckpoint: { phase: 'acknowledged' }
      })
      expect(await f.storage.findTxLabels({ partial: { label: 'manager remote next' } })).toHaveLength(1)
      expect(legacy).not.toHaveBeenCalled()
      expect(open).toHaveBeenCalledTimes(2)
      const { user } = await f.storage.findOrInsertUser(f.remote.identityKey)
      // An away-and-back selection advances the real SQL epoch while the manager
      // still selects this same provider. Only a fresh full source can repair it.
      await f.storage.updateUser(user.userId, { activeStorage: 'away-primary' })
      await f.storage.updateUser(user.userId, { activeStorage: 'local-journal-data' })
      const repaired = await f.manager.syncFromReaderResumable(f.remote.identityKey, client)
      expect(repaired).toMatchObject({ status: 'completed', journalCheckpoint: { phase: 'acknowledged' } })
      expect(open).toHaveBeenCalledTimes(4)
      expect(await f.storage.findTxLabels({ partial: { label: 'manager remote next' } })).toHaveLength(1)
      expect((await f.storage.findOrInsertUser(f.remote.identityKey)).user.activeStorage).toBe('local-journal-data')
      expect(await f.remote.storage.knex('snapshot_archive_owners')).toHaveLength(0)
      expect(await f.remote.storage.knex('snapshot_archive_capacity').first()).toMatchObject({
        archives: 0,
        reservedBytes: 0
      })
    } finally {
      await f.close()
    }
  },
  composedCaseMs
)

test(
  'a genuine retained local source streams to the authenticated DATA endpoint without constructing a remote SQL fence',
  async () => {
    const f = await fixture()
    let source: SnapshotJournalReconciliationSource | undefined
    try {
      const { user } = await f.storage.findOrInsertUser(f.remote.identityKey)
      await f.storage.findOrInsertTxLabel(user.userId, 'direct retained source DATA')
      const client = new StorageClient(f.remote.wallet, f.served.url, { serverIdentityKey: f.remote.serverIdentityKey })
      source = await f.storage.openCurrentSnapshotJournalSource(f.remote.identityKey)
      const actual = source,
        binding = snapshotJournalDataSourceBinding(actual)
      const fence = jest.spyOn(actual, 'withCommitFence'),
        currentFence = jest.spyOn(actual, 'withCurrentDataFence')
      let last: SnapshotJournalReconciliationProgress | undefined
      for await (const progress of runSnapshotJournalSourceDataReconciliation(
        actual,
        binding,
        async () => {
          const destination = await client.openSnapshotJournalDataDestination(f.remote.identityKey, binding)
          if (destination === undefined) throw new Error('Actual DATA destination unavailable')
          return destination
        },
        journalCopyLimits()
      ))
        last = progress
      expect(last?.state).toBe('complete')
      expect(last?.checkpoint.phase).toBe('acknowledged')
      expect(await f.remote.storage.findTxLabels({ partial: { label: 'direct retained source DATA' } })).toHaveLength(1)
      expect(fence).not.toHaveBeenCalled()
      expect(currentFence).not.toHaveBeenCalled()
      expect(actual.isOpen).toBe(false)
      await actual.closed
    } finally {
      await source?.close()
      await f.close()
    }
  },
  composedCaseMs
)
