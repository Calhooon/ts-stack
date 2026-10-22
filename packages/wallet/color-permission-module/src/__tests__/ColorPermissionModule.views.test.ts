import { beforeEach, describe, expect, it } from '@jest/globals'
import { Beef, PrivateKey, Transaction, type ListOutputsResult } from '@bsv/sdk'
import { toHex } from '@bsv/sdk/primitives/utils'
import { OneColor } from '@bsv/templates'
import { ColorPermissionModule } from '../ColorPermissionModule.js'
import { assetBasket, assetTag } from '../identifiers.js'
import type { RequiredProfileHandler } from '../profiles.js'
import { ColorStore, type TxRecord } from '../store.js'
import type { ColorModuleStore } from '../types.js'
import { FakeProvider, FakeWallet, tokenPayment } from './fixtures.js'
import {
  A141A,
  C0,
  exampleProfile,
  FakeStore,
  fixtureDeploy,
  signAttestation,
  TestModule
} from './profileFixtures.js'

const APP = 'app.example'
const next = async (args: unknown): Promise<unknown> => args
const SIGNER = C0.SIGNER

async function listing(
  module: ColorPermissionModule,
  args: Record<string, unknown>
): Promise<ListOutputsResult> {
  return (await module.handleRequest(
    { method: 'listOutputs', originator: APP, args: { ...args } },
    next
  )) as ListOutputsResult
}

/** The `p color assets` listing with tags, keyed by outpoint. */
async function views(
  module: ColorPermissionModule,
  extra: Record<string, unknown> = {}
): Promise<Map<string, { spendable: boolean; tags?: string[] }>> {
  const result = await listing(module, { basket: 'p color assets', includeTags: true, ...extra })
  return new Map(result.outputs.map(output => [output.outpoint, output]))
}

async function balanceOf(
  module: ColorPermissionModule,
  assetId: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const result = await listing(module, {
    basket: `p color balance ${assetTag(assetId)}`,
    ...extra
  })
  expect(result.outputs).toEqual([])
  return String(result.totalOutputs)
}

