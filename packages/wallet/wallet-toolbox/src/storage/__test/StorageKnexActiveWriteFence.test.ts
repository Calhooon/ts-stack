import { knex } from 'knex'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Validation } from '@bsv/sdk'
import { StorageKnex } from '../StorageKnex'
import { StorageProvider } from '../StorageProvider'
import { snapshotSyncPrimaryChangeSqlite } from '../schema/snapshotSyncMigration'
import type { TableCertificateX } from '../schema/tables/TableCertificate'
import type { TrxToken } from '../../sdk/WalletStorage.interfaces'
import { _tu } from '../../../test/utils/TestUtilsWalletStorage'

const identityKey = '02' + '11'.repeat(32)
const storageIdentity = 'active-write-source'
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'wallet-active-writer-'))
  const config = {
    client: 'better-sqlite3',
    connection: { filename: join(directory, 'wallet.sqlite') },
    useNullAsDefault: true,
    pool: { min: 0, max: 1 }
  }
  const storage = new StorageKnex({ ...StorageProvider.createStorageBaseOptions('test'), knex: knex(config) })
  const peer = new StorageKnex({ ...StorageProvider.createStorageBaseOptions('test'), knex: knex(config) })
  const close = async () => {
    const results = await Promise.allSettled([storage.destroy(), peer.destroy()])
    await rm(directory, { recursive: true, force: true })
    const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
    if (errors.length) throw new AggregateError(errors, 'Actual writer fixture failed to drain')
  }
  try {
    await storage.knex.raw('PRAGMA journal_mode=WAL')
    await storage.knex.raw('PRAGMA busy_timeout=0')
    await storage.migrate('actual writer fixture', storageIdentity)
    await storage.makeAvailable()
    await peer.makeAvailable()
    const { user } = await storage.findOrInsertUser(identityKey)
    const basket = (await storage.findOutputBaskets({ partial: { userId: user.userId, name: 'default' } }))[0]
    return { storage, peer, user, basket, auth: { identityKey, userId: user.userId }, close }
  } catch (error) {
    await close()
    throw error
  }
}

afterEach(() => jest.restoreAllMocks())

test('an actual SQL role capture retains no transaction during preparation and fences away-and-back', async () => {
  const f = await fixture()
  try {
    let begins = 0
    f.storage.knex.on('query', query => {
      if (/^begin\b/i.test(query.sql)) begins++
    })
    const old = await f.storage.activeWriteTransaction(f.auth)
    expect(begins).toBe(0)
    // A separate actual controller can complete its role changes before the
    // old operation reaches its SQL writer. No held connection blocks it.
    await f.peer.updateUser(f.user.userId, { activeStorage: 'other' })
    await f.peer.updateUser(f.user.userId, { activeStorage: storageIdentity })
    const apply = jest.fn(async () => {})
    await expect(old.transaction(apply)).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    expect(apply).not.toHaveBeenCalled()
    const current = await f.storage.activeWriteTransaction(f.auth)
    await current.transaction(
      async trx => await f.storage.updateOutputBasket(f.basket.basketId, { numberOfDesiredUTXOs: 7 }, trx)
    )
    expect(
      (await f.storage.findOutputBaskets({ partial: { basketId: f.basket.basketId } }))[0].numberOfDesiredUTXOs
    ).toBe(7)
    expect(begins).toBe(2) // One rejected writer and one successful writer.
  } finally {
    await f.close()
  }
})

test.each([false, true])('a role change within the actual writer rolls back every effect, ABA=%s', async aba => {
  const f = await fixture()
  try {
    const write = await f.storage.activeWriteTransaction(f.auth)
    await expect(
      write.transaction(async trx => {
        await f.storage.updateOutputBasket(f.basket.basketId, { numberOfDesiredUTXOs: 13 }, trx)
        await f.storage.updateUser(f.user.userId, { activeStorage: 'away' }, trx)
        if (aba) await f.storage.updateUser(f.user.userId, { activeStorage: storageIdentity }, trx)
      })
    ).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    expect(
      (await f.storage.findOutputBaskets({ partial: { basketId: f.basket.basketId } }))[0].numberOfDesiredUTXOs
    ).toBe(f.basket.numberOfDesiredUTXOs)
    expect((await f.storage.findUsers({ partial: { userId: f.user.userId } }))[0].activeStorage).toBe(storageIdentity)
    expect(await f.storage.knex('snapshot_sync_primary_epochs')).toEqual([])
  } finally {
    await f.close()
  }
})

