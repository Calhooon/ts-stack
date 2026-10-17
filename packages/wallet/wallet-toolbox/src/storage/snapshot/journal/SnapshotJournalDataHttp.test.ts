import { snapshotJournalRevision } from './SnapshotJournalRevision'
import type { SnapshotJournalSourceIdentity } from './SnapshotJournalTypes'
import { StorageClient } from '../../remoting/StorageClient'
import { StorageClient as StorageMobile } from '../../remoting/StorageMobile'
import { snapshotHttpFixture } from '../../../../test/utils/snapshotArchiveHttpFixtures'
import { runSnapshotJournalArchiveReconciliation } from './runSnapshotJournalArchiveReconciliation'
import type { RemoteSnapshotJournalArchive } from './openRemoteSnapshotJournalArchive'
import type { SnapshotJournalReconciliationProgress } from './runSnapshotJournalReconciliation'
import type { KnexRemoteSnapshotSyncRpc } from '../KnexRemoteSnapshotSyncRpc'
import { snapshotJournalDataCapabilities } from './SnapshotJournalDataProtocol'
import { SnapshotArchiveTransportFailure } from '../archive/SnapshotArchiveTransportFailure'
import {
  encodeSnapshotJournalArchiveFrame,
  encodeSnapshotJournalArchiveIdentities
} from './SnapshotJournalArchivePacket'

async function endpoints() {
  const source = await snapshotHttpFixture(true, false),
    target = await snapshotHttpFixture(true, false, 'test', 'http-journal-target')
  const { user } = await target.storage.findOrInsertUser(source.identityKey)
  await target.storage.updateUser(user.userId, { activeStorage: 'http-journal-target' })
  const close = async () => {
    const results = await Promise.allSettled([source.close(), target.close()])
    const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
    if (errors.length) throw new AggregateError(errors, 'Real journal DATA HTTP endpoint cleanup failed')
  }
  return { source, target, close }
}
afterEach(() => jest.restoreAllMocks())

// Two real roots and many authenticated round trips per case. This finite
// orchestration bound is separate from unchanged30s runtime I/O/performance gates.
const twoEndpointCaseMs = 90000

test.each([StorageClient, StorageMobile])(
  'authenticated %p streams every journal frame into another actual endpoint and recovers the completed window after controller replacement',
  async Client => {
    const f = await endpoints()
    let archive: RemoteSnapshotJournalArchive | undefined
    try {
      const sourceUser = (await f.source.storage.findOrInsertUser(f.source.identityKey)).user
      await f.source.storage.findOrInsertTxLabel(sourceUser.userId, 'two endpoint journal label')
      const sourceServer = await f.source.serve(),
        targetServer = await f.target.serve()
      const from = new Client(f.source.wallet, sourceServer.url, { serverIdentityKey: f.source.serverIdentityKey })
      const to = new Client(f.source.wallet, targetServer.url, { serverIdentityKey: f.target.serverIdentityKey })
      expect((await to.makeAvailable()).snapshotJournalData).toEqual(snapshotJournalDataCapabilities)
      archive = await from.openSnapshotJournalArchive(f.source.identityKey)
      if (archive === undefined) throw new Error('Actual HTTP source artifact unavailable')
      const sourceBinding = archive.manifest.binding
      const destination = await to.openSnapshotJournalDataDestination(f.source.identityKey, sourceBinding)
      if (destination === undefined) throw new Error('Actual HTTP DATA target unavailable')
      let last: SnapshotJournalReconciliationProgress | undefined
      for await (const progress of runSnapshotJournalArchiveReconciliation(archive, async () => destination))
        last = progress
      expect(last?.state).toBe('complete')
      expect(last?.checkpoint.phase).toBe('acknowledged')
      expect(last?.progress.pages).toBe(archive.frameCount)
      const user = (await f.target.storage.findOrInsertUser(f.source.identityKey)).user
      expect(
        await f.target.storage.findTxLabels({ partial: { userId: user.userId, label: 'two endpoint journal label' } })
      ).toHaveLength(1)
      expect(user.activeStorage).toBe('http-journal-target')
      expect(archive.isOpen).toBe(false)
      await archive.closed
      expect(await f.source.storage.knex('snapshot_archive_capacity').first()).toMatchObject({
        archives: 0,
        reservedBytes: 0
      })
      expect(await f.target.storage.knex('sync_transfers').whereNotNull('transferId')).toHaveLength(0)
      const vacant = await f.target.storage.knex('sync_transfers').whereNot('slot', 0).orderBy('slot')
      expect(vacant).toHaveLength(8)
      expect(
        vacant.map(row => ({
          slot: row.slot,
          transferId: row.transferId,
          identityKey: row.identityKey,
          state: row.state,
          expiresAt: row.expiresAt,
          receivedBytes: row.receivedBytes
        }))
      ).toEqual(
        Array.from({ length: 8 }, (_, index) => ({
          slot: index + 1,
          transferId: null,
          identityKey: null,
          state: null,
          expiresAt: 0,
          receivedBytes: 0
        }))
      )
      const before = await destination.status()
      await targetServer.server.close()
      const replacementServer = await f.target.serve(),
        replacementClient = new Client(f.source.wallet, replacementServer.url, {
          serverIdentityKey: f.target.serverIdentityKey
        })
      const replacement = await replacementClient.openSnapshotJournalDataDestination(
        f.source.identityKey,
        sourceBinding
      )
      if (replacement === undefined) throw new Error('Replacement did not admit the actual stored target window')
      expect(await replacement.status()).toEqual(before)
      expect(
        await f.target.storage.findTxLabels({ partial: { userId: user.userId, label: 'two endpoint journal label' } })
      ).toHaveLength(1)
    } finally {
      await archive?.close()
      await f.close()
    }
  },
  twoEndpointCaseMs
)

