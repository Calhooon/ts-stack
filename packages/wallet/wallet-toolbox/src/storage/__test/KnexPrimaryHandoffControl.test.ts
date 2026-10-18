import { knex } from 'knex'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StorageKnex } from '../StorageKnex'
import { StorageProvider } from '../StorageProvider'
import { canonicalPrimaryHandoffPlan } from '../KnexPrimaryHandoffControl'
import type { PrimaryHandoffPlan } from '../PrimaryHandoffControl'
import {
  PRIMARY_HANDOFF_TABLE,
  removePrimaryHandoffSchema,
  verifyPrimaryHandoffSchema
} from '../schema/primaryHandoffMigration'
import { Validation } from '@bsv/sdk'
import { _tu } from '../../../test/utils/TestUtilsWalletStorage'

const identityKey = '02' + '11'.repeat(32),
  operationId = 'ab'.repeat(16)
async function fixture(local = 'source') {
  const directory = await mkdtemp(join(tmpdir(), 'actual-primary-handoff-'))
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
    if (errors.length) throw new AggregateError(errors, 'Actual control roots did not drain')
  }
  try {
    await storage.migrate('actual primary control fixture', local)
    await storage.makeAvailable()
    await peer.makeAvailable()
    const { user } = await storage.findOrInsertUser(identityKey)
    const control = await storage.getPrimaryHandoffControl(),
      independent = await peer.getPrimaryHandoffControl()
    if (control == null || independent == null) throw new Error('Actual migrated SQL control unavailable')
    return { storage, peer, user, auth: { userId: user.userId, identityKey }, control, independent, close }
  } catch (error) {
    await close()
    throw error
  }
}
function plan(epoch = '0'): PrimaryHandoffPlan {
  return {
    version: 1,
    operationId,
    targetStorageIdentityKey: 'target',
    sources: [{ storageIdentityKey: 'source', epoch }]
  }
}

afterEach(() => jest.restoreAllMocks())

test('actual source retirement persists across independent controllers and fences old writes', async () => {
  const f = await fixture()
  try {
    expect(await f.control.status(f.auth)).toBeUndefined()
    await f.storage.updateUser(f.user.userId, { updated_at: new Date(0) })
    const old = await f.storage.activeWriteTransaction(f.auth)
    const prepared = await f.control.prepareSource(f.auth, operationId, 'target')
    expect(prepared).toEqual({ storageIdentityKey: 'source', epoch: '0' })
    await expect(old.assertCurrent()).resolves.toBeUndefined()
    expect(await f.independent.prepareSource(f.auth, operationId, 'target')).toEqual(prepared)
    const retired = await f.control.retireSource(f.auth, plan(prepared.epoch))
    expect(retired).toMatchObject({ side: 'source', phase: 'retired', localEpoch: '1', sourceEpoch: '0' })
    expect(await f.independent.status(f.auth)).toEqual(retired)
    expect(await f.independent.retireSource(f.auth, plan(prepared.epoch))).toEqual(retired)
    expect((await f.storage.findUsers({ partial: { userId: f.user.userId } }))[0].activeStorage).toBe('target')
    expect((await f.storage.findUsers({ partial: { userId: f.user.userId } }))[0].updated_at.getTime()).toBeGreaterThan(
      0
    )
    const apply = jest.fn(async () => {})
    await expect(old.transaction(apply)).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    expect(apply).not.toHaveBeenCalled()
    const row = await f.storage.knex(PRIMARY_HANDOFF_TABLE).first()
    expect([row.roleGateFrom, row.roleGateTo, row.roleGateEpoch]).toEqual([null, null, null])
    expect(await f.storage.knex('snapshot_sync_primary_epochs')).toEqual([{ userId: f.user.userId, epoch: 1 }])
  } finally {
    await f.close()
  }
})

