import { KnexSnapshotArchiveStore } from '../archive/KnexSnapshotArchiveStore'
import { snapshotJournalDataManagerFixture as fixture } from '../../../../test/utils/snapshotJournalDataManagerFixture'
import { StorageClient } from '../../remoting/StorageClient'
import { StorageClient as StorageMobile } from '../../remoting/StorageMobile'
import { journalCopyLimits } from './SnapshotJournalCopyLimits'
import { snapshotJournalDataSourceBinding } from './snapshotJournalDataSourceBinding'
import { runSnapshotJournalSourceDataReconciliation } from './runSnapshotJournalSourceDataReconciliation'
import type { SnapshotJournalReconciliationSource } from './SnapshotJournalProvider'
import type { SnapshotJournalReconciliationProgress } from './runSnapshotJournalReconciliation'

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
        open = jest.spyOn(KnexSnapshotArchiveStore.prototype, 'beginJournal')
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
      expect(open).toHaveBeenCalledTimes(3)
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

test.each([StorageClient, StorageMobile])(
  'a genuine retained local source streams to the authenticated DATA endpoint without constructing a remote SQL fence',
  async Client => {
    const f = await fixture()
    let source: SnapshotJournalReconciliationSource | undefined
    try {
      const { user } = await f.storage.findOrInsertUser(f.remote.identityKey)
      await f.storage.findOrInsertTxLabel(user.userId, 'direct retained source DATA')
      const client = new Client(f.remote.wallet, f.served.url, { serverIdentityKey: f.remote.serverIdentityKey })
      source = await f.storage.openCurrentSnapshotJournalSource(f.remote.identityKey)
      const actual = source,
        binding = snapshotJournalDataSourceBinding(actual, undefined, false, await actual.readContentRevision?.())
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
      const previous = await client.getSnapshotJournalDataContentReceipt(f.remote.identityKey, 'local-journal-data')
      expect(previous?.checkpoint).toEqual(last?.checkpoint)
      const observed = await f.storage.observeSnapshotSyncContentRevision(f.remote.identityKey)
      if (observed === undefined) throw new Error('Actual source observation is required')
      expect(
        await client.confirmSnapshotJournalDataContentReceipt(f.remote.identityKey, 'local-journal-data', observed)
      ).toEqual({ ...previous, source: observed })
      await f.remote.storage.knex('tx_labels').where('label', 'direct retained source DATA').delete()
      expect(
        await client.confirmSnapshotJournalDataContentReceipt(f.remote.identityKey, 'local-journal-data', observed)
      ).toBeUndefined()
    } finally {
      await source?.close()
      await f.close()
    }
  },
  composedCaseMs
)