test(
  'a lost actual frame ACK is recovered from destination SQL without recapture or duplicate logical rows',
  async () => {
    const f = await endpoints()
    let archive: RemoteSnapshotJournalArchive | undefined
    try {
      const sourceUser = (await f.source.storage.findOrInsertUser(f.source.identityKey)).user
      await f.source.storage.findOrInsertTxLabel(sourceUser.userId, 'lost frame ACK label')
      const fromServer = await f.source.serve(),
        targetServer = await f.target.serve()
      const from = new StorageClient(f.source.wallet, fromServer.url, { serverIdentityKey: f.source.serverIdentityKey })
      const to = new StorageClient(f.source.wallet, targetServer.url, { serverIdentityKey: f.target.serverIdentityKey })
      const capture = jest.spyOn(f.source.storage, 'openSnapshotSyncContentSource')
      archive = await from.openSnapshotJournalArchive(f.source.identityKey)
      if (archive === undefined) throw new Error('Actual HTTP artifact unavailable')
      const destination = await to.openSnapshotJournalDataDestination(f.source.identityKey, archive.manifest.binding)
      if (destination === undefined) throw new Error('Actual HTTP target unavailable')
      const rpc = Reflect.get(targetServer.server, 'remoteSnapshotSync') as KnexRemoteSnapshotSyncRpc,
        dispatch = rpc.dispatch.bind(rpc)
      let lost = false
      // The authenticated server really commits and observes its window first.
      // Discarding that response models an uncertain reply; it grants no ACK.
      jest.spyOn(rpc, 'dispatch').mockImplementation(async (method, params, identityKey) => {
        const result = await dispatch(method, params, identityKey)
        if (!lost && method === 'stageSnapshotJournalDataPacket') {
          lost = true
          throw new SnapshotArchiveTransportFailure(new Error('injected loss after actual frame ACK'))
        }
        return result
      })
      let last: SnapshotJournalReconciliationProgress | undefined
      for await (const progress of runSnapshotJournalArchiveReconciliation(archive, async () => destination))
        last = progress
      expect(lost).toBe(true)
      expect(last?.state).toBe('complete')
      expect(last?.checkpoint.phase).toBe('acknowledged')
      expect(await f.target.storage.findTxLabels({ partial: { label: 'lost frame ACK label' } })).toHaveLength(1)
      expect(capture).toHaveBeenCalledTimes(1)
      expect(await f.source.storage.knex('snapshot_archive_requests')).toHaveLength(0)
      expect(await f.source.storage.knex('snapshot_archive_owners')).toHaveLength(0)
      expect(await f.source.storage.knex('snapshot_archive_capacity').first()).toMatchObject({
        archives: 0,
        reservedBytes: 0
      })
    } finally {
      await archive?.close()
      await f.close()
    }
  },
  twoEndpointCaseMs
)