test('only a live transaction issued by the same captured operation can be nested', async () => {
  const f = await fixture()
  try {
    const write = await f.storage.activeWriteTransaction(f.auth)
    let escaped: TrxToken | undefined
    await write.transaction(async trx => {
      escaped = trx
      await write.transaction(async nested => {
        expect(nested).toBe(trx)
        await f.storage.updateOutputBasket(f.basket.basketId, { numberOfDesiredUTXOs: 9 }, nested)
      }, trx)
    })
    await expect(write.transaction(async () => {}, escaped)).rejects.toMatchObject({ code: 'WERR_INVALID_OPERATION' })
    await expect(write.transaction(async () => {}, {})).rejects.toMatchObject({ code: 'WERR_INVALID_OPERATION' })
    await f.peer.transaction(async foreign => {
      await expect(write.transaction(async () => {}, foreign)).rejects.toMatchObject({ code: 'WERR_INVALID_OPERATION' })
    })
  } finally {
    await f.close()
  }
})

test('claimed active state or another user ID cannot grant a primary writer and other profiles stay independent', async () => {
  const f = await fixture()
  try {
    const other = (await f.storage.findOrInsertUser('03' + '22'.repeat(32))).user
    await expect(
      f.storage.activeWriteTransaction({ ...f.auth, userId: other.userId, isActive: true })
    ).rejects.toMatchObject({ code: 'WERR_UNAUTHORIZED' })
    const write = await f.storage.activeWriteTransaction(f.auth)
    await f.peer.updateUser(other.userId, { activeStorage: 'away' })
    await expect(write.assertCurrent()).resolves.toBeUndefined()
    await f.peer.updateUser(f.user.userId, { activeStorage: 'away' })
    await expect(f.storage.activeWriteTransaction({ ...f.auth, isActive: true })).rejects.toMatchObject({
      code: 'WERR_NOT_ACTIVE'
    })
  } finally {
    await f.close()
  }
})

test('a missing or changed actual epoch trigger rejects old and newly captured operations', async () => {
  const f = await fixture()
  try {
    const write = await f.storage.activeWriteTransaction(f.auth)
    await f.peer.knex.raw('DROP TRIGGER snapshot_sync_primary_change')
    await expect(write.transaction(async () => {})).rejects.toThrow('primary fence')
    await expect(f.storage.activeWriteTransaction(f.auth)).rejects.toThrow('primary fence')
    await f.peer.knex.raw('CREATE TRIGGER snapshot_sync_primary_change AFTER UPDATE ON users BEGIN SELECT 1; END')
    await expect(write.transaction(async () => {})).rejects.toThrow('primary fence')
    await f.peer.knex.raw('DROP TRIGGER snapshot_sync_primary_change')
    await f.peer.knex.raw(snapshotSyncPrimaryChangeSqlite)
    await expect(write.transaction(async () => {})).resolves.toBeUndefined()
  } finally {
    await f.close()
  }
})

test('actual certificate relinquishment rejects a role change after its asynchronous lookup', async () => {
  const f = await fixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let entered!: () => void
  const reached = new Promise<void>(resolve => {
    entered = resolve
  })
  let pending: Promise<number> | undefined
  try {
    const certificate: TableCertificateX = {
      certificateId: 0,
      userId: f.user.userId,
      created_at: new Date(),
      updated_at: new Date(),
      type: Buffer.alloc(32, 1).toString('base64'),
      serialNumber: Buffer.alloc(32, 2).toString('base64'),
      certifier: '03' + '33'.repeat(32),
      subject: identityKey,
      revocationOutpoint: '44'.repeat(32) + '.0',
      signature: '00',
      isDeleted: false
    }
    const id = await f.storage.insertCertificateAuth(f.auth, certificate)
    const read = f.storage.findCertificates.bind(f.storage)
    jest.spyOn(f.storage, 'findCertificates').mockImplementationOnce(async args => {
      const result = await read(args)
      entered()
      await gate
      return result
    })
    pending = f.storage.relinquishCertificate(f.auth, certificate)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    await reached
    await f.peer.updateUser(f.user.userId, { activeStorage: 'other-primary' })
    release()
    await rejected
    expect((await read({ partial: { certificateId: id } }))[0].isDeleted).toBe(false)
  } finally {
    release()
    await pending?.catch(() => undefined)
    await f.close()
  }
})