describe('offline and restricted views', () => {
  let wallet: FakeWallet
  let provider: FakeProvider
  let store: FakeStore
  let colorStore: ColorStore
  let ex: RequiredProfileHandler
  let assetId: string
  let module: TestModule
  let t40: Transaction
  let t60: Transaction
  let t25: Transaction

  /** A held value output of the asset paying `amount`, with stored `tags`. */
  function hold(amount: bigint, tags?: string[]): Transaction {
    const tx = new Transaction()
    tx.addOutput({
      lockingScript: new OneColor().lock(assetId, amount, Array(20).fill(0x33)),
      satoshis: 1
    })
    wallet.store(
      tx,
      0,
      assetBasket(assetId, 'value'),
      JSON.stringify({ version: 1, assetId }),
      tags
    )
    return tx
  }

  const op = (tx: Transaction): string => `${tx.id('hex')}.0`

  beforeEach(async () => {
    wallet = new FakeWallet()
    provider = new FakeProvider()
    store = new FakeStore()
    colorStore = new ColorStore(store)
    ex = exampleProfile()
    const deploy = fixtureDeploy(A141A.C)
    assetId = deploy.assetId
    provider.admit(assetId, deploy.tx, 0)
    module = new TestModule({
      wallet: wallet.asWallet(),
      provider,
      requestTokenAccess: async () => true,
      profiles: { [ex.id]: ex },
      store
    })
    t40 = hold(40n)
    t60 = hold(60n, ['color_offline'])
    t25 = hold(25n)
    wallet.outputs.get(op(t25))!.reservedBy = 'reference-x'
    await colorStore.markSettled(t40.id('hex'), { outputs: [0], signer: SIGNER })
  })

  it('C40 an offline output is available with color_offline and counts in the balance', async () => {
    const listed = await views(module)
    expect(listed.get(op(t60))).toMatchObject({
      spendable: true,
      tags: ['color_offline', 'color_state_available']
    })
    expect(listed.get(op(t40))).toMatchObject({
      spendable: true,
      tags: ['color_state_available']
    })
    expect(listed.get(op(t25))).toMatchObject({
      spendable: false,
      tags: ['color_state_reserved']
    })
    await expect(
      listing(module, { basket: `p color balance ${assetTag(assetId)}` })
    ).resolves.toEqual({ totalOutputs: '100', outputs: [] })
  })

  it('C54 a settled record removes color_offline from views', async () => {
    await colorStore.markSettled(t60.id('hex'), { outputs: [0], signer: SIGNER })
    expect((await views(module)).get(op(t60))?.tags).toEqual(['color_state_available'])
  })

  it('C55 a refused record restricts the output and removes it from the balance', async () => {
    await colorStore.markRefused(t60.id('hex'), { code: 'ERR_REFUSED', description: 'refused' })
    const listed = await views(module)
    expect(listed.get(op(t60))?.tags).toContain('color_state_restricted')
    expect(listed.get(op(t60))?.spendable).toBe(false)
    expect(await balanceOf(module, assetId)).toBe('40')
    const candidates = await module.candidatesForTest(assetId, 'value', APP)
    expect(candidates.map(candidate => candidate.outpoint)).toEqual([op(t40)])
    // A restricted output is filtered on its state like any other.
    const restricted = await views(module, { tags: ['color_state_restricted'] })
    expect([...restricted.keys()]).toEqual([op(t60)])
  })

  it('store loss keeps the coin offline', async () => {
    await colorStore.markSettled(t60.id('hex'), { outputs: [0], signer: SIGNER })
    expect((await views(module)).get(op(t60))?.tags).not.toContain('color_offline')
    store.clear()
    expect((await views(module)).get(op(t60))?.tags).toContain('color_offline')
    expect(await balanceOf(module, assetId)).toBe('100')
  })

  it('a torn settled record keeps the coin offline', async () => {
    await store.set(`color.v1.settled.${t60.id('hex')}`, '{"outputs":[0],"sig')
    expect((await views(module)).get(op(t60))?.tags).toContain('color_offline')
  })

  it('tag filters and balances use the view color_offline tag', async () => {
    const offline = await views(module, { tags: ['color_offline'] })
    expect([...offline.keys()]).toEqual([op(t60)])
    expect(await balanceOf(module, assetId, { tags: ['color_offline'] })).toBe('60')
    await colorStore.markSettled(t60.id('hex'), { outputs: [0], signer: SIGNER })
    expect((await views(module, { tags: ['color_offline'] })).size).toBe(0)
    expect(await balanceOf(module, assetId, { tags: ['color_offline'] })).toBe('0')
    expect(
      await balanceOf(module, assetId, {
        tags: ['color_offline', 'color_state_available'],
        tagQueryMode: 'any'
      })
    ).toBe('100')
  })

  it('a tx record with a missing or mismatching atomicBEEF reads as absent', async () => {
    const txid = t60.id('hex')
    const atomicBEEF = toHex(beefOf(t60).toBinaryAtomic(txid))
    const attestation = await signAttestation(new PrivateKey(C0.PRIV), assetId, txid, [0])
    const valid: TxRecord = {
      v: 1,
      assetId,
      rawTx: t60.toHex(),
      atomicBEEF,
      role: 'receipt',
      state: 'staged',
      inputs: [`${'ab'.repeat(32)}.1`],
      outputs: [0],
      offChainValues: '',
      attestations: [attestation]
    }
    await colorStore.putTx(txid, { ...valid, atomicBEEF: '' })
    await expect(colorStore.getTx(txid)).resolves.toBeUndefined()
    const other = toHex(beefOf(t40).toBinaryAtomic(t40.id('hex')))
    await colorStore.putTx(txid, { ...valid, atomicBEEF: other })
    await expect(colorStore.getTx(txid)).resolves.toBeUndefined()
    await colorStore.putTx(txid, { ...valid, atomicBEEF: atomicBEEF.toUpperCase() })
    await expect(colorStore.getTx(txid)).resolves.toBeUndefined()
    await colorStore.putTx(txid, { ...valid, atomicBEEF: atomicBEEF.slice(0, -1) })
    await expect(colorStore.getTx(txid)).resolves.toBeUndefined()
    await store.set(`color.v1.tx.${txid}`, '{"v":1,')
    await expect(colorStore.getTx(txid)).resolves.toBeUndefined()
    await colorStore.putTx(txid, valid)
    const read = await colorStore.getTx(txid)
    expect(read).toEqual(valid)
    expect(read?.atomicBEEF).toBe(atomicBEEF)
    expect(
      Transaction.fromAtomicBEEF(Array.from(Buffer.from(read!.atomicBEEF, 'hex'))).id('hex')
    ).toBe(txid)
    await expect(colorStore.txids()).resolves.toEqual([txid])
  })

  it('views are unchanged without profiles', async () => {
    const untouchable: ColorModuleStore = {
      get: async () => {
        throw new Error('store read')
      },
      set: async () => {
        throw new Error('store write')
      },
      delete: async () => {
        throw new Error('store delete')
      },
      keys: async () => {
        throw new Error('store keys')
      }
    }
    const plainWallet = new FakeWallet()
    const sender = new FakeWallet()
    const plainAsset = `${'cd'.repeat(32)}_0`
    const { tx, customInstructions } = await tokenPayment(sender, plainWallet, plainAsset, 7n)
    plainWallet.store(tx, 0, assetBasket(plainAsset, 'value'), customInstructions, [
      'color_offline',
      'mine',
      'color_state_reserved'
    ])
    const plain = new ColorPermissionModule({
      wallet: plainWallet.asWallet(),
      provider,
      requestTokenAccess: async () => true,
      store: untouchable
    })
    await expect(listing(plain, { basket: 'p color assets', includeTags: true })).resolves.toEqual({
      totalOutputs: 1,
      outputs: [
        {
          outpoint: `${tx.id('hex')}.0`,
          satoshis: 1000,
          spendable: true,
          tags: ['color_offline', 'mine', 'color_state_available']
        }
      ]
    })
  })

  it("A.142 inventory omits an unsupported asset's outputs", async () => {
    const u = fixtureDeploy(A141A.U)
    provider.admit(u.assetId, u.tx, 0)
    wallet.store(u.tx, 0, assetBasket(u.assetId, 'value'), JSON.stringify({ version: 1 }))
    const successor = new Transaction()
    successor.addOutput({
      lockingScript: new OneColor().lock(u.assetId, 3n, Array(20).fill(0x44)),
      satoshis: 1
    })
    wallet.store(successor, 0, assetBasket(u.assetId, 'value'), JSON.stringify({ version: 1 }))
    const c = fixtureDeploy(A141A.C)
    wallet.store(c.tx, 0, assetBasket(c.assetId, 'value'), JSON.stringify({ version: 1 }))

    const first = await views(module)
    expect(first.has(op(u.tx))).toBe(false)
    expect(first.has(op(successor))).toBe(false)
    expect(first.has(op(c.tx))).toBe(true)
    expect([...first.keys()].sort()).toEqual([op(c.tx), op(t25), op(t40), op(t60)].sort())
    // U is resolved once in the listing (one admission for U, one for the supported asset).
    expect(provider.calls.admission).toBe(2)

    const admissions = provider.calls.admission
    const second = await views(module)
    expect(second.has(op(u.tx))).toBe(false)
    expect(provider.calls.admission).toBe(admissions)
  })
})

