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

test.each([
  ['full', StorageClient],
  ['mobile', StorageMobile]
] as const)(
  'explicit field manager %s preserves real ACKs through migration, safe tombstones, unchanged copies and fenced recovery',
  async (_variant, Client) => {
    const f = await fixture()
    const controller = new AbortController(),
      deadline = setTimeout(() => controller.abort(new Error('Field manager phase expired')), 480000)
    try {
      const { user } = await f.remote.storage.findOrInsertUser(f.remote.identityKey),
        client = new Client(f.remote.wallet, f.served.url, { serverIdentityKey: f.remote.serverIdentityKey }),
        rowOpen = jest.spyOn(KnexSnapshotArchiveStore.prototype, 'beginJournal'),
        fieldOpen = jest.spyOn(KnexSnapshotArchiveStore.prototype, 'beginJournalFields'),
        legacy = jest.spyOn(f.storage, 'processSyncChunk'),
        options = { journalFields: true, snapshotLifetimeMs: 180000, signal: controller.signal }
      // Establish a genuine existing row ACK, then opt into field encoding.
      const localUser = (await f.storage.findOrInsertUser(f.remote.identityKey)).user
      await f.storage.findOrInsertTxLabel(localUser.userId, 'field manager local survivor')
      const localSource = await f.remote.storage.findOrInsertTxLabel(user.userId, 'field manager local survivor')
      const label = await f.remote.storage.findOrInsertTxLabel(user.userId, 'field manager old')
      expect(
        await f.manager.syncFromReaderResumable(f.remote.identityKey, client, { signal: controller.signal })
      ).toMatchObject({ status: 'completed', journalCheckpoint: { phase: 'acknowledged' } })
      const stamp = { created_at: new Date(), updated_at: new Date() },
        text = 'field manager 雪\u0000😀'.repeat(100),
        key = 'real-key-' + 'k'.repeat(300)
      await f.remote.storage.knex('certificates').insert({
        ...stamp,
        certificateId: 23,
        userId: user.userId,
        type: 'ordinary',
        serialNumber: 'field-manager-certificate',
        certifier: f.remote.identityKey,
        subject: f.remote.identityKey,
        revocationOutpoint: 'a'.repeat(64) + '.0',
        signature: 'ab'.repeat(64),
        isDeleted: 0
      })
      await f.remote.storage.knex('certificate_fields').insert({
        ...stamp,
        userId: user.userId,
        certificateId: 23,
        fieldName: 'independent 雪',
        fieldValue: text,
        masterKey: key
      })
      // Lose exactly one local reply after the real stage transaction commits.
      const open = f.storage.openSnapshotJournalFieldDestination.bind(f.storage)
      let lost = false
      jest.spyOn(f.storage, 'openSnapshotJournalFieldDestination').mockImplementation(async (...args) => {
        const destination = await open(...args),
          stage = destination.stageArchiveFrame.bind(destination)
        jest.spyOn(destination, 'stageArchiveFrame').mockImplementation(async (...input) => {
          const result = await stage(...input)
          if (!lost) {
            lost = true
            throw new Error('Injected reply loss after actual field stage commit')
          }
          return result
        })
        return destination
      })
      const cold = await f.manager.syncFromReaderResumable(f.remote.identityKey, client, options)
      expect(cold).toMatchObject({ status: 'completed', journalCheckpoint: { phase: 'acknowledged' } })
      expect(lost).toBe(true)
      const certificate = await f.storage
        .knex('certificates')
        .where('serialNumber', 'field-manager-certificate')
        .first()
      expect(
        await f.storage.knex('certificate_fields').where('certificateId', certificate.certificateId).first()
      ).toMatchObject({ fieldName: 'independent 雪', fieldValue: text, masterKey: key })
      expect(fieldOpen).toHaveBeenCalledTimes(1)
      expect(rowOpen).toHaveBeenCalledTimes(1)
      const unchanged = await f.manager.syncFromReaderResumable(f.remote.identityKey, client, options)
      expect(unchanged).toMatchObject({ status: 'completed', pages: 0, journalCheckpoint: cold.journalCheckpoint })
      expect(unchanged.noChangeJournalReceipt?.checkpoint).toEqual(cold.journalCheckpoint)
      expect(fieldOpen).toHaveBeenCalledTimes(1)
      await f.remote.storage.knex('tx_labels').where('txLabelId', label.txLabelId).delete()
      await f.remote.storage.knex('tx_labels').where('txLabelId', localSource.txLabelId).delete()
      await f.remote.storage.findOrInsertTxLabel(user.userId, 'field manager next')
      await f.remote.storage
        .knex('certificate_fields')
        .where('certificateId', 23)
        .update({ fieldValue: text + ' incremental', updated_at: new Date() })
      expect(await f.manager.syncFromReaderResumable(f.remote.identityKey, client, options)).toMatchObject({
        status: 'completed',
        journalCheckpoint: { phase: 'acknowledged' }
      })
      expect(await f.storage.findTxLabels({ partial: { label: 'field manager old' } })).toHaveLength(0)
      expect(await f.storage.findTxLabels({ partial: { label: 'field manager local survivor' } })).toHaveLength(1)
      expect(await f.storage.findTxLabels({ partial: { label: 'field manager next' } })).toHaveLength(1)
      expect(
        await f.storage.knex('certificate_fields').where('certificateId', certificate.certificateId).first()
      ).toMatchObject({ fieldValue: text + ' incremental', masterKey: key })
      expect(fieldOpen).toHaveBeenCalledTimes(2)
      // Actual primary epoch drift requires a fresh full source, even after an
      // away-and-back selection. It cannot restamp an empty incremental ACK.
      const beforeRepair = fieldOpen.mock.calls.length
      await f.storage.updateUser(localUser.userId, { activeStorage: 'away-primary' })
      await f.storage.updateUser(localUser.userId, { activeStorage: 'local-journal-data' })
      expect(await f.manager.syncFromReaderResumable(f.remote.identityKey, client, options)).toMatchObject({
        status: 'completed',
        journalCheckpoint: { phase: 'acknowledged' }
      })
      expect(fieldOpen.mock.calls.length - beforeRepair).toBeGreaterThanOrEqual(1)
      expect(fieldOpen.mock.calls.length - beforeRepair).toBeLessThanOrEqual(2)
      // A same-revision changed financial postimage is not silently adopted by
      // bootstrap. Preserve the original custody refusal and the actual bytes.
      await f.storage
        .knex('certificate_fields')
        .where('certificateId', certificate.certificateId)
        .update({ fieldValue: 'target drift' })
      await expect(f.manager.syncFromReaderResumable(f.remote.identityKey, client, options)).rejects.toThrow(
        'journal membership custody'
      )
      expect(
        await f.storage.knex('certificate_fields').where('certificateId', certificate.certificateId).first()
      ).toMatchObject({ fieldValue: 'target drift' })
      expect(await f.remote.storage.knex('snapshot_archive_owners')).toHaveLength(0)
      // A new actual source event supplies the newer financial update. Retry
      // retires the failed window and completes through a fresh genuine archive.
      await f.remote.storage
        .knex('certificate_fields')
        .where('certificateId', 23)
        .update({ fieldValue: text + ' recovered', updated_at: new Date(Date.now() + 1000) })
      const recovered = await f.manager.syncFromReaderResumable(f.remote.identityKey, client, options)
      expect(recovered).toMatchObject({
        status: 'completed',
        mode: 'paged',
        journalCheckpoint: { phase: 'acknowledged' }
      })
      expect(
        await f.storage.knex('certificate_fields').where('certificateId', certificate.certificateId).first()
      ).toMatchObject({ fieldValue: text + ' recovered', masterKey: key })
      expect(await f.storage.findTxLabels({ partial: { label: 'field manager local survivor' } })).toHaveLength(1)
      expect(rowOpen).toHaveBeenCalledTimes(1)
      expect(legacy).not.toHaveBeenCalled()
      expect((await f.storage.findOrInsertUser(f.remote.identityKey)).user.activeStorage).toBe('local-journal-data')
      expect(await f.remote.storage.knex('snapshot_archive_owners')).toHaveLength(0)
      expect(await f.remote.storage.knex('snapshot_archive_capacity').first()).toMatchObject({
        archives: 0,
        reservedBytes: 0
      })
    } finally {
      clearTimeout(deadline)
      await f.close()
    }
  },
  510000
)