test('target preparation parks a genuinely writable conflicting target and never activates it', async () => {
  const source = await fixture(),
    target = await fixture('target')
  try {
    const sourceWrite = await source.storage.activeWriteTransaction(source.auth)
    const targetWrite = await target.storage.activeWriteTransaction(target.auth)
    const prepared = await source.control.prepareSource(source.auth, operationId, 'target')
    const selected = plan(prepared.epoch)
    const parked = await target.control.prepareTarget(target.auth, selected)
    expect(parked).toMatchObject({ side: 'target', phase: 'prepared', localEpoch: '1', plan: selected })
    expect(await target.independent.prepareTarget(target.auth, selected)).toEqual(parked)
    await expect(targetWrite.transaction(async () => {})).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    await expect(sourceWrite.assertCurrent()).resolves.toBeUndefined()
    await source.control.retireSource(source.auth, selected)
    await expect(sourceWrite.assertCurrent()).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    await expect(target.storage.activeWriteTransaction(target.auth)).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    expect((await target.storage.findUsers({ partial: { userId: target.user.userId } }))[0].activeStorage).toBe(
      'source'
    )
  } finally {
    await Promise.all([source.close(), target.close()])
  }
})

test('competing operation IDs, targets and original epochs cannot overwrite pending actual intent', async () => {
  const f = await fixture()
  try {
    await f.control.prepareSource(f.auth, operationId, 'target')
    await expect(f.independent.prepareSource(f.auth, 'cd'.repeat(16), 'target')).rejects.toThrow('conflicts')
    await expect(f.independent.prepareSource(f.auth, operationId, 'different-target')).rejects.toThrow('conflicts')
    await expect(f.control.retireSource(f.auth, plan('1'))).rejects.toThrow('conflicts')
    expect((await f.control.status(f.auth))?.phase).toBe('prepared')
    await f.control.retireSource(f.auth, plan())
    await expect(f.control.prepareSource(f.auth, 'cd'.repeat(16), 'source')).rejects.toThrow()
    expect((await f.independent.status(f.auth))?.phase).toBe('retired')
  } finally {
    await f.close()
  }
})

test('actual database guards reject legacy DATA or control reactivation after enrollment', async () => {
  const f = await fixture()
  try {
    await f.control.prepareSource(f.auth, operationId, 'target')
    await expect(f.peer.updateUser(f.user.userId, { activeStorage: 'target' })).rejects.toThrow(
      'Coordinated primary control'
    )
    await f.control.retireSource(f.auth, plan())
    await expect(
      f.peer.knex('users').where({ userId: f.user.userId }).update({ activeStorage: 'source' })
    ).rejects.toThrow('Coordinated primary control')
    await expect(f.peer.setActive({ ...f.auth, isActive: true }, 'source')).rejects.toThrow(
      'Coordinated primary control'
    )
    expect((await f.independent.status(f.auth))?.phase).toBe('retired')
    // No-op replication of the actual selection remains compatible.
    await expect(f.peer.updateUser(f.user.userId, { activeStorage: 'target' })).resolves.toBe(1)
  } finally {
    await f.close()
  }
})

test('unenrolled profiles and unrelated users retain their original role-control behavior', async () => {
  const f = await fixture()
  try {
    await f.peer.setActive(f.auth, 'target')
    await f.peer.setActive(f.auth, 'source')
    const other = (await f.storage.findOrInsertUser('03' + '22'.repeat(32))).user
    await f.control.prepareSource(f.auth, operationId, 'target')
    await f.peer.setActive(other, 'different-primary')
    expect((await f.storage.findUsers({ partial: { userId: other.userId } }))[0].activeStorage).toBe(
      'different-primary'
    )
    await expect(f.control.status({ identityKey, userId: other.userId, isActive: true })).rejects.toMatchObject({
      code: 'WERR_UNAUTHORIZED'
    })
    await expect(
      f.control.prepareSource({ ...other, isActive: true }, 'cd'.repeat(16), 'target')
    ).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
  } finally {
    await f.close()
  }
})

test('missing or changed actual control triggers refuse both existing and fresh control handles', async () => {
  const f = await fixture()
  try {
    await f.storage.knex.raw('DROP TRIGGER wallet_primary_control_guard')
    await expect(f.control.prepareSource(f.auth, operationId, 'target')).rejects.toThrow('schema')
    await expect(f.peer.getPrimaryHandoffControl()).rejects.toThrow('schema')
    expect(await f.storage.knex(PRIMARY_HANDOFF_TABLE)).toEqual([])
  } finally {
    await f.close()
  }
})