describe('ColorStore records', () => {
  let store: FakeStore
  let colorStore: ColorStore
  const T1 = '11'.repeat(32)
  const T2 = '22'.repeat(32)

  beforeEach(() => {
    store = new FakeStore()
    colorStore = new ColorStore(store)
  })

  it('round-trips settled and refused records under color.v1.', async () => {
    await expect(colorStore.settled(T1)).resolves.toBeUndefined()
    await colorStore.markSettled(T1, { outputs: [0, 2], signer: SIGNER })
    await colorStore.markRefused(T2, { code: 'ERR_REFUSED', description: 'no' })
    await expect(colorStore.settled(T1)).resolves.toEqual({ outputs: [0, 2], signer: SIGNER })
    await expect(colorStore.refused(T2)).resolves.toEqual({
      code: 'ERR_REFUSED',
      description: 'no'
    })
    await expect(colorStore.refused(T1)).resolves.toBeUndefined()
    expect([...(await colorStore.settledSet())]).toEqual([T1])
    expect([...(await colorStore.refusedSet())]).toEqual([T2])
    expect(store.writes).toEqual([`color.v1.settled.${T1}`, `color.v1.refused.${T2}`])
  })

  it('reads malformed settled and refused records as absent', async () => {
    await store.set(`color.v1.settled.${T1}`, 'not json')
    await store.set(`color.v1.settled.${T2}`, JSON.stringify({ outputs: [-1], signer: SIGNER }))
    await store.set(`color.v1.refused.${T1}`, JSON.stringify({ code: 7, description: 'x' }))
    await store.set('color.v1.settled.not-a-txid', JSON.stringify({ outputs: [0], signer: SIGNER }))
    await expect(colorStore.settled(T1)).resolves.toBeUndefined()
    await expect(colorStore.settled(T2)).resolves.toBeUndefined()
    await expect(colorStore.refused(T1)).resolves.toBeUndefined()
    expect((await colorStore.settledSet()).size).toBe(0)
    expect((await colorStore.refusedSet()).size).toBe(0)
  })

  it('keeps intent and unsent sets', async () => {
    await colorStore.addIntent(T2)
    await colorStore.addIntent(T1)
    await colorStore.addIntent(T1)
    await colorStore.addUnsent(T1)
    await expect(colorStore.intents()).resolves.toEqual([T1, T2])
    await expect(colorStore.unsent()).resolves.toEqual([T1])
    await colorStore.removeIntent(T1)
    await colorStore.removeUnsent(T1)
    await expect(colorStore.intents()).resolves.toEqual([T2])
    await expect(colorStore.unsent()).resolves.toEqual([])
    expect(store.writes.every(key => key.startsWith('color.v1.'))).toBe(true)
  })

  it('refuses a key for anything but a txid', async () => {
    await expect(colorStore.getTx('xyz')).rejects.toThrow(TypeError)
    await expect(
      colorStore.markSettled('AB'.repeat(32), { outputs: [0], signer: SIGNER })
    ).rejects.toThrow(TypeError)
  })
})

function beefOf(tx: Transaction): Beef {
  const beef = new Beef()
  beef.mergeTransaction(tx)
  return beef
}