test(
  'DATA HTTP refuses foreign authentication and stale checkpoints before staging wallet data',
  async () => {
    const f = await endpoints()
    let archive: RemoteSnapshotJournalArchive | undefined
    try {
      const fromServer = await f.source.serve(),
        targetServer = await f.target.serve(),
        from = new StorageClient(f.source.wallet, fromServer.url, { serverIdentityKey: f.source.serverIdentityKey }),
        to = new StorageClient(f.source.wallet, targetServer.url, { serverIdentityKey: f.target.serverIdentityKey })
      archive = await from.openSnapshotJournalArchive(f.source.identityKey)
      if (archive === undefined) throw new Error('Actual artifact unavailable')
      const destination = await to.openSnapshotJournalDataDestination(f.source.identityKey, archive.manifest.binding)
      if (destination === undefined) throw new Error('Actual target unavailable')
      const before = await destination.status(),
        frame = await archive.readFrame(0, async () => {
          await f.target.storage.knex('users').first()
        })
      await expect(
        destination.stagePacket(
          { ...before.checkpoint, sequence: before.checkpoint.sequence + 1 },
          encodeSnapshotJournalArchiveFrame({ stream: 'scope', tableId: 0 }, frame.page)
        )
      ).rejects.toThrow('checkpoint')
      expect(await destination.status()).toEqual(before)
      expect(await f.target.storage.knex('snapshot_reconciliation_stage_pages')).toHaveLength(0)
      const rpc = Reflect.get(targetServer.server, 'remoteSnapshotSync') as KnexRemoteSnapshotSyncRpc
      await expect(
        rpc.dispatch(
          'beginSnapshotJournalData',
          [{ version: 1, identityKey: f.source.identityKey, source: archive.manifest.binding }],
          f.target.identityKey
        )
      ).rejects.toThrow()
      expect(await f.target.storage.knex('snapshot_reconciliation_windows')).toHaveLength(1)
    } finally {
      await archive?.close()
      await f.close()
    }
  },
  twoEndpointCaseMs
)

test(
  'multipart journal DATA prefix stays bounded, releases actual parts, and never advances a financial frame ACK',
  async () => {
    const f = await endpoints()
    let archive: RemoteSnapshotJournalArchive | undefined
    try {
      const fromServer = await f.source.serve(),
        targetServer = await f.target.serve()
      const from = new StorageClient(f.source.wallet, fromServer.url, {
          serverIdentityKey: f.source.serverIdentityKey
        }),
        to = new StorageClient(f.source.wallet, targetServer.url, { serverIdentityKey: f.target.serverIdentityKey })
      archive = await from.openSnapshotJournalArchive(f.source.identityKey)
      if (archive === undefined) throw new Error('Actual source artifact unavailable')
      const destination = await to.openSnapshotJournalDataDestination(f.source.identityKey, archive.manifest.binding)
      if (destination === undefined) throw new Error('Actual DATA target unavailable')
      const before = await destination.status(),
        identities = new Map<string, SnapshotJournalSourceIdentity>()
      // Adversarial bounded prefix DATA deliberately has no completing financial
      // frame. Authenticated staging must not mistake upload for a wallet ACK.
      for (let index = 1; index <= 80; index++)
        identities.set('2:' + index, {
          tableId: 2,
          incomingId: index,
          generation: snapshotJournalRevision('1'),
          revision: snapshotJournalRevision('1'),
          naturalIdentity: 'a'.repeat(64),
          required: false,
          naturalKey: { tableId: 2, serialNumber: '\u0000'.repeat(600) + index, certifier: '\u0000'.repeat(600) }
        })
      const packet = encodeSnapshotJournalArchiveIdentities(
        { stream: 'scope', tableId: 0 },
        'f'.repeat(64),
        0,
        identities,
        destination.binding.receipt.highWater
      )
      expect(packet.byteLength).toBeGreaterThan(snapshotJournalDataCapabilities.inlinePacketBytes)
      expect(packet.byteLength).toBeLessThanOrEqual(snapshotJournalDataCapabilities.maxPacketBytes)
      expect((await destination.stagePacket(before.checkpoint, packet)).checkpoint).toEqual(before.checkpoint)
      expect(await destination.status()).toEqual(before)
      expect(await f.target.storage.knex('snapshot_reconciliation_captured_identities')).toHaveLength(80)
      expect((await destination.stagePacket(before.checkpoint, packet)).checkpoint).toEqual(before.checkpoint)
      expect(await f.target.storage.knex('snapshot_reconciliation_captured_identities')).toHaveLength(80)
      expect(await f.target.storage.knex('snapshot_reconciliation_stage_pages')).toHaveLength(0)
      expect(await f.target.storage.knex('certificates')).toHaveLength(0)
      expect(await f.target.storage.knex('sync_transfer_parts')).toHaveLength(0)
      expect(await f.target.storage.knex('sync_transfers').whereNotNull('transferId')).toHaveLength(0)
    } finally {
      await archive?.close()
      await f.close()
    }
  },
  twoEndpointCaseMs
)