test('the real createAction rejects preparation from an obsolete ABA generation before claiming financial rows', async () => {
  const ctx = await _tu.createLegacyWalletSQLiteCopy('active-write-createAction-ABA', 'legacy')
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let entered!: () => void
  const reached = new Promise<void>(resolve => {
    entered = resolve
  })
  let pending: Promise<unknown> | undefined
  try {
    const before = await ctx.activeStorage.knex('transactions').count({ n: '*' }).first()
    const read = ctx.activeStorage.findOutputBaskets.bind(ctx.activeStorage)
    jest.spyOn(ctx.activeStorage, 'findOutputBaskets').mockImplementationOnce(async args => {
      const result = await read(args)
      entered()
      await gate
      return result
    })
    const args = Validation.validateCreateActionArgs({
      description: 'actual primary fence regression',
      outputs: [{ satoshis: 1, lockingScript: '51', outputDescription: 'fenced output' }],
      options: { noSend: true, randomizeOutputs: false, returnTXIDOnly: true }
    })
    pending = ctx.activeStorage.createAction({ identityKey: ctx.identityKey, userId: ctx.userId }, args)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    await reached
    const active = ctx.activeStorage.getSettings().storageIdentityKey
    await ctx.activeStorage.updateUser(ctx.userId, { activeStorage: 'other-primary' })
    await ctx.activeStorage.updateUser(ctx.userId, { activeStorage: active })
    release()
    await rejected
    expect(await ctx.activeStorage.knex('transactions').count({ n: '*' }).first()).toEqual(before)
  } finally {
    release()
    await pending?.catch(() => undefined)
    await ctx.wallet.destroy()
  }
})

test('the real internalizeAction rejects an ABA generation after proof preparation and before publishing ownership', async () => {
  const ctx = await _tu.createLegacyWalletSQLiteCopy('active-write-internalize-ABA', 'legacy')
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let entered!: () => void
  const reached = new Promise<void>(resolve => {
    entered = resolve
  })
  let pending: Promise<unknown> | undefined
  try {
    const created = await ctx.wallet.createAction({
      description: 'stage actual role fence input',
      outputs: [
        { satoshis: 741, lockingScript: '51', basket: 'original-role-basket', outputDescription: 'original ownership' }
      ],
      options: { noSend: true, randomizeOutputs: false }
    })
    expect(created.tx).toBeDefined()
    jest.spyOn(ctx.services, 'getChainTracker').mockImplementationOnce(async () => {
      entered()
      await gate
      return { isValidRootForHeight: async () => true, currentHeight: async () => 1_000_000 }
    })
    pending = ctx.activeStorage.internalizeAction(
      { identityKey: ctx.identityKey, userId: ctx.userId },
      {
        tx: created.tx!,
        description: 'reconcile same-basket ownership',
        labels: ['stale-role-label'],
        outputs: [
          { outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'original-role-basket' } }
        ]
      }
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    await reached
    const active = ctx.activeStorage.getSettings().storageIdentityKey
    await ctx.activeStorage.updateUser(ctx.userId, { activeStorage: 'other-primary' })
    await ctx.activeStorage.updateUser(ctx.userId, { activeStorage: active })
    release()
    await rejected
    expect(
      await ctx.activeStorage.findTxLabels({ partial: { userId: ctx.userId, label: 'stale-role-label' } })
    ).toEqual([])
    expect(
      await ctx.activeStorage.knex('internalize_receipts').where({ userId: ctx.userId, state: 'pending' })
    ).toEqual([])
  } finally {
    release()
    await pending?.catch(() => undefined)
    await ctx.wallet.destroy()
  }
})

test('provider destruction rejects captured writers before trying to acquire a closed connection', async () => {
  const f = await fixture()
  try {
    const write = await f.storage.activeWriteTransaction(f.auth)
    await f.storage.destroy()
    await expect(write.transaction(async () => {})).rejects.toMatchObject({ code: 'WERR_INVALID_OPERATION' })
    await expect(write.assertCurrent()).rejects.toMatchObject({ code: 'WERR_INVALID_OPERATION' })
  } finally {
    await f.close()
  }
})