test('control rollback preserves role, epoch and intent, and enrolled downgrade is refused', async () => {
  const f = await fixture()
  try {
    await f.control.prepareSource(f.auth, operationId, 'target')
    const stop = (query: { sql: string; bindings?: readonly unknown[] }) => {
      if (/^update [`"]wallet_primary_handoffs[`"]/.test(query.sql) && query.bindings?.includes('retired'))
        throw new Error('injected retirement rollback')
    }
    f.storage.knex.on('query', stop)
    try {
      await expect(f.control.retireSource(f.auth, plan())).rejects.toThrow('injected retirement rollback')
    } finally {
      f.storage.knex.removeListener('query', stop)
    }
    expect((await f.independent.status(f.auth))?.phase).toBe('prepared')
    expect((await f.storage.findUsers({ partial: { userId: f.user.userId } }))[0].activeStorage).toBe('source')
    expect(await f.storage.knex('snapshot_sync_primary_epochs')).toEqual([])
    await expect(removePrimaryHandoffSchema(f.storage.knex)).rejects.toThrow('forward recovery')
    await verifyPrimaryHandoffSchema(f.storage.knex)
    expect((await f.control.retireSource(f.auth, plan())).phase).toBe('retired')
  } finally {
    await f.close()
  }
})

test('bounded canonical plans reject DATA-shaped extra authority and malformed participant sets', () => {
  expect(canonicalPrimaryHandoffPlan(plan())).toEqual(plan())
  for (const bad of [
    { ...plan(), isActive: true },
    { ...plan(), sources: [] },
    { ...plan(), sources: Array(9).fill(plan().sources[0]) },
    { ...plan(), sources: [plan().sources[0], plan().sources[0]] },
    { ...plan(), operationId: 'x'.repeat(33) },
    plan('9223372036854775808')
  ])
    expect(() => canonicalPrimaryHandoffPlan(bad)).toThrow()
})

test('an actual createAction prepared before durable source retirement cannot publish ownership', async () => {
  const ctx = await _tu.createLegacyWalletSQLiteCopy('primary-handoff-real-create-race', 'legacy')
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
    await _tu.installOfflineLegacyChainTracker(ctx)
    const control = await ctx.activeStorage.getPrimaryHandoffControl()
    if (control == null) throw new Error('Actual SQL control unavailable')
    const auth = { identityKey: ctx.identityKey, userId: ctx.userId }
    const before = await ctx.activeStorage.knex('transactions').count({ n: '*' }).first()
    const available = ctx.activeStorage.findOutputBaskets.bind(ctx.activeStorage)
    jest.spyOn(ctx.activeStorage, 'findOutputBaskets').mockImplementationOnce(async (...args) => {
      const result = await available(...args)
      entered()
      await gate
      return result
    })
    pending = ctx.activeStorage.createAction(
      auth,
      Validation.validateCreateActionArgs({
        description: 'real primary retirement preparation race',
        outputs: [{ satoshis: 1, lockingScript: '51', outputDescription: 'retired output' }],
        options: { noSend: true }
      })
    )
    await Promise.race([
      reached,
      pending.then(() => {
        throw new Error('Actual createAction did not pause at preparation')
      })
    ])
    const source = await control.prepareSource(auth, operationId, 'target')
    await control.retireSource(auth, { ...plan(source.epoch), sources: [source] })
    release()
    await expect(pending).rejects.toMatchObject({ code: 'WERR_NOT_ACTIVE' })
    expect(await ctx.activeStorage.knex('transactions').count({ n: '*' }).first()).toEqual(before)
  } finally {
    release()
    await pending?.catch(() => undefined)
    await ctx.wallet.destroy()
  }
})

test('a mutable manager authentication object cannot change an admitted control identity', async () => {
  const f = await fixture()
  try {
    const other = (await f.storage.findOrInsertUser('03' + '22'.repeat(32))).user
    const mutable = { ...f.auth }
    const pending = f.control.prepareSource(mutable, operationId, 'target')
    mutable.userId = other.userId
    mutable.identityKey = other.identityKey
    await pending
    expect((await f.control.status(f.auth))?.phase).toBe('prepared')
    expect(await f.control.status(other)).toBeUndefined()
  } finally {
    await f.close()
  }
})

test('even empty control schema uses forward recovery rather than a racy MySQL-style downgrade', async () => {
  const f = await fixture()
  try {
    await expect(removePrimaryHandoffSchema(f.storage.knex)).rejects.toThrow('forward recovery')
    await verifyPrimaryHandoffSchema(f.storage.knex)
    expect(await f.control.status(f.auth)).toBeUndefined()
  } finally {
    await f.close()
  }
})
